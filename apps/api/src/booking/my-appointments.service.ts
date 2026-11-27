import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type {
  AccessClaims,
  Appointment,
  CancelInput,
  MyAppointments,
  Repeat,
  RescheduleInput,
} from "@beautyspa/contracts";
import { AuditService } from "../audit/audit.service.js";
import { CLOCK, type Clock } from "../common/clock.js";
import { invalidRef, notFound } from "../common/http-errors.js";
import { assertLiveCustomer } from "../common/live-customer.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { APPOINTMENT_INCLUDE, startOf, toAppointmentDto, type AppointmentRow } from "./appointment-mapping.js";
import { AppointmentWriter, BOOKING_TX_OPTIONS, lockOrgBookings } from "./appointment-writer.js";
import { BookingEvents, notifyAfterCommit } from "./booking-events.js";
import { cancelByCustomer, lockChangeableAppointment, type ChangeableAppointment } from "./customer-cancel.js";
import { toEngineSegments } from "./plan-mapping.js";

const PAST_LIMIT = 50;
const UPCOMING_STATUSES = new Set(["BOOKED", "CHECKED_IN"]);

const endOf = (row: AppointmentRow) => Math.max(...row.segments.map((s) => s.endsAt.getTime()));

/** The upcoming/past split shared with the staff customer view: `BOOKED` or `CHECKED_IN` ending after `now`. */
export const isUpcoming = (row: AppointmentRow, now: number): boolean =>
  UPCOMING_STATUSES.has(row.status) && endOf(row) > now;
const sortedServiceIds = (segments: { serviceId: string }[]) => segments.map((s) => s.serviceId).sort();

