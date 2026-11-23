import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { Queue } from "bullmq";
import type { AccessClaims, PushSubscriptionInput, PushUnsubscribeInput } from "@beautyspa/contracts";
import { AuditService } from "../audit/audit.service.js";
import { CLOCK, type Clock } from "../common/clock.js";
import { notFound } from "../common/http-errors.js";
import { assertLiveCustomer } from "../common/live-customer.js";
import { ENV, type Env } from "../config/env.js";
import { recordConsents, type RecordedConsent } from "../customers/consents.js";
import { catchUpAfterCommit, sendableGrants } from "../notifications/consent-catch-up.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { NOTIFICATIONS_QUEUE_TOKEN } from "../queue/queue.module.js";
import { RateLimitService } from "../rate-limit/rate-limit.service.js";

/** Subscribe + unsubscribe calls per customer per hour. */
const PER_CUSTOMER = { limit: 20, windowSec: 3600 };

/**
 * Web push subscriptions of the signed-in customer and the public VAPID key. Endpoints are per-device
 * identifiers: they are stored, never logged or audited.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly rateLimit: RateLimitService,
    @Inject(ENV) private readonly env: Env,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(NOTIFICATIONS_QUEUE_TOKEN) private readonly queue: Queue,
  ) {}

  /** `VAPID_PUBLIC_KEY`; 404 `NOT_FOUND` when unset (push not configured). */
  publicKey(): { publicKey: string } {
    if (this.env.VAPID_PUBLIC_KEY === undefined) throw notFound("Push public key");
    return { publicKey: this.env.VAPID_PUBLIC_KEY };
  }

  /**
   * One transaction (customer row locked): upserts the subscription by `endpoint` (an endpoint another
   * customer held moves to the caller, keys replaced) and records `PUSH` granted (source `consentSource`,
   * default `PROFILE`) when it is not already. `customer.update` with `fields: ["consents.PUSH"]` only when the
   * consent changed; then, after commit, the consent catch-up (errors logged, never returned).
   */
  async subscribe(principal: AccessClaims, input: PushSubscriptionInput, ip: string | null): Promise<void> {
    await this.enforceLimit(principal);
    const recorded = await this.prisma.$transaction(async (tx) => {
      const customer = await assertLiveCustomer(tx, principal, { lock: true });
      const owner = { organizationId: principal.org, customerId: customer.id };
      const keys = { p256dh: input.keys.p256dh, auth: input.keys.auth };
      // Unique on endpoint across orgs: the browser's subscription belongs to whoever subscribed last.
      await tx.pushSubscription.upsert({
        where: { endpoint: input.endpoint },
        create: { ...owner, endpoint: input.endpoint, ...keys },
        update: { ...owner, ...keys },
      });
      const changed = await recordConsents(
        tx,
        principal.org,
        customer.id,
        { PUSH: true },
        input.consentSource ?? "PROFILE",
      );
      await this.auditConsent(tx, principal, changed, ip);
      return changed;
    });
    await catchUpAfterCommit(
      this.catchUpDeps(principal),
      this.logger,
      principal.sub,
      sendableGrants(recorded, { PUSH: true }),
    );
  }

  /**
   * One transaction (customer row locked): deletes the caller's row for `endpoint` (another customer's endpoint
   * or an unknown one is a no-op). When that removed the caller's last subscription, records `PUSH` revoked
   * (source `PROFILE`) and audits `customer.update` `fields: ["consents.PUSH"]` if the consent changed.
   */
  async unsubscribe(principal: AccessClaims, input: PushUnsubscribeInput, ip: string | null): Promise<void> {
    await this.enforceLimit(principal);
    await this.prisma.$transaction(async (tx) => {
      const customer = await assertLiveCustomer(tx, principal, { lock: true });
      const owner = { organizationId: principal.org, customerId: customer.id };
      const { count } = await tx.pushSubscription.deleteMany({ where: { ...owner, endpoint: input.endpoint } });
      if (count === 0) return;
      if ((await tx.pushSubscription.count({ where: owner })) > 0) return;
      const changed = await recordConsents(tx, principal.org, customer.id, { PUSH: false }, "PROFILE");
      await this.auditConsent(tx, principal, changed, ip);
    });
  }

  private enforceLimit(principal: AccessClaims): Promise<void> {
    return this.rateLimit.enforce(`push:customer:${principal.sub}`, PER_CUSTOMER.limit, PER_CUSTOMER.windowSec);
  }

  private async auditConsent(
    tx: Prisma.TransactionClient,
    principal: AccessClaims,
    changed: RecordedConsent[],
    ip: string | null,
  ): Promise<void> {
    if (changed.length === 0) return;
    await this.audit.record(
      {
        orgId: principal.org,
        actorType: "CUSTOMER",
        actorId: principal.sub,
        action: "customer.update",
        entity: "customer",
        entityId: principal.sub,
        before: null,
        after: { fields: changed.map((c) => `consents.${c.channel}`) },
        ip,
      },
      tx,
    );
  }

  private catchUpDeps(principal: AccessClaims) {
    return { prisma: this.prisma, queue: this.queue, now: new Date(this.clock.now()), organizationId: principal.org };
  }
}
