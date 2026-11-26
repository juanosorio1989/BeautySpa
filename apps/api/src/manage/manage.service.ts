import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { ManageCancelInput, ManageView } from "@beautyspa/contracts";
import { AuditService } from "../audit/audit.service.js";
import { APPOINTMENT_INCLUDE, startOf, toAppointmentDto, type AppointmentRow } from "../booking/appointment-mapping.js";
import { BOOKING_TX_OPTIONS, lockOrgBookings } from "../booking/appointment-writer.js";
import { BookingEvents, notifyAfterCommit } from "../booking/booking-events.js";
import { cancelByCustomer, insideCancelWindow } from "../booking/customer-cancel.js";
import { CLOCK, type Clock } from "../common/clock.js";
import { conflict, notFound } from "../common/http-errors.js";
import { readLocationSettings } from "../common/location-settings.js";
import { ENV, type Env } from "../config/env.js";
import { appointmentIcsEvent } from "../notifications/appointment-ics.js";
import { buildIcs } from "../notifications/ics.js";
import { manageUrl, verifyManageToken, type ManageClaims } from "../notifications/manage-token.js";
import { MessageContextService, messageLocale, oneLineAddress } from "../notifications/message-context.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { TenancyService } from "../tenancy/tenancy.service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MANAGE_INCLUDE = {
  ...APPOINTMENT_INCLUDE,
  location: { select: { name: true, address: true, phone: true, timezone: true, settings: true } },
} as const satisfies Prisma.AppointmentInclude;

type ManageRow = Prisma.AppointmentGetPayload<{ include: typeof MANAGE_INCLUDE }>;
type ManageLocation = ManageRow["location"];

interface Resolved {
  claims: ManageClaims;
  orgId: string;
  row: ManageRow;
  customerId: string;
}

/** The one answer for every invalid link (no oracle): bad, tampered, expired or stale token, unknown, deleted, held. */
const linkNotFound = () => notFound("Appointment");

