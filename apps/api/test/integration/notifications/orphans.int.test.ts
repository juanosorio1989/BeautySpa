import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import { type Job, type Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CLOCK } from "../../../src/common/clock.js";
import { ENV } from "../../../src/config/env.js";
import { OrphanedDeliveries } from "../../../src/notifications/orphaned-deliveries.js";
import { PrismaService } from "../../../src/prisma/prisma.service.js";
import { NOTIFICATIONS_QUEUE_TOKEN } from "../../../src/queue/queue.module.js";
import { DELIVER_JOB_OPTIONS, NOTIFICATIONS_QUEUE } from "../../../src/queue/queue-names.js";
import { REDIS } from "../../../src/redis/redis.module.js";
import { MaintenanceProcessor } from "../../../src/worker/maintenance.processor.js";
import { WorkerModule } from "../../../src/worker/worker.module.js";
import { testEnv } from "../../support/test-env.js";
import { resetState } from "../app.js";
import { BOOKING_NOW, bookSegment, fixedClock, seedBookingFixture, type BookingFixture } from "../helpers.js";
import { testDatabaseUrl, testRedisUrl } from "../setup.js";

const MIN = 60_000;
const H = 60 * MIN;

describe("orphaned QUEUED deliveries", () => {
  const clock = fixedClock(BOOKING_NOW);
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let recovery: OrphanedDeliveries;
  let queue: Queue;
  let f: BookingFixture;
  let apptId: string;
  let version = 0;

  /** A `notification_log` row created `ageMs` before the pinned clock. */
  const logRow = (ageMs: number, status: "QUEUED" | "SENT" = "QUEUED") =>
    prisma.notificationLog.create({
      data: {
        organizationId: f.orgId,
        appointmentId: apptId,
        customerId: f.customerId,
        templateKey: "appointment.confirmed",
        manageVersion: version++,
        channel: "EMAIL",
        provider: "console",
        locale: "es",
        status,
        createdAt: new Date(BOOKING_NOW - ageMs),
      },
    });
  const deliverJob = (logId: string) => queue.getJob(`deliver|${logId}`);
  const addDeliver = (logId: string) =>
    queue.add("deliver", { logId }, { ...DELIVER_JOB_OPTIONS, jobId: `deliver|${logId}` });

  /** Takes the next waiting job off the queue by hand (no processor), runs `use` on it, then closes the worker. */
  async function withNextJob(use: (next: Job, token: string) => Promise<void>) {
    const worker = new Worker(NOTIFICATIONS_QUEUE, null, {
      connection: new Redis(testRedisUrl(), { maxRetriesPerRequest: null }),
      autorun: false,
    });
    try {
      const token = randomUUID();
      const next = (await worker.getNextJob(token)) as Job;
      await use(next, token);
    } finally {
      await worker.close();
    }
  }
  /** Takes the next waiting job off the queue by hand and fails or completes it. */
  const finishNext = (outcome: "failed" | "completed") =>
    withNextJob(async (next, token) => {
      if (outcome === "failed") {
        next.discard();
        await next.moveToFailed(new Error("boom"), token, false);
      } else {
        await next.moveToCompleted("ok", token, false);
      }
      expect(await next.getState()).toBe(outcome);
    });

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(ENV)
      .useValue(testEnv({ DATABASE_URL: testDatabaseUrl(), REDIS_URL: testRedisUrl() }))
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();
    prisma = moduleRef.get(PrismaService);
    recovery = moduleRef.get(OrphanedDeliveries);
    queue = moduleRef.get<Queue>(NOTIFICATIONS_QUEUE_TOKEN);
  });
  afterAll(async () => {
    await moduleRef.close();
  });
  beforeEach(async () => {
    await resetState(prisma, moduleRef.get<Redis>(REDIS));
    clock.set(BOOKING_NOW);
    version = 0;
    f = await seedBookingFixture(prisma);
    apptId = (await bookSegment(prisma, f, { staffUserId: f.staffA, startsAt: "14:00", endsAt: "15:00" })).id;
  });

  it("QUEUED row older than 1 h without a deliver job gets one", async () => {
    const row = await logRow(2 * H);
    expect(await recovery.run()).toBe(1);
    const j = await deliverJob(row.id);
    expect(j?.name).toBe("deliver");
    expect(j?.data).toEqual({ logId: row.id });
    expect(j?.opts.attempts).toBe(DELIVER_JOB_OPTIONS.attempts);
    expect(await j?.getState()).toBe("waiting");
  });

  it("a waiting deliver job is left alone", async () => {
    const row = await logRow(2 * H);
    const before = await addDeliver(row.id);
    expect(await recovery.run()).toBe(0);
    expect((await deliverJob(row.id))?.timestamp).toBe(before.timestamp);
    expect(await queue.count()).toBe(1);
  });

  it("a delayed deliver job is left alone", async () => {
    const row = await logRow(2 * H);
    const before = await queue.add(
      "deliver",
      { logId: row.id },
      { ...DELIVER_JOB_OPTIONS, jobId: `deliver|${row.id}`, delay: 60_000 },
    );
    expect(await recovery.run()).toBe(0);
    const after = await deliverJob(row.id);
    expect(await after?.getState()).toBe("delayed");
    expect(after?.timestamp).toBe(before.timestamp);
  });

  it("an active deliver job is left alone", async () => {
    const row = await logRow(2 * H);
    await addDeliver(row.id);
    await withNextJob(async (next) => {
      expect(await next.getState()).toBe("active");
      expect(await recovery.run()).toBe(0);
      expect(await (await deliverJob(row.id))?.getState()).toBe("active");
    });
  });

  it("a failure on one row does not stop the others", async () => {
    const first = await logRow(3 * H);
    const second = await logRow(2 * H);
    const spy = vi.spyOn(queue, "getJob").mockRejectedValueOnce(new Error("x"));
    try {
      expect(await recovery.run()).toBe(1);
    } finally {
      spy.mockRestore();
    }
    expect(await deliverJob(first.id)).toBeUndefined();
    expect(await (await deliverJob(second.id))?.getState()).toBe("waiting");
  });

  it.each(["failed", "completed"] as const)("a %s deliver job is removed and re-added", async (outcome) => {
    const row = await logRow(2 * H);
    await addDeliver(row.id);
    await finishNext(outcome);

    expect(await recovery.run()).toBe(1);
    expect(await (await deliverJob(row.id))?.getState()).toBe("waiting");
    expect(await queue.getJobCountByTypes("failed", "completed")).toBe(0);
  });

  it("a QUEUED row younger than 1 h or a SENT row is untouched", async () => {
    const young = await logRow(59 * MIN);
    const sent = await logRow(3 * H, "SENT");
    expect(await recovery.run()).toBe(0);
    expect(await deliverJob(young.id)).toBeUndefined();
    expect(await deliverJob(sent.id)).toBeUndefined();
    expect((await prisma.notificationLog.findUniqueOrThrow({ where: { id: young.id } })).status).toBe("QUEUED");
  });

  it("QUEUED row older than 24 h is FAILED orphaned, not re-added", async () => {
    const row = await logRow(24 * H + MIN);
    expect(await recovery.run()).toBe(1);
    expect(await prisma.notificationLog.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      status: "FAILED",
      error: "orphaned",
    });
    expect(await deliverJob(row.id)).toBeUndefined();
  });

  it("maintenance job recover-deliveries runs the recovery", async () => {
    await logRow(2 * H);
    expect(await moduleRef.get(MaintenanceProcessor).handle("recover-deliveries")).toBe(1);
  });
});
