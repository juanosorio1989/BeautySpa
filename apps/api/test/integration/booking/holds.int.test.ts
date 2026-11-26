import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PlannedSegment, Slot } from "@beautyspa/contracts";
import { AppointmentWriter, lockOrgBookings, releaseExpiredHolds } from "../../../src/booking/appointment-writer.js";
import { HoldSweeper } from "../../../src/booking/hold-sweeper.js";
import { toEngineSegments } from "../../../src/booking/plan-mapping.js";
import { CLOCK } from "../../../src/common/clock.js";
import { createIntegrationApp, resetState, resetTenancyCache } from "../app.js";
import {
  BOOKING_DATE,
  BOOKING_NOW,
  bookSegment,
  customerSession,
  fixedClock,
  seedBookingFixture,
  SEEDED_TIMES_SET_AT,
  type BookingFixture,
} from "../helpers.js";

const MINUTE = 60_000;
const UNKNOWN_ID = "01934b6e-0000-7000-8000-000000000000";

describe("POST /holds", () => {
  const clock = fixedClock(BOOKING_NOW);
  let ctx: Awaited<ReturnType<typeof createIntegrationApp>>;
  let f: BookingFixture;

  const firstPediSlot = async (): Promise<Slot> => {
    const res = await request(ctx.app.getHttpServer()).get(
      `/v1/availability?services=${f.pediId}:ANY&date=${BOOKING_DATE}`,
    );
    expect(res.status).toBe(200);
    return (res.body as Slot[])[0]!;
  };
  const hold = (segments: PlannedSegment[]) => request(ctx.app.getHttpServer()).post("/v1/holds").send({ segments });

  beforeAll(async () => {
    ctx = await createIntegrationApp({ override: (b) => b.overrideProvider(CLOCK).useValue(clock) });
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await resetState(ctx.prisma, ctx.redis);
    resetTenancyCache(ctx.app);
    clock.set(BOOKING_NOW);
    f = await seedBookingFixture(ctx.prisma);
  });

  it("holds the first pedicure slot for five minutes", async () => {
    const slot = await firstPediSlot();
    const res = await hold(slot.segments);
    expect(res.status).toBe(201);
    expect(res.body.expiresAt).toBe(new Date(BOOKING_NOW + 5 * MINUTE).toISOString());

    const appt = await ctx.prisma.appointment.findUniqueOrThrow({
      where: { id: res.body.holdId },
      include: { segments: true },
    });
    expect(appt.status).toBe("HELD");
    expect(appt.source).toBe("ONLINE");
    expect(appt.customerId).toBeNull();
    expect(appt.organizationId).toBe(f.orgId);
    expect(appt.locationId).toBe(f.locationId);
    expect(appt.segments).toHaveLength(1);
    expect(appt.segments[0]!.occupies).toBe(true);
    expect(appt.segments[0]!.blockEndsAt.toISOString()).toBe(slot.segments[0]!.blockEndsAt);

    const audits = await ctx.prisma.auditLog.findMany({ where: { action: "appointment.hold" } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorType: "CUSTOMER", actorId: null, entity: "appointment", entityId: appt.id });
    expect((audits[0]!.after as { status: string }).status).toBe("HELD");
  });

  it("lets exactly one of two concurrent holds of the same slot win", async () => {
    const slot = await firstPediSlot();
    const results = await Promise.all([hold(slot.segments), hold(slot.segments)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.body.code).toBe("SLOT_TAKEN");
    expect(await ctx.prisma.appointment.count({ where: { status: "HELD" } })).toBe(1);
    expect(await ctx.prisma.appointmentSegment.count()).toBe(1);
  });

  it("releases an expired hold so the same slot can be held again", async () => {
    const slot = await firstPediSlot();
    const first = await hold(slot.segments);
    expect(first.status).toBe(201);
    expect((await hold(slot.segments)).status).toBe(409);

    clock.set(BOOKING_NOW + 6 * MINUTE);
    const second = await hold(slot.segments);
    expect(second.status).toBe(201);

    const old = await ctx.prisma.appointment.findUniqueOrThrow({
      where: { id: first.body.holdId },
      include: { segments: true },
    });
    expect(old.status).toBe("CANCELLED");
    expect(old.cancelReason).toBe("HOLD_EXPIRED");
    expect(old.cancelledBy).toBe("SYSTEM");
    expect(old.cancelledAt?.getTime()).toBe(BOOKING_NOW + 6 * MINUTE);
    expect(old.holdExpiresAt?.getTime()).toBe(BOOKING_NOW + 5 * MINUTE);
    expect(old.segments.every((s) => !s.occupies)).toBe(true);
  });

  it("audits the expired holds it releases as one SYSTEM appointment.hold_release row", async () => {
    const slot = await firstPediSlot();
    const first = await hold(slot.segments);
    expect(first.status).toBe(201);
    expect(await ctx.prisma.auditLog.count({ where: { action: "appointment.hold_release" } })).toBe(0);

    clock.set(BOOKING_NOW + 6 * MINUTE);
    expect((await hold(slot.segments)).status).toBe(201);

    const audits = await ctx.prisma.auditLog.findMany({ where: { action: "appointment.hold_release" } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      organizationId: f.orgId,
      actorType: "SYSTEM",
      actorId: null,
      entity: "appointment",
      entityId: null,
      after: { released: 1 },
    });
  });

  it("releaseExpiredHolds leaves another organization's expired hold untouched", async () => {
    const org = await ctx.prisma.organization.create({
      data: { name: "Other", slug: "other-salon", defaultLocale: "en" },
    });
    const location = await ctx.prisma.location.create({
      data: { organizationId: org.id, name: "Other main", timezone: "America/New_York", settings: {} },
    });
    const staff = await ctx.prisma.staffUser.create({
      data: { organizationId: org.id, email: "x@other.dev", role: "EMPLOYEE", locale: "en" },
    });
    const service = await ctx.prisma.service.create({
      data: { organizationId: org.id, name: { en: "Cut", es: "Corte" }, durationMin: 60, priceCents: 3000 },
    });
    const startsAt = new Date("2026-12-01T15:00:00.000Z");
    const endsAt = new Date("2026-12-01T16:00:00.000Z");
    const other = await ctx.prisma.appointment.create({
      data: {
        organizationId: org.id,
        locationId: location.id,
        status: "HELD",
        source: "ONLINE",
        timesSetAt: SEEDED_TIMES_SET_AT,
        holdExpiresAt: new Date(BOOKING_NOW - MINUTE),
        segments: {
          create: {
            organizationId: org.id,
            serviceId: service.id,
            staffUserId: staff.id,
            startsAt,
            endsAt,
            blockEndsAt: endsAt,
            durationMin: 60,
            priceCents: 3000,
            occupies: true,
          },
        },
      },
      select: { id: true },
    });

    const released = await ctx.prisma.$transaction((tx) => releaseExpiredHolds(tx, f.orgId, new Date(BOOKING_NOW)));
    expect(released).toBe(0);
    const row = await ctx.prisma.appointment.findUniqueOrThrow({
      where: { id: other.id },
      include: { segments: true },
    });
    expect(row.status).toBe("HELD");
    expect(row.segments.every((s) => s.occupies)).toBe(true);
  });

  it("waits for the organization's booking lock before writing", async () => {
    const slot = await firstPediSlot();
    let release!: () => void;
    const released = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    const holder = ctx.prisma.$transaction(
      async (tx) => {
        await lockOrgBookings(tx, f.orgId);
        locked();
        await released;
      },
      { timeout: 10_000 },
    );
    await isLocked;
    let settled = false;
    const pending = hold(slot.segments).then((r) => {
      settled = true;
      return r;
    });
    await new Promise((r) => setTimeout(r, 300));
    expect(settled).toBe(false);
    release();
    await holder;
    expect((await pending).status).toBe(201);
  });

  it("maps an exclusion-constraint violation on insert to 409 SLOT_TAKEN and rolls back", async () => {
    const slot = await firstPediSlot();
    const seg = slot.segments[0]!;
    await bookSegment(ctx.prisma, f, { staffUserId: seg.employeeId, startsAt: "14:00", endsAt: "15:00" });
    const writer = ctx.app.get(AppointmentWriter);
    const attempt = ctx.prisma.$transaction(async (tx) => {
      const appt = await tx.appointment.create({
        data: {
          organizationId: f.orgId,
          locationId: f.locationId,
          status: "HELD",
          source: "ONLINE",
          timesSetAt: SEEDED_TIMES_SET_AT,
        },
        select: { id: true, organizationId: true },
      });
      await writer.insertSegments(tx, appt, toEngineSegments(slot.segments));
    });
    await expect(attempt).rejects.toMatchObject({ status: 409, response: { code: "SLOT_TAKEN" } });
    expect(await ctx.prisma.appointment.count({ where: { status: "HELD" } })).toBe(0);
  });

  describe("tampered segments", () => {
    it("rejects a changed price with 400 on segments", async () => {
      const [seg] = (await firstPediSlot()).segments;
      const res = await hold([{ ...seg!, priceCents: 1 }]);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_FAILED");
      expect(res.body.errors[0].path).toBe("segments");
    });

    it("rejects a start off the grid with 400", async () => {
      const [seg] = (await firstPediSlot()).segments;
      const shift = (iso: string) => new Date(Date.parse(iso) + MINUTE).toISOString();
      const res = await hold([
        {
          ...seg!,
          startsAt: shift(seg!.startsAt),
          endsAt: shift(seg!.endsAt),
          blockEndsAt: shift(seg!.blockEndsAt),
        },
      ]);
      expect(res.status).toBe(400);
      expect(res.body.errors[0].path).toBe("segments");
    });

    it("rejects an employee who does not do the service with 400", async () => {
      const [seg] = (await firstPediSlot()).segments;
      await ctx.prisma.employeeService.deleteMany({ where: { staffUserId: seg!.employeeId, serviceId: f.pediId } });
      const res = await hold([seg!]);
      expect(res.status).toBe(400);
      expect(res.body.errors[0].path).toBe("segments");
    });

    it("rejects a slot inside a closure with 409 SLOT_TAKEN", async () => {
      const [seg] = (await firstPediSlot()).segments;
      await ctx.prisma.locationClosure.create({
        data: {
          locationId: f.locationId,
          startsAt: new Date("2026-12-01T05:00:00.000Z"),
          endsAt: new Date("2026-12-02T05:00:00.000Z"),
          reason: "Holiday",
        },
      });
      const res = await hold([seg!]);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("SLOT_TAKEN");
    });
  });

  it("uses the location's holdMinutes", async () => {
    await ctx.prisma.location.update({ where: { id: f.locationId }, data: { settings: { holdMinutes: 10 } } });
    const slot = await firstPediSlot();
    const res = await hold(slot.segments);
    expect(res.status).toBe(201);
    expect(res.body.expiresAt).toBe(new Date(BOOKING_NOW + 10 * MINUTE).toISOString());
  });

  it("rate limits holds per IP: 30 per 10 minutes", async () => {
    const slot = await firstPediSlot();
    for (let i = 0; i < 30; i++) {
      expect((await hold(slot.segments)).status).not.toBe(429);
    }
    const res = await hold(slot.segments);
    expect(res.status).toBe(429);
    expect(res.body.code).toBe("RATE_LIMITED");
  });

  describe("DELETE /holds/:holdId", () => {
    const release = (holdId: string) => request(ctx.app.getHttpServer()).delete(`/v1/holds/${holdId}`);
    const releaseAudits = () => ctx.prisma.auditLog.findMany({ where: { action: "appointment.hold_release" } });

    it("releases a live hold: the slot is free again, confirming it is HOLD_EXPIRED, audited as CUSTOMER", async () => {
      const slot = await firstPediSlot();
      const held = await hold(slot.segments);
      expect(held.status).toBe(201);
      const holdId = held.body.holdId as string;
      const firstStartWith = async (employeeId: string): Promise<string | undefined> => {
        const res = await request(ctx.app.getHttpServer()).get(
          `/v1/availability?services=${f.pediId}:${employeeId}&date=${BOOKING_DATE}`,
        );
        expect(res.status).toBe(200);
        return (res.body as Slot[])[0]?.segments[0]!.startsAt;
      };
      const heldStart = slot.segments[0]!.startsAt;
      const heldEmployee = slot.segments[0]!.employeeId;
      expect(await firstStartWith(heldEmployee)).not.toBe(heldStart);

      clock.set(BOOKING_NOW + MINUTE);
      const res = await release(holdId);
      expect(res.status).toBe(204);

      const appt = await ctx.prisma.appointment.findUniqueOrThrow({
        where: { id: holdId },
        include: { segments: true },
      });
      expect(appt.status).toBe("CANCELLED");
      expect(appt.cancelledBy).toBe("SYSTEM");
      expect(appt.cancelReason).toBe("HOLD_EXPIRED");
      expect(appt.cancelledAt?.getTime()).toBe(BOOKING_NOW + MINUTE);
      expect(appt.holdExpiresAt?.getTime()).toBe(BOOKING_NOW + 5 * MINUTE);
      expect(appt.segments.every((s) => !s.occupies)).toBe(true);

      expect(await firstStartWith(heldEmployee)).toBe(heldStart);

      const { token } = await customerSession(ctx.app, f);
      const book = await request(ctx.app.getHttpServer())
        .post("/v1/appointments")
        .set("Authorization", `Bearer ${token}`)
        .send({ holdId });
      expect(book.status).toBe(409);
      expect(book.body.code).toBe("HOLD_EXPIRED");

      const audits = await releaseAudits();
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        organizationId: f.orgId,
        actorType: "CUSTOMER",
        actorId: null,
        entity: "appointment",
        entityId: holdId,
        before: null,
        after: { released: 1 },
      });
    });

    it("is idempotent: a second release answers 204 without another audit row", async () => {
      const held = await hold((await firstPediSlot()).segments);
      expect((await release(held.body.holdId)).status).toBe(204);
      expect((await release(held.body.holdId)).status).toBe(204);
      expect(await releaseAudits()).toHaveLength(1);
    });

    it("answers 204 for a hold that already expired (released by the SYSTEM sweep, not by the caller)", async () => {
      const held = await hold((await firstPediSlot()).segments);
      clock.set(BOOKING_NOW + 6 * MINUTE);
      expect((await release(held.body.holdId)).status).toBe(204);
      const audits = await releaseAudits();
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({ actorType: "SYSTEM", entityId: null, after: { released: 1 } });
    });

    it("refuses a booked hold with 409 CONFLICT and leaves it booked", async () => {
      const held = await hold((await firstPediSlot()).segments);
      await ctx.prisma.appointment.update({
        where: { id: held.body.holdId },
        data: { status: "BOOKED", customerId: f.customerId, holdExpiresAt: null },
      });
      const res = await release(held.body.holdId);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("CONFLICT");
      const appt = await ctx.prisma.appointment.findUniqueOrThrow({
        where: { id: held.body.holdId },
        include: { segments: true },
      });
      expect(appt.status).toBe("BOOKED");
      expect(appt.segments.every((s) => s.occupies)).toBe(true);
      expect(await releaseAudits()).toHaveLength(0);
    });

    it("answers 404 for an unknown id and 400 for a non-uuid", async () => {
      const unknown = await release(UNKNOWN_ID);
      expect(unknown.status).toBe(404);
      expect(unknown.body.code).toBe("NOT_FOUND");
      expect((await release("not-a-uuid")).status).toBe(400);
    });

    it("answers 404 for another organization's hold and leaves it held", async () => {
      const org = await ctx.prisma.organization.create({
        data: { name: "Other", slug: "other-salon", defaultLocale: "en" },
      });
      const location = await ctx.prisma.location.create({
        data: { organizationId: org.id, name: "Other main", timezone: "America/New_York", settings: {} },
      });
      const other = await ctx.prisma.appointment.create({
        data: {
          organizationId: org.id,
          locationId: location.id,
          status: "HELD",
          source: "ONLINE",
          timesSetAt: SEEDED_TIMES_SET_AT,
          holdExpiresAt: new Date(BOOKING_NOW + MINUTE),
        },
        select: { id: true },
      });
      expect((await release(other.id)).status).toBe(404);
      expect((await ctx.prisma.appointment.findUniqueOrThrow({ where: { id: other.id } })).status).toBe("HELD");
    });

    it("shares the POST /holds rate limit: the 31st hold-or-release call from one IP is 429", async () => {
      const slot = await firstPediSlot();
      expect((await hold(slot.segments)).status).toBe(201);
      for (let i = 0; i < 29; i++) {
        expect((await release(UNKNOWN_ID)).status).toBe(404);
      }
      const res = await release(UNKNOWN_ID);
      expect(res.status).toBe(429);
      expect(res.body.code).toBe("RATE_LIMITED");
    });
  });

  describe("HoldSweeper", () => {
    const heldAt = async (staffUserId: string, startsAt: string, endsAt: string, holdExpiresAt: Date) => {
      const a = await bookSegment(ctx.prisma, f, { staffUserId, startsAt, endsAt });
      await ctx.prisma.appointment.update({
        where: { id: a.id },
        data: { status: "HELD", customerId: null, holdExpiresAt },
      });
      return a.id;
    };

    it("releases expired holds and audits once per run", async () => {
      const expired1 = await heldAt(f.staffA, "14:00", "15:00", new Date(BOOKING_NOW - MINUTE));
      const expired2 = await heldAt(f.staffB, "14:00", "15:00", new Date(BOOKING_NOW));
      const liveId = await heldAt(f.staffA, "16:00", "17:00", new Date(BOOKING_NOW + MINUTE));

      const sweeper = ctx.app.get(HoldSweeper);
      expect(await sweeper.sweep()).toBe(2);

      const rows = await ctx.prisma.appointment.findMany({ include: { segments: true } });
      const byId = new Map(rows.map((r) => [r.id, r]));
      for (const id of [expired1, expired2]) {
        expect(byId.get(id)!.status).toBe("CANCELLED");
        expect(byId.get(id)!.cancelReason).toBe("HOLD_EXPIRED");
        expect(byId.get(id)!.segments.every((s) => !s.occupies)).toBe(true);
      }
      expect(byId.get(liveId)!.status).toBe("HELD");
      expect(byId.get(liveId)!.segments.every((s) => s.occupies)).toBe(true);

      const audits = await ctx.prisma.auditLog.findMany({ where: { action: "appointment.hold_release" } });
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        organizationId: f.orgId,
        actorType: "SYSTEM",
        actorId: null,
        entity: "appointment",
        entityId: null,
      });
      expect((audits[0]!.after as { released: number }).released).toBe(2);

      expect(await sweeper.sweep()).toBe(0);
      expect(await ctx.prisma.auditLog.count({ where: { action: "appointment.hold_release" } })).toBe(1);
    });
  });
});
