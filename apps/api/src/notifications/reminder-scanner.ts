import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Queue } from "bullmq";
import { CLOCK, type Clock } from "../common/clock.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { NOTIFICATIONS_QUEUE_TOKEN } from "../queue/queue.module.js";
import { enqueueBounded, sendJobId, SEND_JOB_OPTIONS, type SendJob } from "../queue/queue-names.js";
import { REMINDERS, type Reminder } from "./reminder-due.js";

/** Appointments taken per reminder kind per run; the next run picks up the rest. */
const BATCH = 500;

interface DueRow {
  id: string;
  manage_version: number;
}

/** Enqueues due appointment reminders; run by the worker's `scan-reminders` job. */
@Injectable()
export class ReminderScanner {
  private readonly logger = new Logger(ReminderScanner.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(NOTIFICATIONS_QUEUE_TOKEN) private readonly queue: Queue,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * One run: per reminder kind, adds a `send` job for each due appointment (same job id scheme as every other
   * `send`, so repeated scans add nothing). The `send` handler re-checks everything. A failed enqueue is logged
   * and skipped. Returns the number of jobs enqueued.
   */
  async scan(): Promise<number> {
    const now = new Date(this.clock.now());
    let enqueued = 0;
    for (const r of REMINDERS) {
      const rows = await this.due(r, now);
      for (const row of rows) {
        const job: SendJob = { appointmentId: row.id, templateKey: r.key, manageVersion: row.manage_version };
        try {
          await enqueueBounded(this.queue, "send", job, { ...SEND_JOB_OPTIONS, jobId: sendJobId(job) });
          enqueued += 1;
        } catch (err) {
          this.logger.error(`Reminder enqueue failed for appointment ${row.id}: ${(err as Error).message}`);
        }
      }
    }
    return enqueued;
  }

  /**
   * SQL mirror of `isReminderDue`, with `start` = first segment start:
   * `start - offset <= now` -> `start <= now + offset`; `start - offset >= times_set_at` ->
   * `start >= times_set_at + offset`; `now < start - late` -> `start > now + late`.
   */
  private due(r: Reminder, now: Date): Promise<DueRow[]> {
    const offset = `${r.offsetMs} milliseconds`;
    const late = `${r.lateMs} milliseconds`;
    return this.prisma.$queryRaw<DueRow[]>`
      SELECT a.id, a.manage_version
      FROM appointment a
      JOIN LATERAL (
        SELECT min(s.starts_at) AS starts_at FROM appointment_segment s WHERE s.appointment_id = a.id
      ) first ON true
      WHERE a.status = 'BOOKED'
        AND a.customer_id IS NOT NULL
        AND a.source <> 'WALK_IN'
        AND first.starts_at <= ${now}::timestamptz + ${offset}::interval
        AND first.starts_at >= a.times_set_at + ${offset}::interval
        AND first.starts_at > ${now}::timestamptz + ${late}::interval
        AND NOT EXISTS (
          SELECT 1 FROM notification_log n
          WHERE n.appointment_id = a.id AND n.template_key = ${r.key} AND n.manage_version = a.manage_version
        )
      ORDER BY first.starts_at ASC
      LIMIT ${BATCH}`;
  }
}
