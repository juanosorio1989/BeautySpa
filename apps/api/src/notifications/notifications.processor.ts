import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from "@nestjs/common";
import type { NotificationLog } from "@prisma/client";
import { type Job, type Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { CLOCK, type Clock } from "../common/clock.js";
import { isUniqueViolation } from "../common/db-errors.js";
import { ENV, type Env } from "../config/env.js";
import { currentConsents } from "../customers/consents.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { NOTIFICATIONS_QUEUE_TOKEN } from "../queue/queue.module.js";
import {
  DELIVER_JOB_OPTIONS,
  enqueueBounded,
  NOTIFICATIONS_QUEUE,
  type DeliverJob,
  type SendJob,
} from "../queue/queue-names.js";
import { errorCode } from "./error-code.js";
import { appointmentIcsEvent } from "./appointment-ics.js";
import { buildIcs } from "./ics.js";
import { manageUrl, signManageToken } from "./manage-token.js";
import { MessageContextService, messageLocale, statusFits, type LoadedAppointment } from "./message-context.service.js";
import { CHANNEL_PROVIDERS, type ChannelProvider, type DeliveryTarget } from "./providers/channel-provider.js";
import { selectChannels, type SendChannel } from "./router.js";
import { renderMessage } from "./templates/render.js";
import type { MessageContext, RenderedMessage, TemplateKey } from "./templates/types.js";

/** Notification jobs handled in parallel per worker process (maintenance stays at 1). */
export const NOTIFICATIONS_CONCURRENCY = 5;

/** The address part of `EMAIL_FROM` (`Name <addr>` or `addr`); unset (dev/test) → `no-reply@<WEB_ORIGIN host>`. */
export function organizerEmail(env: Pick<Env, "EMAIL_FROM" | "WEB_ORIGIN">): string {
  const from = env.EMAIL_FROM?.trim();
  if (!from) return `no-reply@${new URL(env.WEB_ORIGIN).hostname}`;
  return (/<([^<>]+)>\s*$/.exec(from)?.[1] ?? from).trim();
}

/** Why a delivery is no longer wanted; `null` when the appointment still fits the row. */
function staleReason(row: NotificationLog, a: LoadedAppointment | null): string | null {
  if (!a || a.manageVersion !== row.manageVersion) return "stale";
  if (!a.customer || a.customer.deletedAt !== null || a.customer.id !== row.customerId) return "stale";
  if (a.source === "WALK_IN" || !statusFits(row.templateKey as TemplateKey, a.status)) return "stale";
  return null;
}

/**
 * Worker side of queue `notifications`. `send` routes one template of one appointment version to the
 * customer's consented channels, writing one `notification_log` row per channel (unique on appointment,
 * template, version, channel) and one `deliver` job per new row. `deliver` renders and sends one row through
 * its channel's provider and records the outcome. Worker process only (never the API).
 */
@Injectable()
export class NotificationsProcessor implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsProcessor.name);
  private worker: Worker | undefined;
  private connection: Redis | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly contexts: MessageContextService,
    @Inject(ENV) private readonly env: Env,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(NOTIFICATIONS_QUEUE_TOKEN) private readonly queue: Queue,
    @Inject(CHANNEL_PROVIDERS) private readonly providers: ChannelProvider[],
  ) {}

  onApplicationBootstrap(): void {
    this.connection = new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: null });
    this.worker = new Worker(NOTIFICATIONS_QUEUE, (job) => this.dispatch(job), {
      connection: this.connection,
      concurrency: NOTIFICATIONS_CONCURRENCY,
    });
    // Job ids and error messages only: never job data that could hold contact details.
    this.worker.on("failed", (job, err) =>
      this.logger.warn(`Notification job ${job?.id ?? "?"} failed: ${errorCode(err)}`),
    );
    this.worker.on("error", (err) => this.logger.error(`Notifications worker error: ${err.message}`));
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.connection?.quit();
    this.worker = undefined;
    this.connection = undefined;
  }

  /** Runs one job by name; `deliver` gets the attempt numbers from BullMQ. */
  dispatch(job: Job): Promise<void> {
    switch (job.name) {
      case "send":
        return this.handleSend(job.data as SendJob);
      case "deliver":
        return this.handleDeliver(job.data as DeliverJob, job.attemptsMade, job.opts.attempts ?? 1);
      default:
        return Promise.reject(new Error(`Unknown notifications job: ${job.name}`));
    }
  }

  /**
   * Stops silently when the appointment is gone, its `manageVersion` differs from the job's, the customer is
   * null or deleted, it is a walk-in, or its status does not fit the template. Otherwise inserts one `QUEUED`
   * row per selected channel, one at a time: a unique conflict means that channel was already handled. A new
   * row, or a conflicting row still `QUEUED` (an earlier attempt of this job may have failed before its
   * enqueue), gets a `deliver` job with id `deliver|<logId>`, so BullMQ drops duplicates. The appointment
   * (by id) is the root; every later read and write is scoped to `a.organizationId`.
   */
  async handleSend(job: SendJob): Promise<void> {
    const a = await this.contexts.load(job.appointmentId);
    const customer = a?.customer;
    if (!a || a.manageVersion !== job.manageVersion || !customer || customer.deletedAt !== null) {
      this.logger.debug(`send ${job.templateKey} for ${job.appointmentId}: stale or no customer, skipped`);
      return;
    }
    if (a.source === "WALK_IN" || !statusFits(job.templateKey, a.status)) {
      this.logger.debug(`send ${job.templateKey} for ${job.appointmentId}: status ${a.status}, skipped`);
      return;
    }

    const consents = await currentConsents(this.prisma, customer.id, a.organizationId);
    const subscriptions = await this.prisma.pushSubscription.count({
      where: { organizationId: a.organizationId, customerId: customer.id },
    });
    const channels = selectChannels(
      consents,
      { email: customer.email !== null, push: subscriptions > 0 },
      job.channels,
    );

    for (const channel of channels) {
      const provider = this.provider(channel);
      let logId: string;
      try {
        const row = await this.prisma.notificationLog.create({
          data: {
            organizationId: a.organizationId,
            appointmentId: a.id,
            customerId: customer.id,
            templateKey: job.templateKey,
            manageVersion: a.manageVersion,
            channel,
            provider: provider.name,
            locale: messageLocale(customer.locale),
            status: "QUEUED",
          },
          select: { id: true },
        });
        logId = row.id;
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        const existing = await this.prisma.notificationLog.findFirst({
          where: {
            organizationId: a.organizationId,
            appointmentId: a.id,
            templateKey: job.templateKey,
            manageVersion: a.manageVersion,
            channel,
          },
          select: { id: true, status: true },
        });
        if (existing?.status !== "QUEUED") continue;
        logId = existing.id;
      }
      const data: DeliverJob = { logId };
      await enqueueBounded(this.queue, "deliver", data, { ...DELIVER_JOB_OPTIONS, jobId: `deliver|${logId}` });
    }
  }

  /**
   * Delivers one row. Only a `QUEUED` row is sent. Reads are scoped to the row's organization. Consent for the
   * row's channel revoked since → `SKIPPED` (`consent_revoked`); appointment changed (version, status, customer
   * deleted) → `SKIPPED` (`stale`); an EMAIL row whose customer no longer has an email → `SKIPPED`
   * (`no_email`). Renders in the row's locale; a render (or `.ics`) failure → `FAILED` (`render_failed`), not
   * retried. Success → `SENT`. A provider error → `attempts + 1`, `error = errorCode(err)`, `FAILED` on the last
   * attempt (`attemptsMade + 1 >= maxAttempts`) else still `QUEUED`; then rethrows so BullMQ retries. Any other
   * error before the send (database, Redis) is rethrown too, and on the last attempt first marks the row
   * `FAILED`, so no row stays `QUEUED` after BullMQ gives up. A failure to record `SENT` after the provider
   * accepted the message is logged as `sent_update_failed` and rethrown (the retry may send again:
   * at-least-once).
   */
  async handleDeliver(job: DeliverJob, attemptsMade: number, maxAttempts: number): Promise<void> {
    const last = attemptsMade + 1 >= maxAttempts;
    let prepared: Awaited<ReturnType<NotificationsProcessor["prepare"]>>;
    try {
      prepared = await this.prepare(job.logId);
    } catch (err) {
      const code = errorCode(err);
      this.logger.warn(`deliver ${job.logId}: ${code} before send (attempt ${attemptsMade + 1}/${maxAttempts})`);
      if (last) {
        await this.prisma.notificationLog
          .updateMany({
            where: { id: job.logId, status: "QUEUED" },
            data: { status: "FAILED", error: code, attempts: { increment: 1 } },
          })
          .catch(() => this.logger.error(`deliver ${job.logId}: could not mark FAILED`));
      }
      throw err;
    }
    if (!prepared) return;
    const { row, channel, msg, target } = prepared;

    let providerMessageId: string | undefined;
    try {
      ({ providerMessageId } = await this.provider(channel).send(msg, target));
    } catch (err) {
      const code = errorCode(err);
      await this.prisma.notificationLog.updateMany({
        where: { id: row.id, status: "QUEUED" },
        data: { status: last ? "FAILED" : "QUEUED", error: code, attempts: { increment: 1 } },
      });
      this.logger.warn(`deliver ${row.id}: ${code} (attempt ${attemptsMade + 1}/${maxAttempts})`);
      throw err;
    }

    try {
      await this.prisma.notificationLog.update({
        where: { id: row.id },
        data: {
          status: "SENT",
          sentAt: new Date(this.clock.now()),
          providerMessageId: providerMessageId ?? null,
          error: null,
          attempts: { increment: 1 },
        },
      });
    } catch (err) {
      this.logger.error(`deliver ${row.id}: sent_update_failed`);
      throw err;
    }
  }

  /**
   * Everything before the provider call: loads and checks the row, skips or fails it when it must not be sent,
   * and renders. Returns `null` when the row is done (not queued, skipped, render failed).
   */
  private async prepare(logId: string): Promise<{
    row: NotificationLog;
    channel: SendChannel;
    msg: RenderedMessage;
    target: DeliveryTarget;
  } | null> {
    const row = await this.prisma.notificationLog.findUnique({ where: { id: logId } });
    if (!row || row.status !== "QUEUED") return null;
    if (row.appointmentId === null || row.customerId === null) return this.skip(row, "stale");

    const consents = await currentConsents(this.prisma, row.customerId, row.organizationId);
    if (!consents[row.channel]) return this.skip(row, "consent_revoked");

    const a = await this.contexts.load(row.appointmentId, row.organizationId);
    const stale = staleReason(row, a);
    if (stale !== null || !a?.customer) return this.skip(row, stale ?? "stale");
    if (row.channel === "EMAIL" && a.customer.email === null) return this.skip(row, "no_email");

    const channel = row.channel as SendChannel;
    try {
      return { row, channel, ...this.compose(a, row.templateKey as TemplateKey, channel, messageLocale(row.locale)) };
    } catch {
      await this.prisma.notificationLog.updateMany({
        where: { id: row.id, status: "QUEUED" },
        data: { status: "FAILED", error: "render_failed", attempts: { increment: 1 } },
      });
      this.logger.warn(`deliver ${row.id}: render_failed`);
      return null;
    }
  }

  /** Renders the message and, for EMAIL confirmed/changed/cancelled, the `.ics` (REQUEST or CANCEL). */
  private compose(
    a: LoadedAppointment,
    key: TemplateKey,
    channel: SendChannel,
    locale: MessageContext["locale"],
  ): { msg: RenderedMessage; target: DeliveryTarget } {
    const customer = a.customer!;
    const token = signManageToken(this.env.MANAGE_LINK_SECRET, {
      appointmentId: a.id,
      manageVersion: a.manageVersion,
      exp: Math.floor(a.start.getTime() / 1000),
    });
    const ctx = this.contexts.toContext(
      a,
      manageUrl(this.env.WEB_ORIGIN, locale, token),
      this.contexts.bookUrl(locale),
      locale,
    );
    const msg = renderMessage(key, ctx);
    const target: DeliveryTarget = { customerId: customer.id, email: customer.email, templateKey: key };

    const method =
      key === "appointment.confirmed" || key === "appointment.changed"
        ? "REQUEST"
        : key === "appointment.cancelled"
          ? "CANCEL"
          : null;
    if (channel === "EMAIL" && method !== null) {
      const content = buildIcs(
        appointmentIcsEvent(a, ctx, {
          dtstamp: new Date(this.clock.now()),
          url: method === "CANCEL" ? ctx.bookUrl : ctx.manageUrl,
          status: method === "CANCEL" ? "CANCELLED" : "CONFIRMED",
        }),
        { method, organizerEmail: organizerEmail(this.env), attendeeEmail: customer.email ?? undefined },
      );
      target.ics = { content, method };
    }
    return { msg, target };
  }

  private async skip(row: NotificationLog, reason: string): Promise<null> {
    await this.prisma.notificationLog.updateMany({
      where: { id: row.id, status: "QUEUED" },
      data: { status: "SKIPPED", error: reason },
    });
    this.logger.debug(`deliver ${row.id}: skipped (${reason})`);
    return null;
  }

  private provider(channel: SendChannel): ChannelProvider {
    const p = this.providers.find((x) => x.channel === channel);
    if (!p) throw new Error(`No provider for channel ${channel}`);
    return p;
  }
}
