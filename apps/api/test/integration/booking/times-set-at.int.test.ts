import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlannedSegment, Slot } from "@beautyspa/contracts";
import { BookingEvents } from "../../../src/booking/booking-events.js";
import { CLOCK } from "../../../src/common/clock.js";
import { createIntegrationApp, resetState, resetTenancyCache } from "../app.js";
import {
  BOOKING_DATE,
  BOOKING_NOW,
  bookSegment,
  customerSession,
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
/** A time well before BOOKING_NOW, used as the "old" times_set_at / confirmation. */
const OLD = new Date("2026-11-20T10:00:00.000Z");

describe("appointment.times_set_at and the confirmation reset", () => {
  const clock = fixedClock(BOOKING_NOW);
  const events = {
    booked: vi.fn<(id: string) => Promise<void>>(),
    changed: vi.fn<(id: string) => Promise<void>>(),
    cancelled: vi.fn<(id: string) => Promise<void>>(),
  };
  let ctx: Awaited<ReturnType<typeof createIntegrationApp>>;
  let f: BookingFixture;
  let customerToken: string;
  let receptionToken: string;

  const http = () => request(ctx.app.getHttpServer());
  const asCustomer = (req: request.Test) => req.set("Authorization", `Bearer ${customerToken}`);
  const asReception = (req: request.Test) => req.set("Authorization", `Bearer ${receptionToken}`);

  const pedi = (startMs: number): PlannedSegment => ({
    serviceId: f.pediId,
    employeeId: f.staffA,
    resourceId: f.resource1,
    startsAt: iso(startMs),
    endsAt: iso(startMs + 60 * MINUTE),
    blockEndsAt: iso(startMs + 60 * MINUTE),
    durationMin: 60,
    priceCents: 4000,
  });

  /** BOOKED pedicure with staffA and chair 1 at 09:00 local, set and confirmed at OLD. */
  const seedConfirmedPedi = async () => {
    const { id } = await bookSegment(ctx.prisma, f, {
      staffUserId: f.staffA,
      startsAt: "14:00",
      endsAt: "15:00",
      resourceId: f.resource1,
    });
    await ctx.prisma.appointment.update({ where: { id }, data: { timesSetAt: OLD, confirmedByCustomerAt: OLD } });
    return id;
  };

  const times = async (id: string) => {
    const row = await ctx.prisma.appointment.findUniqueOrThrow({
      where: { id },
      select: { timesSetAt: true, confirmedByCustomerAt: true },
    });
    return { timesSetAt: row.timesSetAt.toISOString(), confirmedByCustomerAt: row.confirmedByCustomerAt };
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
    customerToken = (await customerSession(ctx.app, f)).token;
    receptionToken = (await staffSession(ctx.app, ctx.prisma, f, "RECEPTION")).token;
  });

  it("book sets timesSetAt to now", async () => {
    const slots = await http().get(`/v1/availability?services=${f.pediId}:ANY&date=${BOOKING_DATE}`);
    const slot = (slots.body as Slot[])[0]!;
    const hold = await http().post("/v1/holds").send({ segments: slot.segments });
    expect(hold.status).toBe(201);

    clock.set(BOOKING_NOW + 2 * MINUTE);
    const res = await asCustomer(http().post("/v1/appointments")).send({ holdId: hold.body.holdId });
    expect(res.status).toBe(201);
    expect((await times(hold.body.holdId as string)).timesSetAt).toBe(iso(BOOKING_NOW + 2 * MINUTE));
  });

  it("staff create and walk-in set timesSetAt", async () => {
    const created = await asReception(http().post("/v1/staff/appointments")).send({
      customerId: f.customerId,
      segments: [pedi(local("10:00"))],
    });
    expect(created.status).toBe(201);
    expect((await times(created.body.id as string)).timesSetAt).toBe(iso(BOOKING_NOW));

    clock.set(local("12:07"));
    const walkIn = await asReception(http().post("/v1/staff/walk-in")).send({
      customerId: f.customerId,
      services: [{ serviceId: f.maniId, employeeId: "ANY" }],
    });
    expect(walkIn.status).toBe(201);
    expect((await times(walkIn.body.id as string)).timesSetAt).toBe(iso(local("12:07")));
  });

  it("customer reschedule sets timesSetAt and clears confirmedByCustomerAt", async () => {
    const id = await seedConfirmedPedi();
    const slots = await asCustomer(
      http().get(`/v1/availability?services=${f.pediId}:${f.staffA}&date=${BOOKING_DATE}&excludeAppointmentId=${id}`),
    );
    const target = (slots.body as Slot[]).find((s) => s.startsAt === iso(local("09:15")));
    expect(target).toBeDefined();

    const res = await asCustomer(http().post(`/v1/me/appointments/${id}/reschedule`)).send({
      segments: target!.segments,
    });
    expect(res.status).toBe(200);
    expect(await times(id)).toEqual({ timesSetAt: iso(BOOKING_NOW), confirmedByCustomerAt: null });
  });

  it("staff move sets timesSetAt and clears confirmedByCustomerAt", async () => {
    const id = await seedConfirmedPedi();
    const res = await asReception(http().patch(`/v1/staff/appointments/${id}`)).send({
      segments: [pedi(local("11:00"))],
    });
    expect(res.status).toBe(200);
    expect(await times(id)).toEqual({ timesSetAt: iso(BOOKING_NOW), confirmedByCustomerAt: null });
  });

  it("cancel keeps timesSetAt and confirmedByCustomerAt", async () => {
    const byCustomer = await seedConfirmedPedi();
    const cancelled = await asCustomer(http().post(`/v1/me/appointments/${byCustomer}/cancel`)).send({});
    expect(cancelled.status).toBe(200);
    expect(await times(byCustomer)).toEqual({ timesSetAt: OLD.toISOString(), confirmedByCustomerAt: OLD });

    const byStaff = await seedConfirmedPedi();
    const status = await asReception(http().post(`/v1/staff/appointments/${byStaff}/status`)).send({
      status: "CANCELLED",
    });
    expect(status.status).toBe(200);
    expect(await times(byStaff)).toEqual({ timesSetAt: OLD.toISOString(), confirmedByCustomerAt: OLD });
  });
});