/** The signed-in customer's own appointments: list, cancel, reschedule and repeat. */
@Injectable()
export class MyAppointmentsService {
  private readonly logger = new Logger(MyAppointmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly writer: AppointmentWriter,
    private readonly audit: AuditService,
    private readonly events: BookingEvents,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Every appointment of the caller except `HELD`. `upcoming`: `BOOKED` or `CHECKED_IN` ending
   * after now, ascending by start. `past`: everything else, descending by start, at most 50.
   * Start and end come from the segments (as in the DTO).
   */
  async list(principal: AccessClaims): Promise<MyAppointments> {
    await assertLiveCustomer(this.prisma, principal);
    const now = this.clock.now();
    const rows = await this.prisma.appointment.findMany({
      where: { organizationId: principal.org, customerId: principal.sub, status: { not: "HELD" } },
      include: APPOINTMENT_INCLUDE,
    });
    const withSegments = rows.filter((r) => r.segments.length > 0);
    const upcoming = withSegments.filter((r) => isUpcoming(r, now)).sort((a, b) => startOf(a) - startOf(b));
    const past = withSegments
      .filter((r) => !isUpcoming(r, now))
      .sort((a, b) => startOf(b) - startOf(a))
      .slice(0, PAST_LIMIT);
    return { upcoming: upcoming.map(toAppointmentDto), past: past.map(toAppointmentDto) };
  }

  /**
   * One transaction (org booking lock first): the caller's `BOOKED` appointment inside the cancel
   * window becomes `CANCELLED` by `CUSTOMER`, its segments stop occupying time and
   * `manage_version` increments. Audit `appointment.cancel`; `events.cancelled` after commit.
   */
  async cancel(principal: AccessClaims, id: string, input: CancelInput, ip: string | null): Promise<Appointment> {
    const orgId = principal.org;
    const cancelled = await this.prisma.$transaction(async (tx) => {
      await lockOrgBookings(tx, orgId);
      // Read after the lock so `now` never predates the wait.
      const now = this.clock.now();
      // Under the org booking lock, so a deletion that committed first is seen here.
      await assertLiveCustomer(tx, principal);
      const updated = await cancelByCustomer(
        tx,
        { audit: this.audit, now: new Date(now) },
        { orgId, customerId: principal.sub, appointmentId: id, reason: input.reason, ip },
      );
      return toAppointmentDto(updated);
    }, BOOKING_TX_OPTIONS);

    await notifyAfterCommit(this.events, this.logger, () => this.events.cancelled(id));
    return cancelled;
  }

  /**
   * One transaction (org booking lock first): the new plan must keep the same multiset of
   * services (else 400 `VALIDATION_FAILED` path `segments`), expired holds released, the new plan re-validated
   * `ONLINE` against the appointment's location with its own segments excluded, the old segments
   * deleted and the new ones inserted (design call 6), `manage_version` incremented. Any error
   * rolls everything back, so the old time stays booked. Audit `appointment.reschedule` with the
   * old shape in `before`; `events.changed` after commit.
   */
  async reschedule(
    principal: AccessClaims,
    id: string,
    input: RescheduleInput,
    ip: string | null,
  ): Promise<Appointment> {
    const orgId = principal.org;
    const segments = toEngineSegments(input.segments);
    const rescheduled = await this.prisma.$transaction(async (tx) => {
      await lockOrgBookings(tx, orgId);
      // Read after the lock so `now` never predates the wait.
      const now = this.clock.now();
      const { row, location } = await this.lockChangeable(tx, principal, id, now);
      // Ruling R5: a customer reschedule keeps the same services (employees and times may change).
      if (sortedServiceIds(row.segments).join() !== sortedServiceIds(input.segments).join()) {
        throw invalidRef("segments", "Reschedule cannot change services");
      }

      await this.writer.replacePlan(tx, { orgId, location, appointmentId: id, mode: "ONLINE", now }, segments);

      const updated = await tx.appointment.update({
        where: { id, organizationId: orgId },
        // A new plan: its times are set now and the customer confirms it again.
        data: { manageVersion: { increment: 1 }, timesSetAt: new Date(now), confirmedByCustomerAt: null },
        include: APPOINTMENT_INCLUDE,
      });
      const after = toAppointmentDto(updated);
      await this.recordAudit(tx, principal, "appointment.reschedule", id, toAppointmentDto(row), after, ip);
      return after;
    }, BOOKING_TX_OPTIONS);

    await notifyAfterCommit(this.events, this.logger, () => this.events.changed(id));
    return rescheduled;
  }

  /**
   * The caller's appointment (any status) as a new booking request: its services in segment
   * order, inactive services dropped; each employee kept only while still active, assigned to
   * the location with a `bookableOnline` profile and qualified for the service, else `"ANY"`.
   */
  async repeat(principal: AccessClaims, id: string): Promise<Repeat> {
    const orgId = principal.org;
    await assertLiveCustomer(this.prisma, principal);
    const row = await this.prisma.appointment.findFirst({
      where: { id, organizationId: orgId, customerId: principal.sub },
      include: { segments: APPOINTMENT_INCLUDE.segments },
    });
    if (!row) throw notFound("Appointment");

    const serviceIds = [...new Set(row.segments.map((s) => s.serviceId))];
    const staffIds = [...new Set(row.segments.map((s) => s.staffUserId))];
    const [services, staff] = await Promise.all([
      this.prisma.service.findMany({
        where: { id: { in: serviceIds }, organizationId: orgId, active: true },
        select: { id: true },
      }),
      this.prisma.staffUser.findMany({
        where: {
          id: { in: staffIds },
          organizationId: orgId,
          active: true,
          employeeProfile: { is: { bookableOnline: true } },
          staffLocations: { some: { locationId: row.locationId } },
        },
        select: { id: true, employeeServices: { select: { serviceId: true } } },
      }),
    ]);
    const activeServices = new Set(services.map((s) => s.id));
    const qualified = new Map(staff.map((s) => [s.id, new Set(s.employeeServices.map((e) => e.serviceId))]));

    return {
      locationId: row.locationId,
      services: row.segments
        .filter((s) => activeServices.has(s.serviceId))
        .map((s) => ({
          serviceId: s.serviceId,
          employeeId: qualified.get(s.staffUserId)?.has(s.serviceId) ? s.staffUserId : "ANY",
        })),
    };
  }

  /** `lockChangeableAppointment` for the caller, after checking the caller is a live customer. */
  private async lockChangeable(
    tx: Prisma.TransactionClient,
    principal: AccessClaims,
    id: string,
    now: number,
  ): Promise<ChangeableAppointment> {
    // Under the org booking lock, so a deletion that committed first is seen here.
    await assertLiveCustomer(tx, principal);
    return lockChangeableAppointment(tx, {
      orgId: principal.org,
      customerId: principal.sub,
      appointmentId: id,
      nowMs: now,
    });
  }

  private recordAudit(
    tx: Prisma.TransactionClient,
    principal: AccessClaims,
    action: "appointment.reschedule",
    id: string,
    before: Appointment,
    after: Appointment,
    ip: string | null,
  ): Promise<void> {
    return this.audit.record(
      {
        orgId: principal.org,
        actorType: "CUSTOMER",
        actorId: principal.sub,
        action,
        entity: "appointment",
        entityId: id,
        before,
        after,
        ip,
      },
      tx,
    );
  }
}
