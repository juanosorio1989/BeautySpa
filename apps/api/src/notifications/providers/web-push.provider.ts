import { Logger } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import webpush, { WebPushError, type RequestOptions } from "web-push";
import type { Clock } from "../../common/clock.js";
import type { RenderedMessage } from "../templates/types.js";
import { PushError, type ChannelProvider, type DeliveryTarget } from "./channel-provider.js";

/** Push service TTL for every message: 24 h (design call: reminders and confirmations alike). */
export const PUSH_TTL_SEC = 86_400;

export interface VapidDetails {
  subject: string;
  publicKey: string;
  privateKey: string;
}

/**
 * `PUSH_PROVIDER=webpush`: sends `{ title, body, url }` to every push subscription of the customer (in the
 * target's organization) with TTL 24 h, urgency `high` for `appointment.reminder_2h` else `normal`. A 404/410
 * from the push service deletes that subscription. Succeeds when at least one send succeeds (those rows get
 * `last_success_at`, best effort); otherwise throws `PushError(<last status>)`, or `PushError("none")` without subscriptions.
 * Logs subscription ids only: endpoints identify a device and never reach logs or errors.
 */
export class WebPushProvider implements ChannelProvider {
  readonly channel = "PUSH" as const;
  readonly name = "webpush";
  private readonly logger = new Logger(WebPushProvider.name);

  constructor(
    private readonly db: Pick<PrismaClient, "pushSubscription">,
    private readonly clock: Clock,
    private readonly vapid: VapidDetails,
  ) {}

  async send(msg: RenderedMessage, target: DeliveryTarget): Promise<{ providerMessageId?: string }> {
    const { organizationId, customerId } = target;
    const subs = await this.db.pushSubscription.findMany({
      where: { organizationId, customerId },
      orderBy: { createdAt: "asc" },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
    if (subs.length === 0) throw new PushError("none");

    const payload = JSON.stringify(msg.push);
    const options: RequestOptions = {
      TTL: PUSH_TTL_SEC,
      urgency: target.templateKey === "appointment.reminder_2h" ? "high" : "normal",
      vapidDetails: this.vapid,
    };
    let delivered = false;
    let lastStatus = 0;
    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          options,
        );
      } catch (err) {
        lastStatus = err instanceof WebPushError && Number.isInteger(err.statusCode) ? err.statusCode : 0;
        this.logger.warn(`Push to subscription ${sub.id} failed: push_${lastStatus}`);
        if (lastStatus === 404 || lastStatus === 410) {
          await this.db.pushSubscription
            .deleteMany({ where: { id: sub.id, organizationId } })
            .catch(() => this.logger.warn(`Could not delete expired subscription ${sub.id}`));
        }
        continue;
      }
      delivered = true;
      // Bookkeeping only: a failure here must not turn a delivered push into a retry (a second send).
      await this.db.pushSubscription
        .updateMany({ where: { id: sub.id, organizationId }, data: { lastSuccessAt: new Date(this.clock.now()) } })
        .catch(() => this.logger.warn(`Could not record last_success_at for subscription ${sub.id}`));
    }
    if (!delivered) throw new PushError(lastStatus);
    return {};
  }
}
