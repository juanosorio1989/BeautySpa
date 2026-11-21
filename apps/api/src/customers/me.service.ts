import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { AccessClaims, CustomerExport, Me, MePatch } from "@beautyspa/contracts";
import { AuditService } from "../audit/audit.service.js";
import { RefreshTokenService } from "../auth/refresh-token.service.js";
import { APPOINTMENT_INCLUDE, startOf, toAppointmentDto } from "../booking/appointment-mapping.js";
import { BOOKING_TX_OPTIONS, lockOrgBookings } from "../booking/appointment-writer.js";
import { BookingEvents, notifyAfterCommit } from "../booking/booking-events.js";
import { CLOCK, type Clock } from "../common/clock.js";
import { assertLiveCustomer } from "../common/live-customer.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { currentConsents, recordConsents, toCustomerDto } from "./consents.js";

/** Keys listed in the `customer.delete` audit row (design call 10: keys only, never values). */
const DELETED_FIELDS = ["name", "email", "phoneE164", "privateNotes"];
const ALL_REVOKED = { WHATSAPP: false, SMS: false, EMAIL: false } as const;

/** Cancel reasons the system writes; they hold no personal data and stay in audit rows. */
const SYSTEM_CANCEL_REASONS = ["ACCOUNT_DELETED", "HOLD_EXPIRED"];

/**
 * Removes free text from the org's `appointment` audit rows for `appointmentIds`: the `notes`
 * key becomes JSON null, and so does `cancelReason` unless it is a system reason. Only keys that
 * exist are touched; a null `before`/`after` stays null (`NULL || x` is NULL). The one documented
 * exception to audit_log being append-only, because that free text may hold personal data.
 */
async function scrubAppointmentAudits(
  tx: Prisma.TransactionClient,
  orgId: string,
  appointmentIds: string[],
): Promise<void> {
  if (appointmentIds.length === 0) return;
  await tx.$executeRaw`
    UPDATE audit_log SET
      before = before
        || CASE WHEN before ? 'notes' THEN '{"notes": null}'::jsonb ELSE '{}'::jsonb END
        || CASE WHEN before->>'cancelReason' <> ALL(${SYSTEM_CANCEL_REASONS}::text[])
             THEN '{"cancelReason": null}'::jsonb ELSE '{}'::jsonb END,
      after = after
        || CASE WHEN after ? 'notes' THEN '{"notes": null}'::jsonb ELSE '{}'::jsonb END
        || CASE WHEN after->>'cancelReason' <> ALL(${SYSTEM_CANCEL_REASONS}::text[])
             THEN '{"cancelReason": null}'::jsonb ELSE '{}'::jsonb END
    WHERE organization_id = ${orgId}::uuid
      AND entity = 'appointment'
      AND entity_id = ANY(${appointmentIds}::text[])
      AND (before ? 'notes' OR after ? 'notes' OR before ? 'cancelReason' OR after ? 'cancelReason')`;
}

/**
 * The signed-in customer's own profile: read, update, data export and account deletion. Every
 * method answers 401 `UNAUTHORIZED` once the customer is deleted (`deleted_at` set), because the
 * access token stays valid until it expires.
 */
