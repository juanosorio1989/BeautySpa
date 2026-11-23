import { Test, type TestingModule } from "@nestjs/testing";
import type { Job, Queue } from "bullmq";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CLOCK } from "../../../src/common/clock.js";
import { ENV } from "../../../src/config/env.js";
import { MAILER, type MailMessage, type Mailer } from "../../../src/mail/mailer.js";
import { enqueueConsentCatchUp } from "../../../src/notifications/consent-catch-up.js";
import { NotificationsProcessor } from "../../../src/notifications/notifications.processor.js";
import { NOTIFICATIONS_QUEUE_TOKEN } from "../../../src/queue/queue.module.js";
import { sendJobId, type SendJob } from "../../../src/queue/queue-names.js";
import { testEnv } from "../../support/test-env.js";
import { createIntegrationApp, resetState, resetTenancyCache } from "../app.js";
import {
  BOOKING_NOW,
  bookSegment,
  customerSession,
  fixedClock,
  seedBookingFixture,
  type BookingFixture,
} from "../helpers.js";
import { testDatabaseUrl, testRedisUrl } from "../setup.js";
import { WorkerModule } from "../../../src/worker/worker.module.js";

class CapturingMailer implements Mailer {
  sent: MailMessage[] = [];
  async send(msg: MailMessage): Promise<{ id?: string }> {
    this.sent.push(msg);
    return { id: `msg-${this.sent.length}` };
  }
}

const EMAIL = "ana@example.test";

