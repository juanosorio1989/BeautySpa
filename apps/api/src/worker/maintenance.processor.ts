import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from "@nestjs/common";
import { type Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { HoldSweeper } from "../booking/hold-sweeper.js";
import { ENV, type Env } from "../config/env.js";
import { OrphanedDeliveries } from "../notifications/orphaned-deliveries.js";
import { ReminderScanner } from "../notifications/reminder-scanner.js";
import { MAINTENANCE_QUEUE_TOKEN } from "../queue/queue.module.js";
import { MAINTENANCE_QUEUE } from "../queue/queue-names.js";

/** Repeatable maintenance jobs and the env key holding each one's period in ms (0 = not scheduled). */
const SCHEDULES = [
  { name: "sweep-holds", every: "HOLD_SWEEP_INTERVAL_MS" },
  { name: "scan-reminders", every: "REMINDER_SCAN_INTERVAL_MS" },
  { name: "recover-deliveries", every: "DELIVERY_RECOVERY_INTERVAL_MS" },
] as const;

/** Maintenance runs are frequent and carry no data: keep the last 100 completed, failed for 7 days. */
const MAINTENANCE_JOB_OPTIONS = { removeOnComplete: { count: 100 }, removeOnFail: { age: 604_800 } };

/**
 * Worker process only (never the API): at start, upserts (or removes, for interval 0) the job schedulers
 * of queue `maintenance`, then consumes it with a BullMQ `Worker`.
 */
@Injectable()
export class MaintenanceProcessor implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MaintenanceProcessor.name);
  private worker: Worker | undefined;
  private connection: Redis | undefined;

  constructor(
    @Inject(MAINTENANCE_QUEUE_TOKEN) private readonly queue: Queue,
    @Inject(ENV) private readonly env: Env,
    private readonly sweeper: HoldSweeper,
    private readonly reminders: ReminderScanner,
    private readonly orphans: OrphanedDeliveries,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const s of SCHEDULES) {
      const every = this.env[s.every];
      if (every > 0) {
        await this.queue.upsertJobScheduler(s.name, { every }, { name: s.name, opts: MAINTENANCE_JOB_OPTIONS });
        this.logger.log(`Scheduled ${s.name} every ${every} ms`);
      } else {
        await this.queue.removeJobScheduler(s.name);
        this.logger.log(`${s.name} not scheduled (${s.every}=0)`);
      }
    }
    this.connection = new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: null });
    // One maintenance job at a time: sweeps and scans must not overlap.
    this.worker = new Worker(MAINTENANCE_QUEUE, (job) => this.handle(job.name), {
      connection: this.connection,
      concurrency: 1,
    });
    this.worker.on("failed", (job, err) =>
      this.logger.error(`Maintenance job ${job?.name ?? "?"} failed: ${err.message}`),
    );
    this.worker.on("error", (err) => this.logger.error(`Maintenance worker error: ${err.message}`));
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.connection?.quit();
    this.worker = undefined;
    this.connection = undefined;
  }

  /**
   * Runs one maintenance job by name; returns the count it handled (holds released, reminders enqueued, orphaned
   * deliveries failed or re-queued).
   */
  handle(name: string): Promise<number> {
    switch (name) {
      case "sweep-holds":
        return this.sweeper.sweep();
      case "scan-reminders":
        return this.reminders.scan();
      case "recover-deliveries":
        return this.orphans.run();
      default:
        return Promise.reject(new Error(`Unknown maintenance job: ${name}`));
    }
  }
}
