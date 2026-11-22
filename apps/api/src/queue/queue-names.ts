import type { Job, JobsOptions, Queue } from "bullmq";
import type { TemplateKey } from "../notifications/templates/types.js";

/** Queue of `send` (router) and `deliver` (one channel) notification jobs. */
export const NOTIFICATIONS_QUEUE = "notifications";
/** Queue of the repeatable `sweep-holds` and `scan-reminders` jobs. */
export const MAINTENANCE_QUEUE = "maintenance";

/** `send` job: route one template of one appointment version to the customer's channels. */
export interface SendJob {
  appointmentId: string;
  templateKey: TemplateKey;
  manageVersion: number;
  /** Limits the router to these channels (consent catch-up); all consented channels when absent. */
  channels?: ("EMAIL" | "PUSH")[];
}

/** `deliver` job: send one `notification_log` row through its channel's provider. */
export interface DeliverJob {
  logId: string;
}

/**
 * Deterministic `send` job id `send|<appointmentId>|<templateKey>|<manageVersion>` (+ `|<suffix>`), so BullMQ
 * drops a duplicate add. `|`, never `:`: BullMQ 5 rejects `:` in custom job ids.
 */
export function sendJobId(j: SendJob, suffix?: string): string {
  const id = `send|${j.appointmentId}|${j.templateKey}|${j.manageVersion}`;
  return suffix === undefined ? id : `${id}|${suffix}`;
}

const RETENTION = { removeOnComplete: { age: 86_400 }, removeOnFail: { age: 604_800 } } satisfies JobsOptions;

/** `send`: 3 attempts, exponential backoff from 10 s; completed kept 1 day, failed 7 days. */
export const SEND_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential", delay: 10_000 },
  ...RETENTION,
} satisfies JobsOptions;

/** `deliver`: 5 attempts, exponential backoff from 30 s; completed kept 1 day, failed 7 days. */
export const DELIVER_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: "exponential", delay: 30_000 },
  ...RETENTION,
} satisfies JobsOptions;

/** Longest the API waits for a `Queue.add`: with Redis down it never settles (`maxRetriesPerRequest: null`). */
export const ENQUEUE_TIMEOUT_MS = 2000;

/**
 * `queue.add(name, data, opts)` bounded by `ENQUEUE_TIMEOUT_MS`: rejects with `Error("QUEUE_TIMEOUT")` when the add
 * has not settled by then, so an API request awaiting it (through `notifyAfterCommit`) never hangs. The timer is
 * cleared as soon as the add settles. Use it for every enqueue from the API process.
 */
export function enqueueBounded<T>(queue: Queue, name: string, data: T, opts?: JobsOptions): Promise<Job> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("QUEUE_TIMEOUT")), ENQUEUE_TIMEOUT_MS);
  });
  // `new Promise` turns a synchronous throw of `add` into a rejection, so the timer is still cleared.
  const added = new Promise<Job>((resolve) => resolve(queue.add(name, data, opts) as Promise<Job>)).finally(() =>
    clearTimeout(timer),
  );
  return Promise.race([added, timeout]);
}