describe("consent catch-up: a late grant sends the missed confirmation", () => {
  const clock = fixedClock(BOOKING_NOW);
  const mailer = new CapturingMailer();
  let ctx: Awaited<ReturnType<typeof createIntegrationApp>>;
  let worker: TestingModule;
  let processor: NotificationsProcessor;
  let queue: Queue;
  let f: BookingFixture;
  let token: string;

  const http = () => request(ctx.app.getHttpServer());
  const patchMe = (body: Record<string, unknown>) =>
    http()
      .patch("/v1/me")
      .set({ Authorization: `Bearer ${token}` })
      .send(body);
  const pending = () => queue.getJobs(["waiting", "delayed", "prioritized", "paused"]);
  /** Runs every queued job through the worker's handlers until the queue is empty. */
  const drain = async () => {
    for (let jobs = await pending(); jobs.length > 0; jobs = await pending()) {
      for (const job of jobs as Job[]) {
        await processor.dispatch(job);
        await job.remove();
      }
    }
  };
  const emailConsents = () =>
    ctx.prisma.notificationConsent.findMany({
      where: { customerId: f.customerId, channel: "EMAIL" },
      orderBy: [{ changedAt: "asc" }, { id: "asc" }],
    });
  const book = (startsAt = "14:00", endsAt = "15:00") =>
    bookSegment(ctx.prisma, f, { staffUserId: f.staffA, startsAt, endsAt });
  const grantJobs = async () => (await pending()).filter((j) => j.id?.includes("|grant|"));

  beforeAll(async () => {
    ctx = await createIntegrationApp({ override: (b) => b.overrideProvider(CLOCK).useValue(clock) });
    queue = ctx.app.get<Queue>(NOTIFICATIONS_QUEUE_TOKEN);
    // Not `init()`: no BullMQ Worker consumes; `drain` drives the handlers.
    worker = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(ENV)
      .useValue(testEnv({ DATABASE_URL: testDatabaseUrl(), REDIS_URL: testRedisUrl() }))
      .overrideProvider(CLOCK)
      .useValue(clock)
      .overrideProvider(MAILER)
      .useValue(mailer)
      .compile();
    processor = worker.get(NotificationsProcessor);
  });
  afterAll(async () => {
    await worker.close();
    await ctx.close();
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    await resetState(ctx.prisma, ctx.redis);
    resetTenancyCache(ctx.app);
    clock.set(BOOKING_NOW);
    mailer.sent = [];
    f = await seedBookingFixture(ctx.prisma);
    token = (await customerSession(ctx.app, f)).token;
  });

  it("consent grant after booking sends one confirmation", async () => {
    const appt = await book();
    // The booking's own confirmation found no channel.
    await processor.handleSend({ appointmentId: appt.id, templateKey: "appointment.confirmed", manageVersion: 0 });
    expect(await ctx.prisma.notificationLog.count()).toBe(0);

    const res = await patchMe({ email: EMAIL, consents: { EMAIL: true }, consentSource: "BOOKING_FORM" });
    expect(res.status).toBe(200);
    const [consent] = await emailConsents();
    const expected: SendJob = {
      appointmentId: appt.id,
      templateKey: "appointment.confirmed",
      manageVersion: 0,
      channels: ["EMAIL"],
    };
    const job = await queue.getJob(sendJobId(expected, `grant|EMAIL|${consent!.id}`));
    expect(job?.data).toEqual(expected);
    expect(job?.opts).toMatchObject({ attempts: 3 });

    await drain();
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.to).toBe(EMAIL);

    expect((await patchMe({ consents: { EMAIL: false } })).status).toBe(200);
    expect((await patchMe({ consents: { EMAIL: true } })).status).toBe(200);
    await drain();
    expect(mailer.sent).toHaveLength(1);
    const logs = await ctx.prisma.notificationLog.findMany();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ channel: "EMAIL", templateKey: "appointment.confirmed", status: "SENT" });
  });

  it("catch-up skips appointments already confirmed on that channel", async () => {
    const confirmed = await book("14:00", "15:00");
    const changed = await book("15:00", "16:00");
    const pushOnly = await book("16:00", "17:00");
    const oldVersion = await book("17:00", "18:00");
    await ctx.prisma.appointment.update({ where: { id: changed.id }, data: { manageVersion: 2 } });
    await ctx.prisma.appointment.update({ where: { id: oldVersion.id }, data: { manageVersion: 1 } });
    const log = (appointmentId: string, templateKey: string, manageVersion: number, channel: "EMAIL" | "PUSH") =>
      ctx.prisma.notificationLog.create({
        data: {
          organizationId: f.orgId,
          appointmentId,
          customerId: f.customerId,
          templateKey,
          manageVersion,
          channel,
          provider: "console",
          locale: "es",
          status: "SENT",
        },
      });
    await log(confirmed.id, "appointment.confirmed", 0, "EMAIL");
    await log(changed.id, "appointment.changed", 2, "EMAIL");
    await log(pushOnly.id, "appointment.confirmed", 0, "PUSH");
    await log(oldVersion.id, "appointment.confirmed", 0, "EMAIL");

    expect((await patchMe({ email: EMAIL, consents: { EMAIL: true } })).status).toBe(200);

    const jobs = await grantJobs();
    expect(jobs.map((j) => (j.data as SendJob).appointmentId).sort()).toEqual([pushOnly.id, oldVersion.id].sort());
    expect(jobs.find((j) => (j.data as SendJob).appointmentId === oldVersion.id)!.data).toMatchObject({
      manageVersion: 1,
      channels: ["EMAIL"],
    });
  });

  it("catch-up ignores past and cancelled appointments", async () => {
    const past = await book("10:00", "11:00");
    const cancelled = await book("14:00", "15:00");
    await ctx.prisma.appointment.update({ where: { id: cancelled.id }, data: { status: "CANCELLED" } });
    const future = await book("16:00", "17:00");
    // 2026-12-01 12:00Z: `past` (10:00Z) already started.
    clock.set(Date.parse("2026-12-01T12:00:00.000Z"));

    expect((await patchMe({ email: EMAIL, consents: { EMAIL: true } })).status).toBe(200);

    const jobs = await grantJobs();
    expect(jobs.map((j) => (j.data as SendJob).appointmentId)).toEqual([future.id]);
    expect(past.id).not.toBe(future.id);
  });

  it("returns the number of jobs added and only touches the given org", async () => {
    await book();
    const [consent] = await ctx.prisma.notificationConsent.createManyAndReturn({
      data: [{ organizationId: f.orgId, customerId: f.customerId, channel: "PUSH", granted: true, source: "PROFILE" }],
    });
    const otherOrg = await ctx.prisma.organization.create({
      data: { name: "Other", slug: "other", defaultLocale: "en" },
    });
    const base = { prisma: ctx.prisma, queue, now: new Date(BOOKING_NOW) };

    expect(
      await enqueueConsentCatchUp({ ...base, organizationId: otherOrg.id }, f.customerId, "PUSH", consent!.id),
    ).toBe(0);
    expect(await enqueueConsentCatchUp({ ...base, organizationId: f.orgId }, f.customerId, "PUSH", consent!.id)).toBe(
      1,
    );
    // Same consent row → same job id → BullMQ keeps one job.
    await enqueueConsentCatchUp({ ...base, organizationId: f.orgId }, f.customerId, "PUSH", consent!.id);
    expect(await grantJobs()).toHaveLength(1);
  });

  it("a failing catch-up never fails PATCH /me", async () => {
    await book();
    vi.spyOn(queue, "add").mockRejectedValue(new Error("redis down"));

    const res = await patchMe({ email: EMAIL, consents: { EMAIL: true } });

    expect(res.status).toBe(200);
    expect(res.body.consents.EMAIL).toBe(true);
    expect(await emailConsents()).toHaveLength(1);
  });
});
