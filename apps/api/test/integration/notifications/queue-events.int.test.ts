import type { Queue } from "bullmq";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Slot } from "@beautyspa/contracts";
import { CLOCK } from "../../../src/common/clock.js";
import { NOTIFICATIONS_QUEUE_TOKEN } from "../../../src/queue/queue.module.js";
import { SEND_JOB_OPTIONS, sendJobId, type SendJob } from "../../../src/queue/queue-names.js";
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

describe("QueueBookingEvents: booking writes enqueue notification send jobs", () => {
  const clock = fixedClock(BOOKING_NOW);
  let ctx: Awaited<ReturnType<typeof createIntegrationApp>>;
  let queue: Queue;
  let f: BookingFixture;
  let token: string;

  const http = () => request(ctx.app.getHttpServer());
  const authed = (req: request.Test, bearer: string) => req.set("Authorization", `Bearer ${bearer}`);
  const versionOf = async (id: string) =>
    (await ctx.prisma.appointment.findUniqueOrThrow({ where: { id }, select: { manageVersion: true } })).manageVersion;

  beforeAll(async () => {
    ctx = await createIntegrationApp({ override: (b) => b.overrideProvider(CLOCK).useValue(clock) });
    queue = ctx.app.get<Queue>(NOTIFICATIONS_QUEUE_TOKEN);
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await resetState(ctx.prisma, ctx.redis);
    resetTenancyCache(ctx.app);
    clock.set(BOOKING_NOW);
    f = await seedBookingFixture(ctx.prisma);
    token = (await customerSession(ctx.app, f)).token;
  });

  it("online booking enqueues send for appointment.confirmed with the current manageVersion", async () => {
    const slots = await http().get(`/v1/availability?services=${f.pediId}:ANY&date=${BOOKING_DATE}`);
    const slot = (slots.body as Slot[])[0]!;
    const hold = await http().post("/v1/holds").send({ segments: slot.segments });
    expect(hold.status).toBe(201);
    const id = hold.body.holdId as string;
    const res = await authed(http().post("/v1/appointments"), token).send({ holdId: id });
    expect(res.status).toBe(201);

    const manageVersion = await versionOf(id);
    const expected: SendJob = { appointmentId: id, templateKey: "appointment.confirmed", manageVersion };
    const job = await queue.getJob(sendJobId(expected));
    expect(job).toBeDefined();
    expect(job!.name).toBe("send");
    expect(job!.data).toEqual(expected);
    expect(job!.opts).toMatchObject({ attempts: 3, backoff: { type: "exponential", delay: 10_000 } });
    expect(await queue.count()).toBe(1);
  });

  it("reschedule enqueues appointment.changed at version 1", async () => {
    const { id } = await bookSegment(ctx.prisma, f, {
      staffUserId: f.staffA,
      startsAt: "14:00",
      endsAt: "15:00",
      resourceId: f.resource1,
    });
    const slots = await authed(
      http().get(`/v1/availability?services=${f.pediId}:${f.staffA}&date=${BOOKING_DATE}&excludeAppointmentId=${id}`),
      token,
    );
    const target = (slots.body as Slot[]).find(
      (s) => s.startsAt === new Date(Date.parse("2026-12-01T14:15:00.000Z")).toISOString(),
    );
    expect(target).toBeDefined();
    const res = await authed(http().post(`/v1/me/appointments/${id}/reschedule`), token).send({
      segments: target!.segments,
    });
    expect(res.status).toBe(200);

    expect(await versionOf(id)).toBe(1);
    const job = await queue.getJob(
      sendJobId({ appointmentId: id, templateKey: "appointment.changed", manageVersion: 1 }),
    );
    expect(job?.data).toEqual({ appointmentId: id, templateKey: "appointment.changed", manageVersion: 1 });
  });

  it("staff cancel enqueues appointment.cancelled", async () => {
    const reception = await staffSession(ctx.app, ctx.prisma, f, "RECEPTION");
    const { id } = await bookSegment(ctx.prisma, f, {
      staffUserId: f.staffA,
      startsAt: "15:00",
      endsAt: "16:00",
      resourceId: f.resource1,
    });
    const res = await authed(http().post(`/v1/staff/appointments/${id}/status`), reception.token).send({
      status: "CANCELLED",
    });
    expect(res.status).toBe(200);

    const job = await queue.getJob(
      sendJobId({ appointmentId: id, templateKey: "appointment.cancelled", manageVersion: 1 }),
    );
    expect(job?.data).toEqual({ appointmentId: id, templateKey: "appointment.cancelled", manageVersion: 1 });
  });

  it("walk-in enqueues nothing", async () => {
    const reception = await staffSession(ctx.app, ctx.prisma, f, "RECEPTION");
    clock.set(local("10:07"));
    const res = await authed(http().post("/v1/staff/walk-in"), reception.token).send({
      customerId: f.customerId,
      services: [{ serviceId: f.pediId, employeeId: "ANY" }],
    });
    expect(res.status).toBe(201);
    expect(await queue.count()).toBe(0);
  });

  it("a real queue.add accepts a sendJobId id", async () => {
    const data: SendJob = {
      appointmentId: "01934b6e-0000-7000-8000-000000000001",
      templateKey: "appointment.reminder_24h",
      manageVersion: 0,
    };
    const jobId = sendJobId(data, "grant|EMAIL|1");
    await queue.add("send", data, { ...SEND_JOB_OPTIONS, jobId });
    expect((await queue.getJob(jobId))?.data).toEqual(data);
  });
});

describe("QueueBookingEvents: queue failure", () => {
  const clock = fixedClock(BOOKING_NOW);
  const add = vi.fn().mockRejectedValue(new Error("redis down"));
  let ctx: Awaited<ReturnType<typeof createIntegrationApp>>;

  beforeAll(async () => {
    ctx = await createIntegrationApp({
      override: (b) =>
        b
          .overrideProvider(CLOCK)
          .useValue(clock)
          .overrideProvider(NOTIFICATIONS_QUEUE_TOKEN)
          .useValue({ add, close: () => Promise.resolve() }),
    });
  });
  afterAll(async () => {
    await ctx.close();
  });

  it("a queue failure does not fail the booking", async () => {
    await resetState(ctx.prisma, ctx.redis);
    resetTenancyCache(ctx.app);
    const f = await seedBookingFixture(ctx.prisma);
    const { token } = await customerSession(ctx.app, f);
    const http = () => request(ctx.app.getHttpServer());
    const slots = await http().get(`/v1/availability?services=${f.pediId}:ANY&date=${BOOKING_DATE}`);
    const slot = (slots.body as Slot[])[0]!;
    const hold = await http().post("/v1/holds").send({ segments: slot.segments });
    const res = await http()
      .post("/v1/appointments")
      .set("Authorization", `Bearer ${token}`)
      .send({ holdId: hold.body.holdId as string });
    expect(res.status).toBe(201);
    expect(add).toHaveBeenCalledTimes(1);
    expect(await ctx.prisma.appointment.count({ where: { status: "BOOKED" } })).toBe(1);
  });
});
