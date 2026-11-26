import { Test, type TestingModule } from "@nestjs/testing";
import type { Queue } from "bullmq";
import type { Redis } from "ioredis";
import { afterEach, describe, expect, it } from "vitest";
import { lockOrgBookings } from "../../../src/booking/appointment-writer.js";
import { CLOCK, type Clock } from "../../../src/common/clock.js";
import { ENV } from "../../../src/config/env.js";
import { PrismaService } from "../../../src/prisma/prisma.service.js";
import { MAINTENANCE_QUEUE_TOKEN } from "../../../src/queue/queue.module.js";
import { REDIS } from "../../../src/redis/redis.module.js";
import { MaintenanceProcessor } from "../../../src/worker/maintenance.processor.js";
import { WorkerModule } from "../../../src/worker/worker.module.js";
import { testEnv } from "../../support/test-env.js";
import { resetState } from "../app.js";
import { BOOKING_NOW, bookSegment, fixedClock, seedBookingFixture } from "../helpers.js";
import { testDatabaseUrl, testRedisUrl } from "../setup.js";

const MINUTE = 60_000;

/** `WorkerModule` application context (lifecycle hooks run) against the test database and Redis DB. */
async function startWorker(env: Record<string, string> = {}, clock?: Clock): Promise<TestingModule> {
  let builder = Test.createTestingModule({ imports: [WorkerModule] })
    .overrideProvider(ENV)
    .useValue(testEnv({ DATABASE_URL: testDatabaseUrl(), REDIS_URL: testRedisUrl(), ...env }));
  if (clock) builder = builder.overrideProvider(CLOCK).useValue(clock);
  const moduleRef = await builder.compile();
  await moduleRef.init();
  return moduleRef;
}

describe("worker maintenance queue", () => {
  const opened: TestingModule[] = [];
  const start = async (env: Record<string, string> = {}, clock?: Clock) => {
    const m = await startWorker(env, clock);
    opened.push(m);
    return m;
  };
  const reset = (m: TestingModule) => resetState(m.get(PrismaService), m.get<Redis>(REDIS));

  afterEach(async () => {
    while (opened.length > 0) await opened.pop()!.close();
  });

  it("sweep-holds job releases expired holds under the org lock", async () => {
    const worker = await start({}, fixedClock(BOOKING_NOW));
    const prisma = worker.get(PrismaService);
    await reset(worker);
    const f = await seedBookingFixture(prisma);
    const { id } = await bookSegment(prisma, f, { staffUserId: f.staffA, startsAt: "14:00", endsAt: "15:00" });
    await prisma.appointment.update({
      where: { id },
      data: { status: "HELD", customerId: null, holdExpiresAt: new Date(BOOKING_NOW - MINUTE) },
    });

    // Hold the org booking lock in another transaction: the job must wait for it.
    let locked!: () => void;
    let release!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    const gate = new Promise<void>((r) => (release = r));
    const holder = prisma.$transaction(
      async (tx) => {
        await lockOrgBookings(tx, f.orgId);
        locked();
        await gate;
      },
      { timeout: 20_000 },
    );
    await isLocked;

    let finished = false;
    const run = worker
      .get(MaintenanceProcessor)
      .handle("sweep-holds")
      .then((n) => {
        finished = true;
        return n;
      });
    await new Promise((r) => setTimeout(r, 500));
    expect(finished).toBe(false);
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id } })).status).toBe("HELD");

    release();
    await holder;
    expect(await run).toBe(1);

    const row = await prisma.appointment.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("CANCELLED");
    expect(row.cancelReason).toBe("HOLD_EXPIRED");
    const audits = await prisma.auditLog.findMany({ where: { action: "appointment.hold_release" } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ organizationId: f.orgId, actorType: "SYSTEM" });
    expect((audits[0]!.after as { released: number }).released).toBe(1);
  });

  it("scan-reminders job runs the reminder scanner", async () => {
    const worker = await start();
    expect(await worker.get(MaintenanceProcessor).handle("scan-reminders")).toBe(0);
  });

  it("scheduler registered at worker start with the configured interval", async () => {
    const first = await start();
    await reset(first);
    await first.close();
    opened.pop();

    const worker = await start({
      HOLD_SWEEP_INTERVAL_MS: "60000",
      REMINDER_SCAN_INTERVAL_MS: "30000",
      DELIVERY_RECOVERY_INTERVAL_MS: "600000",
    });
    const schedulers = await worker.get<Queue>(MAINTENANCE_QUEUE_TOKEN).getJobSchedulers();
    const byKey = Object.fromEntries(schedulers.map((s) => [s.key, s]));
    expect(Object.keys(byKey).sort()).toEqual(["recover-deliveries", "scan-reminders", "sweep-holds"]);
    expect(byKey["recover-deliveries"]).toMatchObject({ name: "recover-deliveries", every: 600_000 });
    expect(byKey["sweep-holds"]).toMatchObject({ name: "sweep-holds", every: 60_000 });
    expect(byKey["scan-reminders"]).toMatchObject({ name: "scan-reminders", every: 30_000 });
  });

  it("interval 0 removes the scheduler", async () => {
    const first = await start({ HOLD_SWEEP_INTERVAL_MS: "60000", REMINDER_SCAN_INTERVAL_MS: "60000" });
    await reset(first);
    await first.close();
    opened.pop();
    const second = await start({ HOLD_SWEEP_INTERVAL_MS: "60000", REMINDER_SCAN_INTERVAL_MS: "60000" });
    expect(await second.get<Queue>(MAINTENANCE_QUEUE_TOKEN).getJobSchedulersCount()).toBe(2);
    await second.close();
    opened.pop();

    const worker = await start({ HOLD_SWEEP_INTERVAL_MS: "0", REMINDER_SCAN_INTERVAL_MS: "60000" });
    const schedulers = await worker.get<Queue>(MAINTENANCE_QUEUE_TOKEN).getJobSchedulers();
    expect(schedulers.map((s) => s.key)).toEqual(["scan-reminders"]);
  });
});