/** The public manage link: view, confirm, cancel and calendar download, authorized by the signed token alone. */
@Injectable()
export class ManageService {
  private readonly logger = new Logger(ManageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
    private readonly events: BookingEvents,
    private readonly contexts: MessageContextService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * The token's appointment, or 404 `NOT_FOUND`. The token is verified (signature, `now < exp`) before any
   * database access; then one query requires the appointment in the org, the same `manage_version`, a
   * customer that is not deleted, a status other than `HELD` and at least one segment.
   */
  async resolve(token: string): Promise<Resolved> {
    const claims = this.verify(token);
    const orgId = await this.tenancy.getOrgId();
    return { claims, orgId, ...(await this.find(this.prisma, orgId, claims)) };
  }

  async view(token: string): Promise<ManageView> {
    const { row } = await this.resolve(token);
    return this.toView(row, row.location, this.clock.now());
  }

  /**
   * Sets `confirmed_by_customer_at` once: a conditional update (still `BOOKED`, unconfirmed, same
   * `manage_version`) so a concurrent change wins cleanly; audit `appointment.confirm` only on that
   * transition. Already confirmed → the same 200. Not `BOOKED` → 409 `CONFLICT`. No booking lock (occupancy
   * does not change), no `manage_version` bump, no message.
   */
  async confirm(token: string, ip: string | null): Promise<ManageView> {
    const { claims, orgId, row, customerId } = await this.resolve(token);
    if (row.status !== "BOOKED") throw conflict("Appointment cannot be confirmed");
    if (row.confirmedByCustomerAt === null) {
      await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.appointment.updateMany({
          where: {
            id: row.id,
            organizationId: orgId,
            status: "BOOKED",
            confirmedByCustomerAt: null,
            manageVersion: claims.manageVersion,
          },
          data: { confirmedByCustomerAt: new Date(this.clock.now()) },
        });
        if (count === 0) return;
        const after = await tx.appointment.findUniqueOrThrow({ where: { id: row.id }, include: APPOINTMENT_INCLUDE });
        await this.audit.record(
          {
            orgId,
            actorType: "CUSTOMER",
            actorId: customerId,
            action: "appointment.confirm",
            entity: "appointment",
            entityId: row.id,
            before: toAppointmentDto(row),
            after: toAppointmentDto(after),
            ip,
          },
          tx,
        );
      });
    }
    // Read again: a cancel or reschedule that committed in between makes the link stale (404) or not BOOKED (409).
    const { row: current } = await this.find(this.prisma, orgId, claims);
    if (current.status !== "BOOKED") throw conflict("Appointment cannot be confirmed");
    return this.toView(current, current.location, this.clock.now());
  }

  /**
   * `cancelByCustomer` (same rules, errors and audit as `POST /me/appointments/:id/cancel`) in the booking
   * transaction, with the link re-checked under the org booking lock. The view is built from the cancelled
   * row (the token is stale afterwards). `events.cancelled` after commit.
   */
  async cancel(token: string, input: ManageCancelInput, ip: string | null): Promise<ManageView> {
    const claims = this.verify(token);
    const orgId = await this.tenancy.getOrgId();
    const view = await this.prisma.$transaction(async (tx) => {
      await lockOrgBookings(tx, orgId);
      // Read after the lock so `now` never predates the wait.
      const now = this.clock.now();
      const { row, customerId } = await this.find(tx, orgId, claims);
      const updated = await cancelByCustomer(
        tx,
        { audit: this.audit, now: new Date(now) },
        { orgId, customerId, appointmentId: row.id, reason: input.reason, ip },
      );
      return this.toView(updated, row.location, now);
    }, BOOKING_TX_OPTIONS);

    await notifyAfterCommit(this.events, this.logger, () => this.events.cancelled(claims.appointmentId));
    return view;
  }

  /** The appointment as a `METHOD:PUBLISH` calendar (a download, not an invitation), in the customer's locale. */
  async calendar(token: string): Promise<string> {
    const { orgId, row } = await this.resolve(token);
    const a = await this.contexts.load(row.id, orgId);
    if (!a) throw linkNotFound();
    const locale = messageLocale(a.customer?.locale ?? "en");
    const ctx = this.contexts.toContext(
      a,
      manageUrl(this.env.WEB_ORIGIN, locale, token),
      this.contexts.bookUrl(locale),
      locale,
    );
    const cancelled = a.status === "CANCELLED";
    const event = appointmentIcsEvent(a, ctx, {
      dtstamp: new Date(this.clock.now()),
      url: cancelled ? ctx.bookUrl : ctx.manageUrl,
      status: cancelled ? "CANCELLED" : "CONFIRMED",
    });
    return buildIcs(event, { method: "PUBLISH" });
  }

  private verify(token: string): ManageClaims {
    const claims = verifyManageToken(this.env.MANAGE_LINK_SECRET, token, this.clock.now());
    // The id is signed by us, but a non-uuid would make the uuid column query throw (500).
    if (!claims || !UUID.test(claims.appointmentId)) throw linkNotFound();
    return claims;
  }

  private async find(
    db: Prisma.TransactionClient,
    orgId: string,
    claims: ManageClaims,
  ): Promise<{ row: ManageRow; customerId: string }> {
    const row = await db.appointment.findFirst({
      where: {
        id: claims.appointmentId,
        organizationId: orgId,
        manageVersion: claims.manageVersion,
        status: { not: "HELD" },
        customer: { is: { deletedAt: null } },
        segments: { some: {} },
      },
      include: MANAGE_INCLUDE,
    });
    if (!row || row.customerId === null) throw linkNotFound();
    return { row, customerId: row.customerId };
  }

  private toView(row: AppointmentRow, location: ManageLocation, nowMs: number): ManageView {
    const booked = row.status === "BOOKED";
    const { cancelWindowHours } = readLocationSettings(location.settings);
    return {
      appointment: toAppointmentDto(row),
      location: {
        name: location.name,
        addressLine: oneLineAddress(location.address),
        phone: location.phone,
        timezone: location.timezone,
      },
      canCancel: booked && insideCancelWindow(nowMs, startOf(row), cancelWindowHours),
      canConfirm: booked && row.confirmedByCustomerAt === null,
    };
  }
}
