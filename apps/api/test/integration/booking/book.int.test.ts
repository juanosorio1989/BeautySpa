import { Logger } from "@nestjs/common";
import type { AppointmentStatus } from "@prisma/client";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Appointment, MyAppointments, Slot } from "@beautyspa/contracts";
import { BookingEvents } from "../../../src/booking/booking-events.js";
import { HoldSweeper } from "../../../src/booking/hold-sweeper.js";
import { CLOCK } from "../../../src/common/clock.js";
import { createIntegrationApp, resetState, resetTenancyCache } from "../app.js";
import {
  BOOKING_DATE,
  BOOKING_NOW,
  customerSession,
  fixedClock,
  seedBookingFixture,
  staffSession,
  type BookingFixture,
} from "../helpers.js";

const MINUTE = 60_000;
const UNKNOWN_ID = "01934b6e-0000-7000-8000-000000000000";

describe("POST /appointments and GET /me/appointments", () => {
  const clock = fixedClock(BOOKING_NOW);
  const events = {
    booked: vi.fn<(id: string) => Promise<void>>(),
    changed: vi.fn<(id: string) => Promise<void>>(),
    cancelled: vi.fn<(id: string) => Promise<void>>(),
  };
  let ctx: Awaited<ReturnType<typeof createIntegrationApp>>;
  let f: BookingFixture;
  let token: string;

  const http = () => request(ctx.app.getHttpServer());

  const holdFirstPediSlot = async (): Promise<{ holdId: string; slot: Slot }> => {
    const slots = await http().get(`/v1/availability?services=${f.pediId}:ANY&date=${BOOKING_DATE}`);
    expect(slots.status).toBe(200);
    const slot = (slots.body as Slot[])[0]!;
    const res = await http().post("/v1/holds").send({ segments: slot.segments });
    expect(res.status).toBe(201);
    return { holdId: res.body.holdId as string, slot };
  };

  const book = (body: Record<string, unknown>, bearer: string | null = token) => {
    const req = http().post("/v1/appointments");
    if (bearer) req.set("Authorization", `Bearer ${bearer}`);
    return req.send(body);
  };

  beforeAll(async () => {
    ctx = await createIntegrationApp({
      override: (b) => b.overrideProvider(CLOCK).useValue(clock).overrideProvider(BookingEvents).useValue(events),
    });
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await resetState(ctx.prisma, ctx.redis);
    resetTenancyCache(ctx.app);
    clock.set(BOOKING_NOW);
    for (const fn of Object.values(events)) {
      fn.mockReset();
      fn.mockResolvedValue(undefined);
    }
    f = await seedBookingFixture(ctx.prisma);
    token = (await customerSession(ctx.app, f)).token;
  });

  describe("POST /appointments", () => {
    it("confirms a hold as a booking for the caller", async () => {
      const { holdId, slot } = await holdFirstPediSlot();
      const res = await book({ holdId, notes: "  Window seat please  " });
      expect(res.status).toBe(201);
      const body = res.body as Appointment;
      expect(body.id).toBe(holdId);
      expect(body.status).toBe("BOOKED");
      expect(body.totalPriceCents).toBe(4000);
      expect(body.notes).toBe("Window seat please");
      expect(body.segments[0]!.blockEndsAt).toBe(slot.segments[0]!.blockEndsAt);

      const row = await ctx.prisma.appointment.findUniqueOrThrow({
        where: { id: holdId },
        include: { segments: true },
      });
      expect(row.status).toBe("BOOKED");
      expect(row.customerId).toBe(f.customerId);
      expect(row.holdExpiresAt).toBeNull();
      expect(row.notes).toBe("Window seat please");
      expect(row.segments.every((s) => s.occupies)).toBe(true);

      const audits = await ctx.prisma.auditLog.findMany({ where: { action: "appointment.create" } });
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        organizationId: f.orgId,
        actorType: "CUSTOMER",
        actorId: f.customerId,
        entity: "appointment",
        entityId: holdId,
      });
      expect((audits[0]!.before as { status: string }).status).toBe("HELD");
      expect((audits[0]!.after as { status: string }).status).toBe("BOOKED");

      expect(events.booked).toHaveBeenCalledTimes(1);
      expect(events.booked).toHaveBeenCalledWith(holdId);
    });

    it("rejects booking the same hold twice with 409 CONFLICT", async () => {
      const { holdId } = await holdFirstPediSlot();
      expect((await book({ holdId })).status).toBe(201);
      const again = await book({ holdId });
      expect(again.status).toBe(409);
      expect(again.body.code).toBe("CONFLICT");
      expect(events.booked).toHaveBeenCalledTimes(1);
      expect(await ctx.prisma.auditLog.count({ where: { action: "appointment.create" } })).toBe(1);
    });

    it("answers 404 for an unknown hold", async () => {
      const res = await book({ holdId: UNKNOWN_ID });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
    });

    it("answers 404 for a hold of another organization", async () => {
      const { holdId } = await holdFirstPediSlot();
      const other = await ctx.prisma.organization.create({
        data: { name: "Other", slug: "other", defaultLocale: "en" },
      });
      await ctx.prisma
        .$executeRaw`UPDATE appointment SET organization_id = ${other.id}::uuid WHERE id = ${holdId}::uuid`;
      const res = await book({ holdId });
      expect(res.status).toBe(404);
    });

    it("answers 409 HOLD_EXPIRED once the hold has expired, before and after the sweeper", async () => {
      const { holdId } = await holdFirstPediSlot();
      clock.set(BOOKING_NOW + 6 * MINUTE);
      const expired = await book({ holdId });
      expect(expired.status).toBe(409);
      expect(expired.body.code).toBe("HOLD_EXPIRED");

      expect(await ctx.app.get(HoldSweeper).sweep()).toBe(1);
      const released = await book({ holdId });
      expect(released.status).toBe(409);
      expect(released.body.code).toBe("HOLD_EXPIRED");

      expect(events.booked).not.toHaveBeenCalled();
      expect(await ctx.prisma.auditLog.count({ where: { action: "appointment.create" } })).toBe(0);
    });

    it("answers 409 HOLD_EXPIRED exactly at expiry", async () => {
      const { holdId } = await holdFirstPediSlot();
      clock.set(BOOKING_NOW + 5 * MINUTE);
      const res = await book({ holdId });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("HOLD_EXPIRED");
    });

    it("requires a name before booking and leaves the hold untouched", async () => {
      const nameless = await ctx.prisma.customer.create({
        data: { organizationId: f.orgId, phoneE164: "+13055550199", name: null, locale: "en", createdVia: "ONLINE" },
      });
      const { token: namelessToken } = await customerSession(ctx.app, f, nameless.id);
      const { holdId } = await holdFirstPediSlot();
      const res = await book({ holdId }, namelessToken);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_FAILED");
      expect(res.body.errors[0].path).toBe("name");

      const row = await ctx.prisma.appointment.findUniqueOrThrow({ where: { id: holdId } });
      expect(row.status).toBe("HELD");
      expect(row.customerId).toBeNull();
      expect(row.holdExpiresAt).not.toBeNull();
      expect(events.booked).not.toHaveBeenCalled();
    });

    it("still answers 201 when the booked event fails", async () => {
      events.booked.mockRejectedValue(new Error("notifier down"));
      const logged = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
      const { holdId } = await holdFirstPediSlot();
      const res = await book({ holdId });
      expect(res.status).toBe(201);
      expect(events.booked).toHaveBeenCalledTimes(1);
      expect(logged).toHaveBeenCalledWith(expect.stringContaining("notifier down"), expect.any(String));
      logged.mockRestore();
      expect((await ctx.prisma.appointment.findUniqueOrThrow({ where: { id: holdId } })).status).toBe("BOOKED");
    });

    it("forbids staff tokens and requires a token", async () => {
      const { holdId } = await holdFirstPediSlot();
      const staff = await staffSession(ctx.app, ctx.prisma, f, "RECEPTION");
      expect((await book({ holdId }, staff.token)).status).toBe(403);
      expect((await book({ holdId }, null)).status).toBe(401);
    });

    it("rate limits bookings per customer: 10 per hour", async () => {
      for (let i = 0; i < 10; i++) {
        expect((await book({ holdId: UNKNOWN_ID })).status).toBe(404);
      }
      const res = await book({ holdId: UNKNOWN_ID });
      expect(res.status).toBe(429);
      expect(res.body.code).toBe("RATE_LIMITED");
    });
  });

  describe("GET /me/appointments", () => {
    const seedAppointment = async (opts: {
      status: AppointmentStatus;
      startsAt: string;
      endsAt: string;
      staffUserId: string;
      customerId?: string | null;
    }) =>
      ctx.prisma.appointment.create({
        data: {
          organizationId: f.orgId,
          locationId: f.locationId,
          customerId: opts.customerId === undefined ? f.customerId : opts.customerId,
          status: opts.status,
          source: "ONLINE",
          segments: {
            create: {
              organizationId: f.orgId,
              serviceId: f.pediId,
              staffUserId: opts.staffUserId,
              startsAt: new Date(opts.startsAt),
              endsAt: new Date(opts.endsAt),
              blockEndsAt: new Date(opts.endsAt),
              durationMin: 60,
              priceCents: 4000,
              occupies: opts.status !== "CANCELLED" && opts.status !== "NO_SHOW",
            },
          },
        },
        select: { id: true },
      });

    it("splits the caller's appointments into upcoming and past, without holds or others' rows", async () => {
      const upcoming = await seedAppointment({
        status: "BOOKED",
        startsAt: "2026-12-01T14:00:00.000Z",
        endsAt: "2026-12-01T15:00:00.000Z",
        staffUserId: f.staffA,
      });
      const completed = await seedAppointment({
        status: "COMPLETED",
        startsAt: "2026-11-28T14:00:00.000Z",
        endsAt: "2026-11-28T15:00:00.000Z",
        staffUserId: f.staffA,
      });
      const cancelled = await seedAppointment({
        status: "CANCELLED",
        startsAt: "2026-12-02T14:00:00.000Z",
        endsAt: "2026-12-02T15:00:00.000Z",
        staffUserId: f.staffA,
      });
      const otherCustomer = await ctx.prisma.customer.create({
        data: { organizationId: f.orgId, phoneE164: "+13055550188", name: "Bea", locale: "en", createdVia: "ONLINE" },
      });
      await seedAppointment({
        status: "BOOKED",
        startsAt: "2026-12-01T14:00:00.000Z",
        endsAt: "2026-12-01T15:00:00.000Z",
        staffUserId: f.staffB,
        customerId: otherCustomer.id,
      });
      await seedAppointment({
        status: "HELD",
        startsAt: "2026-12-01T16:00:00.000Z",
        endsAt: "2026-12-01T17:00:00.000Z",
        staffUserId: f.staffA,
      });

      const res = await http().get("/v1/me/appointments").set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      const body = res.body as MyAppointments;
      expect(body.upcoming.map((a) => a.id)).toEqual([upcoming.id]);
      expect(body.past.map((a) => a.id)).toEqual([cancelled.id, completed.id]);
    });

    it("moves a BOOKED appointment that has ended to past and orders upcoming by start", async () => {
      const later = await seedAppointment({
        status: "CHECKED_IN",
        startsAt: "2026-12-01T16:00:00.000Z",
        endsAt: "2026-12-01T17:00:00.000Z",
        staffUserId: f.staffA,
      });
      const sooner = await seedAppointment({
        status: "BOOKED",
        startsAt: "2026-12-01T14:00:00.000Z",
        endsAt: "2026-12-01T15:00:00.000Z",
        staffUserId: f.staffA,
      });
      const ended = await seedAppointment({
        status: "BOOKED",
        startsAt: "2026-11-30T10:00:00.000Z",
        endsAt: "2026-11-30T11:00:00.000Z",
        staffUserId: f.staffA,
      });
      const res = await http().get("/v1/me/appointments").set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      const body = res.body as MyAppointments;
      expect(body.upcoming.map((a) => a.id)).toEqual([sooner.id, later.id]);
      expect(body.past.map((a) => a.id)).toEqual([ended.id]);
    });

    it("forbids staff tokens and requires a token", async () => {
      const staff = await staffSession(ctx.app, ctx.prisma, f, "OWNER");
      expect((await http().get("/v1/me/appointments").set("Authorization", `Bearer ${staff.token}`)).status).toBe(403);
      expect((await http().get("/v1/me/appointments")).status).toBe(401);
    });
  });
});
