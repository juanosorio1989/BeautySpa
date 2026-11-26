import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Queue } from "bullmq";
import { CLOCK, type Clock } from "../common/clock.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { NOTIFICATIONS_QUEUE_TOKEN } from "../queue/queue.module.js";
import { DELIVER_JOB_OPTIONS, enqueueBounded, type DeliverJob } from "../queue/queue-names.js";

/** A `QUEUED` row this old should have a live `deliver` job (5 attempts with backoff end within minutes). */
export const ORPHAN_AFTER_MS = 3_600_000;
/** A `QUEUED` row this old is given up: `FAILED`, error `orphaned`. */
export const ORPHAN_GIVE_UP_MS = 86_400_000;
/** Rows handled per run; the next run picks up the rest. */
const BATCH = 500;
/** States in which a `deliver` job will still run: leave it alone. */
const LIVE = new Set(["waiting", "active", "delayed", "prioritized", "waiting-children"]);

/**
 * Recovers `notification_log` rows left `QUEUED` with no `deliver` job (the `send` handler wrote the row but its
 * enqueue failed, or Redis lost the job). Run by the worker's `recover-deliveries` maintenance job. A system job
 * across organizations, like the reminder scan; every write is by row id and organization.
 */
@Injectable()
export class OrphanedDeliveries {
  private readonly logger = new Logger(OrphanedDeliveries.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(NOTIFICATIONS_QUEUE_TOKEN) private readonly queue: Queue,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * One run, oldest first: a `QUEUED` row older than 24 h → `FAILED`, error `orphaned`. A `QUEUED` row older than
   * 1 h whose `deliver|<id>` job is not waiting, active or delayed → a finished (`completed`/`failed`) job with that
   * id is removed and the `deliver` job added again. Returns the number of rows failed or re-queued; a failure on
   * one row is logged and skipped. With Redis degraded, `enqueueBounded` can wait about 2 s per row, so one run of
   * 500 rows can outlast the 10-minute interval; runs never overlap because maintenance concurrency is 1.
   */
  async run(): Promise<number> {
    const now = this.clock.now();
    const giveUpBefore = new Date(now - ORPHAN_GIVE_UP_MS);
    const rows = await this.prisma.notificationLog.findMany({
      where: { status: "QUEUED", createdAt: { lt: new Date(now - ORPHAN_AFTER_MS) } },
      orderBy: { createdAt: "asc" },
      take: BATCH,
      select: { id: true, organizationId: true, createdAt: true },
    });
    let handled = 0;
    for (const row of rows) {
      try {
        if (row.createdAt < giveUpBefore) {
          const { count } = await this.prisma.notificationLog.updateMany({
            where: { id: row.id, organizationId: row.organizationId, status: "QUEUED" },
            data: { status: "FAILED", error: "orphaned" },
          });
          handled += count;
          continue;
        }
        if (await this.requeue(row.id)) handled += 1;
      } catch (err) {
        this.logger.error(`Orphan recovery failed for row ${row.id}: ${(err as Error).message}`);
      }
    }
    if (handled > 0) this.logger.warn(`Recovered ${handled} orphaned deliveries`);
    return handled;
  }

  /** Adds `deliver|<logId>` unless such a job will still run; removes a finished one first. */
  private async requeue(logId: string): Promise<boolean> {
    const jobId = `deliver|${logId}`;
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (LIVE.has(state)) return false;
      // "unknown": the job was deleted after `getJob`, so there is nothing to remove.
      if (state !== "unknown") await existing.remove();
    }
    const data: DeliverJob = { logId };
    await enqueueBounded(this.queue, "deliver", data, { ...DELIVER_JOB_OPTIONS, jobId });
    return true;
  }
}
