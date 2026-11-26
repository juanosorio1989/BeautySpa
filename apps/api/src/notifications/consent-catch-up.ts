import type { Logger } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import type { Queue } from "bullmq";
import { enqueueBounded, SEND_JOB_OPTIONS, sendJobId, type SendJob } from "../queue/queue-names.js";
import type { TemplateKey } from "./templates/types.js";

/** A confirmation already went out on a channel when either of these has a log row at the current version. */
const CONFIRMING: TemplateKey[] = ["appointment.confirmed", "appointment.changed"];

export interface CatchUpDeps {
  prisma: Pick<PrismaClient, "appointment" | "notificationLog">;
  queue: Queue;
  /** From `Clock`, read after the consent commit. */
  now: Date;
  /** The customer's organization: every read is scoped to it. */
  organizationId: string;
}

/**
 * Consent catch-up (notifications spec, "Consent granted after booking"): after a customer's `EMAIL` or `PUSH`
 * consent turns granted, adds one `send` job for `appointment.confirmed` limited to that channel for each of
 * their `BOOKED`, non-walk-in appointments whose first segment starts after `now` and that have no
 * `notification_log` row on that channel at the current `manage_version` for `appointment.confirmed` or
 * `appointment.changed`. Job id `sendJobId(job, "grant|<channel>|<consentRowId>")`, so a repeat for the same
 * consent row is dropped by BullMQ; the log's unique key still prevents a double send. Adds are bounded
 * (`enqueueBounded`) and run in parallel. Returns the number of jobs added. Callers run it after commit and
 * swallow its errors: it must never fail the request.
 */
export async function enqueueConsentCatchUp(
  deps: CatchUpDeps,
  customerId: string,
  channel: "EMAIL" | "PUSH",
  consentRowId: string,
): Promise<number> {
  const { prisma, queue, now, organizationId } = deps;
  // First start > now ⇔ at least one segment and none starting at or before now.
  const appointments = await prisma.appointment.findMany({
    where: {
      organizationId,
      customerId,
      status: "BOOKED",
      source: { not: "WALK_IN" },
      segments: { some: {}, none: { startsAt: { lte: now } } },
    },
    select: { id: true, manageVersion: true },
  });
  if (appointments.length === 0) return 0;

  const logs = await prisma.notificationLog.findMany({
    where: {
      organizationId,
      appointmentId: { in: appointments.map((a) => a.id) },
      channel,
      templateKey: { in: CONFIRMING },
    },
    select: { appointmentId: true, manageVersion: true },
  });
  const confirmed = new Set(logs.map((l) => `${l.appointmentId}|${l.manageVersion}`));
  const missing = appointments.filter((a) => !confirmed.has(`${a.id}|${a.manageVersion}`));

  await Promise.all(
    missing.map((a) => {
      const job: SendJob = {
        appointmentId: a.id,
        templateKey: "appointment.confirmed",
        manageVersion: a.manageVersion,
        channels: [channel],
      };
      return enqueueBounded(queue, "send", job, {
        ...SEND_JOB_OPTIONS,
        jobId: sendJobId(job, `grant|${channel}|${consentRowId}`),
      });
    }),
  );
  return missing.length;
}

/** A consent that just turned granted on a channel this plan sends on. */
export interface ConsentGrant {
  channel: "EMAIL" | "PUSH";
  id: string;
}

/**
 * Runs `enqueueConsentCatchUp` for each grant, after commit. Errors are logged and swallowed (same rule as
 * `notifyAfterCommit`): the consent is already stored and the response must not change.
 */
export async function catchUpAfterCommit(
  deps: CatchUpDeps,
  logger: Logger,
  customerId: string,
  grants: ConsentGrant[],
): Promise<void> {
  for (const grant of grants) {
    try {
      await enqueueConsentCatchUp(deps, customerId, grant.channel, grant.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Consent catch-up ${grant.channel} for consent ${grant.id} failed after commit: ${message}`);
    }
  }
}

/** The granted `EMAIL`/`PUSH` rows among those `recordConsents` appended for `wanted`. */
export function sendableGrants(
  recorded: { channel: string; id: string }[],
  wanted: Partial<Record<string, boolean>>,
): ConsentGrant[] {
  return recorded.flatMap((r) =>
    (r.channel === "EMAIL" || r.channel === "PUSH") && wanted[r.channel] === true
      ? [{ channel: r.channel, id: r.id }]
      : [],
  );
}
