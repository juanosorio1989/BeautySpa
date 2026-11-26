import { Test, type TestingModule } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { type Job, type Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CLOCK } from "../../../src/common/clock.js";
import { ENV } from "../../../src/config/env.js";
import { ReminderScanner } from "../../../src/notifications/reminder-scanner.js";
import type { TemplateKey } from "../../../src/notifications/templates/types.js";
import { PrismaService } from "../../../src/prisma/prisma.service.js";
import { NOTIFICATIONS_QUEUE_TOKEN } from "../../../src/queue/queue.module.js";
import { NOTIFICATIONS_QUEUE, sendJobId } from "../../../src/queue/queue-names.js";
import { REDIS } from "../../../src/redis/redis.module.js";
import { WorkerModule } from "../../../src/worker/worker.module.js";
import { testEnv } from "../../support/test-env.js";
import { resetState } from "../app.js";
import { BOOKING_NOW, bookSegment, fixedClock, seedBookingFixture, type BookingFixture } from "../helpers.js";
import { testDatabaseUrl, testRedisUrl } from "../setup.js";

const H = 3_600_000;
/** Appointment starts 2026-12-01T14:00Z. */
const S = Date.parse("2026-12-01T14:00:00.000Z");

describe("reminder scan", () => {
  const clock = fixedClock(BOOKING_NOW);
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let scanner: ReminderScanner;
  let queue: Queue;
  let f: BookingFixture;
  let apptId: string;

  const job = (key: TemplateKey, manageVersion = 0, id = apptId) =>
    queue.getJob(sendJobId({ appointmentId: id, templateKey: key, manageVersion }));

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(ENV)
      .useValue(testEnv({ DATABASE_URL: testDatabaseUrl(), REDIS_URL: testRedisUrl() }))
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();
    prisma = moduleRef.get(PrismaService);
    scanner = moduleRef.get(ReminderScanner);
    queue = moduleRef.get<Queue>(NOTIFICATIONS_QUEUE_TOKEN);
  });
  afterAll(async () => {
    await moduleRef.close();
  });
  beforeEach(async () => {
    await resetState(prisma, moduleRef.get<Redis>(REDIS));
    clock.set(S - 24 * H);
    f = await seedBookingFixture(prisma);
    apptId = (await bookSegment(prisma, f, { staffUserId: f.staffA, startsAt: "14:00", endsAt: "15:00" })).id;
    // A sendable channel (EMAIL consent + email): the scan skips customers who cannot receive anything.
    await prisma.customer.update({ where: { id: f.customerId }, data: { email: "ana@example.test" } });
    await consent("EMAIL", true);
  });

  let consentAt = 0;
  async function consent(channel: "EMAIL" | "PUSH", granted: boolean) {
    consentAt += 1;
    await prisma.notificationConsent.create({
      data: {
        organizationId: f.orgId,
        customerId: f.customerId,
        channel,
        granted,
        source: "PROFILE",
        changedAt: new Date(Date.parse("2026-11-20T00:00:00.000Z") + consentAt * 1000),
      },
    });
  }

  /** Takes the next waiting job off the queue by hand (no processor) and fails or completes it. */
  async function finishNext(outcome: "failed" | "completed") {
    const worker = new Worker(NOTIFICATIONS_QUEUE, null, {
      connection: new Redis(testRedisUrl(), { maxRetriesPerRequest: null }),
      autorun: false,
    });
    try {
      const token = randomUUID();
      const next = (await worker.getNextJob(token)) as Job;
      expect(next).toBeDefined();
      if (outcome === "failed") {
        next.discard(); // last attempt: straight to `failed`, no retry
        await next.moveToFailed(new Error("boom"), token, false);
      } else await next.moveToCompleted("ok", token, false);
      expect(await next.getState()).toBe(outcome);
    } finally {
      await worker.close();
    }
  }

  it("scan enqueues due 24h reminder once", async () => {
    expect(await scanner.scan()).toBe(1);
    expect(await scanner.scan()).toBe(1); // same job id: BullMQ deduplicates the add
    const j = await job("appointment.reminder_24h");
    expect(j?.name).toBe("send");
    expect(j?.data).toEqual({ appointmentId: apptId, templateKey: "appointment.reminder_24h", manageVersion: 0 });
    expect(await queue.getJobCountByTypes("waiting", "delayed", "active")).toBe(1);
    expect(await job("appointment.reminder_2h")).toBeUndefined();
  });

  it("not due yet enqueues nothing", async () => {
    clock.set(S - 24 * H - 1);
    expect(await scanner.scan()).toBe(0);
  });

  it("rescheduled appointment gets reminders for the new version only", async () => {
    await prisma.appointment.update({
      where: { id: apptId },
      data: { manageVersion: 1, timesSetAt: new Date(S - 30 * H) },
    });
    await scanner.scan();
    expect(await job("appointment.reminder_24h", 0)).toBeUndefined();
    expect((await job("appointment.reminder_24h", 1))?.data.manageVersion).toBe(1);
    // Booked at S-1h: neither reminder qualifies.
    await prisma.appointment.update({ where: { id: apptId }, data: { manageVersion: 2, timesSetAt: new Date(S - H) } });
    clock.set(S - H);
    await scanner.scan();
    expect(await job("appointment.reminder_24h", 2)).toBeUndefined();
    expect(await job("appointment.reminder_2h", 2)).toBeUndefined();
  });

  it("cancelled appointment gets none", async () => {
    await prisma.appointment.update({ where: { id: apptId }, data: { status: "CANCELLED" } });
    expect(await scanner.scan()).toBe(0);
  });

  it("already logged reminder is not re-enqueued", async () => {
    await prisma.notificationLog.create({
      data: {
        organizationId: f.orgId,
        appointmentId: apptId,
        customerId: f.customerId,
        templateKey: "appointment.reminder_24h",
        manageVersion: 0,
        channel: "EMAIL",
        provider: "console",
        locale: "es",
        status: "SENT",
      },
    });
    expect(await scanner.scan()).toBe(0);
  });

  it("walk-in gets none", async () => {
    await prisma.appointment.update({ where: { id: apptId }, data: { source: "WALK_IN" } });
    expect(await scanner.scan()).toBe(0);
  });

  it("customerless appointment gets none", async () => {
    await prisma.appointment.update({ where: { id: apptId }, data: { customerId: null } });
    expect(await scanner.scan()).toBe(0);
  });

  it("2h reminder enqueued in its window, and 24h one is dropped once the 2h is due", async () => {
    clock.set(S - 2 * H);
    expect(await scanner.scan()).toBe(1);
    expect(await job("appointment.reminder_2h")).toBeDefined();
    expect(await job("appointment.reminder_24h")).toBeUndefined();
  });

  it("customer without a sendable channel is not scanned", async () => {
    // EMAIL consent revoked: nothing to send.
    await consent("EMAIL", false);
    expect(await scanner.scan()).toBe(0);
    // EMAIL consent granted but no email.
    await consent("EMAIL", true);
    await prisma.customer.update({ where: { id: f.customerId }, data: { email: null } });
    expect(await scanner.scan()).toBe(0);
    // PUSH consent without a subscription.
    await consent("PUSH", true);
    expect(await scanner.scan()).toBe(0);
    // PUSH consent and a subscription.
    await prisma.pushSubscription.create({
      data: {
        organizationId: f.orgId,
        customerId: f.customerId,
        endpoint: "https://fcm.googleapis.com/fcm/send/r1",
        p256dh: "k",
        auth: "a",
      },
    });
    expect(await scanner.scan()).toBe(1);
    expect(await job("appointment.reminder_24h")).toBeDefined();
  });

  it("customers without a channel do not crowd out sendable ones", async () => {
    await prisma.customer.update({ where: { id: f.customerId }, data: { email: null } });
    const other = await prisma.customer.create({
      data: {
        organizationId: f.orgId,
        phoneE164: "+13055550199",
        name: "Bea",
        email: "bea@example.test",
        locale: "en",
        createdVia: "ONLINE",
      },
    });
    await prisma.notificationConsent.create({
      data: { organizationId: f.orgId, customerId: other.id, channel: "EMAIL", granted: true, source: "PROFILE" },
    });
    const otherAppt = await bookSegment(prisma, f, { staffUserId: f.staffB, startsAt: "14:00", endsAt: "15:00" });
    await prisma.appointment.update({ where: { id: otherAppt.id }, data: { customerId: other.id } });

    expect(await scanner.scan()).toBe(1);
    expect(await job("appointment.reminder_24h", 0, otherAppt.id)).toBeDefined();
    expect(await job("appointment.reminder_24h")).toBeUndefined();
  });

  it.each(["failed", "completed"] as const)("a %s send job with the id is removed and re-added", async (outcome) => {
    expect(await scanner.scan()).toBe(1);
    await finishNext(outcome);

    expect(await scanner.scan()).toBe(1);

    const j = await job("appointment.reminder_24h");
    expect(await j?.getState()).toBe("waiting");
    expect(await queue.getJobCountByTypes("failed", "completed")).toBe(0);
  });

  it("a waiting send job is left alone", async () => {
    expect(await scanner.scan()).toBe(1);
    const before = await job("appointment.reminder_24h");
    expect(await scanner.scan()).toBe(1);
    const after = await job("appointment.reminder_24h");
    expect(after?.timestamp).toBe(before?.timestamp);
    expect(await queue.getJobCountByTypes("waiting")).toBe(1);
  });

  it("2h reminder not sent after the start", async () => {
    clock.set(S);
    expect(await scanner.scan()).toBe(0);
  });
});
