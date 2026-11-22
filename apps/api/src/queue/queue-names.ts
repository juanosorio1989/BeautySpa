import type { JobsOptions } from "bullmq";
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
