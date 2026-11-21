import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Agenda } from "@beautyspa/contracts";
import { TokenService } from "../../../src/auth/token.service.js";
import { CLOCK } from "../../../src/common/clock.js";
import { createIntegrationApp, resetState, resetTenancyCache } from "../app.js";
import {
  BOOKING_DATE,
  BOOKING_NOW,
  bookSegment,
  fixedClock,
  seedBookingFixture,
  staffSession,
  type BookingFixture,
} from "../helpers.js";

describe("GET /staff/agenda", () => {
  const clock = fixedClock(BOOKING_NOW);
  let ctx: Awaited<ReturnType<typeof createIntegrationApp>>;
  let f: BookingFixture;
  let reception: { id: string; token: string };

  const get = (query: string, bearer = reception.token) =>
    request(ctx.app.getHttpServer()).get(`/v1/staff/agenda?${query}`).set("Authorization", `Bearer ${bearer}`);
  const employeeToken = async (staffUserId: string) =>
    (await ctx.app.get(TokenService).issueAccess({ sub: staffUserId, typ: "staff", org: f.orgId, role: "EMPLOYEE" }))
      .token;

  beforeAll(async () => {
    ctx = await createIntegrationApp({ override: (b) => b.overrideProvider(CLOCK).useValue(clock) });
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await resetState(ctx.prisma, ctx.redis);
    resetTenancyCache(ctx.app);
    f = await seedBookingFixture(ctx.prisma);
    reception = await staffSession(ctx.app, ctx.prisma, f, "RECEPTION");
  });

  it("lists only the active appointments of the local day, sorted by start", async () => {
    await bookSegment(ctx.prisma, f, { staffUserId: f.staffA, startsAt: "17:00", endsAt: "18:00" });
    const booked = await bookSegment(ctx.prisma, f, { staffUserId: f.staffA, startsAt: "15:00", endsAt: "16:00" });
    const cancelled = await bookSegment(ctx.prisma, f, { staffUserId: f.staffA, startsAt: "19:00", endsAt: "20:00" });
    await ctx.prisma.appointment.update({
      where: { id: cancelled.id },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelledBy: "STAFF" },
    });
    const held = await bookSegment(ctx.prisma, f, { staffUserId: f.staffA, startsAt: "20:00", endsAt: "21:00" });
    await ctx.prisma.appointment.update({
      where: { id: held.id },
      data: { status: "HELD", customerId: null, holdExpiresAt: new Date(BOOKING_NOW + 3_600_000) },
    });
    // next local day (2026-12-02 10:00 local)
    await ctx.prisma.appointment.create({
      data: {
        organizationId: f.orgId,
        locationId: f.locationId,
        customerId: f.customerId,
        status: "BOOKED",
        source: "ONLINE",
        segments: {
          create: {
            organizationId: f.orgId,
            serviceId: f.serviceId,
            staffUserId: f.staffA,
            startsAt: new Date("2026-12-02T15:00:00.000Z"),
            endsAt: new Date("2026-12-02T16:00:00.000Z"),
            blockEndsAt: new Date("2026-12-02T16:00:00.000Z"),
            durationMin: 60,
            priceCents: 4000,
          },
        },
      },
    });
    const res = await get(`date=${BOOKING_DATE}`);
    expect(res.status).toBe(200);
    const body = res.body as Agenda;
    expect(body.date).toBe(BOOKING_DATE);
    expect(body.locationId).toBe(f.locationId);
    expect(body.timezone).toBe("America/New_York");
    expect(body.appointments).toHaveLength(2);
    expect(body.appointments[0]!.id).toBe(booked.id);
    expect(body.appointments[0]!.customer?.name).toBe("Ana");
    expect(body.appointments[0]!.startsAt < body.appointments[1]!.startsAt).toBe(true);
  });

  it("includes an appointment at 23:30 local that is after UTC midnight", async () => {
    // 23:30 local = 04:30Z on the next UTC day
    const row = await ctx.prisma.appointment.create({
      data: {
        organizationId: f.orgId,
        locationId: f.locationId,
        customerId: f.customerId,
        status: "BOOKED",
        source: "RECEPTION",
        segments: {
          create: {
            organizationId: f.orgId,
            serviceId: f.maniId,
            staffUserId: f.staffA,
            startsAt: new Date("2026-12-02T04:30:00.000Z"),
            endsAt: new Date("2026-12-02T05:00:00.000Z"),
            blockEndsAt: new Date("2026-12-02T05:00:00.000Z"),
            durationMin: 30,
            priceCents: 2500,
          },
        },
      },
    });
    const res = await get(`date=${BOOKING_DATE}`);
    expect((res.body as Agenda).appointments.map((a) => a.id)).toEqual([row.id]);
  });

  it("filters by employeeId", async () => {
    const a = await bookSegment(ctx.prisma, f, { staffUserId: f.staffA, startsAt: "15:00", endsAt: "16:00" });
    const b = await bookSegment(ctx.prisma, f, { staffUserId: f.staffB, startsAt: "15:00", endsAt: "16:00" });
    const onlyB = await get(`date=${BOOKING_DATE}&employeeId=${f.staffB}`);
    expect((onlyB.body as Agenda).appointments.map((x) => x.id)).toEqual([b.id]);
    const all = await get(`date=${BOOKING_DATE}`);
    expect((all.body as Agenda).appointments.map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("limits an EMPLOYEE to their own appointments and 403s another employeeId", async () => {
    const a = await bookSegment(ctx.prisma, f, { staffUserId: f.staffA, startsAt: "15:00", endsAt: "16:00" });
    await bookSegment(ctx.prisma, f, { staffUserId: f.staffB, startsAt: "15:00", endsAt: "16:00" });
    const token = await employeeToken(f.staffA);
    const own = await get(`date=${BOOKING_DATE}`, token);
    expect(own.status).toBe(200);
    expect((own.body as Agenda).appointments.map((x) => x.id)).toEqual([a.id]);
    const other = await get(`date=${BOOKING_DATE}&employeeId=${f.staffB}`, token);
    expect(other.status).toBe(403);
  });

  it("rejects a malformed date with 400 and no token with 401", async () => {
    expect((await get("date=nope")).status).toBe(400);
    expect((await request(ctx.app.getHttpServer()).get(`/v1/staff/agenda?date=${BOOKING_DATE}`)).status).toBe(401);
  });
});