@Injectable()
export class MeService {
  private readonly logger = new Logger(MeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly events: BookingEvents,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async get(principal: AccessClaims): Promise<Me> {
    const row = await assertLiveCustomer(this.prisma, principal);
    return toCustomerDto(row, await currentConsents(this.prisma, row.id));
  }

  /**
   * One transaction (customer row locked): writes only the fields whose value changes, appends a
   * consent row (source `PROFILE`) per channel whose value changes, and records `customer.update`
   * with `after: { fields }` (changed keys, consents as `consents.<CHANNEL>`) only when something
   * changed.
   */
  async patch(principal: AccessClaims, input: MePatch, ip: string | null): Promise<Me> {
    return this.prisma.$transaction(async (tx) => {
      const row = await assertLiveCustomer(tx, principal, { lock: true });
      const data: Prisma.CustomerUpdateInput = {};
      if (input.name !== undefined && input.name !== row.name) data.name = input.name;
      if (input.email !== undefined && input.email !== row.email) data.email = input.email;
      if (input.locale !== undefined && input.locale !== row.locale) data.locale = input.locale;
      const fields = Object.keys(data);

      const updated =
        fields.length > 0
          ? await tx.customer.update({ where: { id: row.id, organizationId: principal.org }, data })
          : row;
      const channels = input.consents ? await recordConsents(tx, principal.org, row.id, input.consents, "PROFILE") : [];
      fields.push(...channels.map((c) => `consents.${c}`));

      if (fields.length > 0) {
        await this.audit.record(
          {
            orgId: principal.org,
            actorType: "CUSTOMER",
            actorId: row.id,
            action: "customer.update",
            entity: "customer",
            entityId: row.id,
            before: null,
            after: { fields },
            ip,
          },
          tx,
        );
      }
      return toCustomerDto(updated, await currentConsents(tx, row.id));
    });
  }

  /** `Me`, the full consent history (oldest first) and every non-`HELD` appointment (earliest first). */
  async export(principal: AccessClaims): Promise<CustomerExport> {
    const row = await assertLiveCustomer(this.prisma, principal);
    const [consents, history, appointments] = await Promise.all([
      currentConsents(this.prisma, row.id),
      this.prisma.notificationConsent.findMany({
        where: { organizationId: principal.org, customerId: row.id },
        orderBy: [{ changedAt: "asc" }, { id: "asc" }],
        select: { channel: true, granted: true, source: true, changedAt: true },
      }),
      this.prisma.appointment.findMany({
        where: { organizationId: principal.org, customerId: row.id, status: { not: "HELD" } },
        include: APPOINTMENT_INCLUDE,
      }),
    ]);
    return {
      customer: toCustomerDto(row, consents),
      consentHistory: history.map((h) => ({ ...h, changedAt: h.changedAt.toISOString() })),
      appointments: appointments
        .filter((a) => a.segments.length > 0)
        .sort((a, b) => startOf(a) - startOf(b))
        .map(toAppointmentDto),
    };
  }

  /**
   * Deletes the account (design call 11) in one transaction, org booking lock first:
   * - every appointment of the customer loses its notes, earlier customer cancellations lose their
   *   reason, and the same free text is scrubbed from earlier appointment audit rows;
   * - future `BOOKED` ones (earliest segment start after now) become `CANCELLED` by `CUSTOMER` with
   *   reason `ACCOUNT_DELETED`, stop occupying time, get `manage_version` + 1 and one
   *   `appointment.cancel` audit each;
   * - each granted channel gets a `granted:false` consent row (`PROFILE`);
   * - name, email and private notes become null, the phone becomes `deleted:<id>` (frees the
   *   number for a new signup) and `deleted_at` is set;
   * - every refresh token is revoked; `customer.delete` lists the cleared keys only.
   * Appointment rows stay attached to the anonymized customer. `events.cancelled` runs after
   * commit for each cancellation.
   */
  async remove(principal: AccessClaims, ip: string | null): Promise<void> {
    const orgId = principal.org;
    const cancelledIds = await this.prisma.$transaction(async (tx) => {
      await lockOrgBookings(tx, orgId);
      // Read after the lock so `now` never predates the wait.
      const now = this.clock.now();
      const customer = await assertLiveCustomer(tx, principal, { lock: true });
      const customerId = customer.id;

      // Free text goes first, so the cancel rows and audits written below keep their system reason.
      const appointments = await tx.appointment.updateManyAndReturn({
        where: { organizationId: orgId, customerId },
        data: { notes: null },
        select: { id: true },
      });
      await tx.appointment.updateMany({
        where: { organizationId: orgId, customerId, cancelledBy: "CUSTOMER", cancelReason: { not: null } },
        data: { cancelReason: null },
      });
      const appointmentIds = appointments.map((a) => a.id);
      await scrubAppointmentAudits(tx, orgId, appointmentIds);

      const booked = await tx.appointment.findMany({
        where: { organizationId: orgId, customerId, status: "BOOKED" },
        include: APPOINTMENT_INCLUDE,
      });
      const future = booked.filter((a) => a.segments.length > 0 && startOf(a) > now);
      for (const row of future) {
        await tx.appointmentSegment.updateMany({
          where: { appointmentId: row.id, organizationId: orgId },
          data: { occupies: false },
        });
        const updated = await tx.appointment.update({
          where: { id: row.id, organizationId: orgId },
          data: {
            status: "CANCELLED",
            cancelledAt: new Date(now),
            cancelledBy: "CUSTOMER",
            cancelReason: "ACCOUNT_DELETED",
            manageVersion: { increment: 1 },
          },
          include: APPOINTMENT_INCLUDE,
        });
        // The customer-facing DTO carries no customer name or phone.
        await this.audit.record(
          {
            orgId,
            actorType: "CUSTOMER",
            actorId: customerId,
            action: "appointment.cancel",
            entity: "appointment",
            entityId: row.id,
            before: toAppointmentDto(row),
            after: toAppointmentDto(updated),
            ip,
          },
          tx,
        );
      }

      await recordConsents(tx, orgId, customerId, ALL_REVOKED, "PROFILE");
      await tx.customer.update({
        where: { id: customerId, organizationId: orgId },
        data: {
          name: null,
          email: null,
          privateNotesEnc: null,
          phoneE164: `deleted:${customerId}`,
          deletedAt: new Date(now),
        },
      });
      await this.refreshTokens.revokeAllFor({ type: "CUSTOMER", id: customerId }, tx);
      await this.audit.record(
        {
          orgId,
          actorType: "CUSTOMER",
          actorId: customerId,
          action: "customer.delete",
          entity: "customer",
          entityId: customerId,
          before: null,
          after: { fields: DELETED_FIELDS },
          ip,
        },
        tx,
      );
      return future.map((a) => a.id);
    }, BOOKING_TX_OPTIONS);

    for (const id of cancelledIds) {
      await notifyAfterCommit(this.events, this.logger, () => this.events.cancelled(id));
    }
  }
}
