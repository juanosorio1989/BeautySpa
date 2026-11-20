import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Appointment, StaffAppointment } from "@beautyspa/contracts";
import { TokenService } from "../../../src/auth/token.service.js";
import { BookingEvents } from "../../../src/booking/booking-events.js";
import { CLOCK } from "../../../src/common/clock.js";
import { createIntegrationApp, resetState, resetTenancyCache } from "../app.js";
import {
  BOOKING_NOW,
  bookSegment,
  fixedClock,
  seedBookingFixture,
  staffSession,
  type BookingFixture,
} from "../helpers.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** 2026-12-01 local (America/New_York, UTC-5) wall time as an epoch ms. */
const local = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return Date.parse("2026-12-01T05:00:00.000Z") + h! * HOUR + m! * MINUTE;
};
const iso = (ms: number) => new Date(ms).toISOString();

describe("POST /staff/walk-in", () => {
  const clock = fixedClock(BOOKING_NOW);
  const events = {
    booked: vi.fn<(id: string) => Promise<void>>(),
    changed: vi.fn<(id: string) => Promise<void>>(),
    cancelled: vi.fn<(id: string) => Promise<void>>(),
  };
  let ctx: Awaited<ReturnType<typeof createIntegrationApp>>;
  let f: BookingFixture;
  let reception: { id: string; token: string };

  const walkIn = (body: Record<string, unknown>, bearer = reception.token) =>
    request(ctx.app.getHttpServer()).post("/v1/staff/walk-in").set("Authorization", `Bearer ${bearer}`).send(body);
  const pediAny = () => [{ serviceId: f.pediId, employeeId: "ANY" }];

  /** Both employees and both chairs busy from 09:15 local until `untilUtc` ("HH:MM" UTC). */
  const occupyBothChairsUntil = async (untilUtc: string) => {
    await bookSegment(ctx.prisma, f, {
      staffUserId: f.staffA,
      startsAt: "14:15",
      endsAt: untilUtc,
      resourceId: f.resource1,
    });
    await bookSegment(ctx.prisma, f, {
      staffUserId: f.staffB,
      startsAt: "14:15",
      endsAt: untilUtc,
      resourceId: f.resource2,
    });
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
    clock.set(local("10:07"));
    for (const fn of Object.values(events)) {
      fn.mockReset();
      fn.mockResolvedValue(undefined);
    }
    f = await seedBookingFixture(ctx.prisma);
    reception = await staffSession(ctx.app, ctx.prisma, f, "RECEPTION");
  });

  it("checks the customer in at the grid floor (10:07 -> 10:00) and records it", async () => {
    const res = await walkIn({ customerId: f.customerId, services: pediAny(), notes: "Walked in" });
    expect(res.status).toBe(201);
    const body = res.body as StaffAppointment;
    expect(body).toMatchObject({
      status: "CHECKED_IN",
      source: "WALK_IN",
      createdByStaffId: reception.id,
      startsAt: iso(local("10:00")),
      notes: "Walked in",
    });
    expect(body.customer?.name).toBe("Ana");
    expect(body.segments).toHaveLength(1);

    const segs = await ctx.prisma.appointmentSegment.findMany({ where: { appointmentId: body.id } });
    expect(segs[0]).toMatchObject({ organizationId: f.orgId, occupies: true });
    expect(segs[0]!.blockEndsAt.toISOString()).toBe(body.segments[0]!.blockEndsAt);

    const audits = await ctx.prisma.auditLog.findMany({ where: { action: "appointment.create" } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorType: "STAFF", actorId: reception.id, entityId: body.id, before: null });
    expect((audits[0]!.after as Appointment).status).toBe("CHECKED_IN");
    expect(events.booked).toHaveBeenCalledWith(body.id);
  });

  it("takes 10:15 when both chairs are busy until 10:15", async () => {
    await occupyBothChairsUntil("15:15");
    const res = await walkIn({ customerId: f.customerId, services: pediAny() });
    expect(res.status).toBe(201);
    expect((res.body as StaffAppointment).startsAt).toBe(iso(local("10:15")));
  });

  it("answers 409 SLOT_TAKEN when nothing is free within one grid step of the floor", async () => {
    await occupyBothChairsUntil("15:30");
    const res = await walkIn({ customerId: f.customerId, services: pediAny() });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SLOT_TAKEN");
    expect(await ctx.prisma.appointment.count({ where: { source: "WALK_IN" } })).toBe(0);
    expect(events.booked).not.toHaveBeenCalled();
  });

  it("accepts an anonymous walk-in", async () => {
    const res = await walkIn({ customerId: null, services: pediAny() });
    expect(res.status).toBe(201);
    expect((res.body as StaffAppointment).customer).toBeNull();
  });

  it("frees the time of an expired hold before planning", async () => {
    const hold = await bookSegment(ctx.prisma, f, {
      staffUserId: f.staffA,
      startsAt: "14:15",
      endsAt: "15:30",
      resourceId: f.resource1,
    });
    await ctx.prisma.appointment.update({
      where: { id: hold.id },
      data: { status: "HELD", customerId: null, holdExpiresAt: new Date(local("10:00")) },
    });
    await bookSegment(ctx.prisma, f, {
      staffUserId: f.staffB,
      startsAt: "14:15",
      endsAt: "15:30",
      resourceId: f.resource2,
    });
    const res = await walkIn({ customerId: null, services: pediAny() });
    expect(res.status).toBe(201);
    expect((res.body as StaffAppointment).startsAt).toBe(iso(local("10:00")));
    expect((await ctx.prisma.appointment.findUniqueOrThrow({ where: { id: hold.id } })).status).toBe("CANCELLED");
  });

  it("answers 400 on customerId for an unknown customer and on services for an unknown service", async () => {
    const unknownCustomer = await walkIn({ customerId: "00000000-0000-4000-8000-000000000000", services: pediAny() });
    expect(unknownCustomer.status).toBe(400);
    expect(unknownCustomer.body.errors).toEqual([{ path: "customerId", message: "Unknown customer" }]);

    const unknownService = await walkIn({
      customerId: null,
      services: [{ serviceId: "00000000-0000-4000-8000-000000000000", employeeId: "ANY" }],
    });
    expect(unknownService.status).toBe(400);
    expect(unknownService.body.errors[0].path).toBe("services");
  });

  it("is forbidden to EMPLOYEE", async () => {
    const { token } = await ctx.app
      .get(TokenService)
      .issueAccess({ sub: f.staffA, typ: "staff", org: f.orgId, role: "EMPLOYEE" });
    expect((await walkIn({ customerId: null, services: pediAny() }, token)).status).toBe(403);
  });
});
