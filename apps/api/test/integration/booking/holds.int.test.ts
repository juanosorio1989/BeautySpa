import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PlannedSegment, Slot } from "@beautyspa/contracts";
import { AppointmentWriter } from "../../../src/booking/appointment-writer.js";
import { HoldSweeper } from "../../../src/booking/hold-sweeper.js";
import { toEngineSegments } from "../../../src/booking/plan-mapping.js";
import { CLOCK } from "../../../src/common/clock.js";
import { createIntegrationApp, resetState, resetTenancyCache } from "../app.js";
import { BOOKING_DATE, BOOKING_NOW, bookSegment, fixedClock, seedBookingFixture, type BookingFixture } from "../helpers.js";

const MINUTE = 60_000;

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
  const hold = (segments: PlannedSegment[]) =>
    request(ctx.app.getHttpServer()).post("/v1/holds").send({ segments });

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

  it("maps an exclusion-constraint violation on insert to 409 SLOT_TAKEN and rolls back", async () => {
    const slot = await firstPediSlot();
    const seg = slot.segments[0]!;
    await bookSegment(ctx.prisma, f, { staffUserId: seg.employeeId, startsAt: "14:00", endsAt: "15:00" });
    const writer = ctx.app.get(AppointmentWriter);
    const attempt = ctx.prisma.$transaction(async (tx) => {
      const appt = await tx.appointment.create({
        data: { organizationId: f.orgId, locationId: f.locationId, status: "HELD", source: "ONLINE" },
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
