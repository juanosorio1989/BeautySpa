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
import { conflict, invalidRef, notFound, outsideCancelWindow } from "../common/http-errors.js";
import { readLocationSettings } from "../common/location-settings.js";
import { assertLiveCustomer } from "../common/live-customer.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { APPOINTMENT_INCLUDE, startOf, toAppointmentDto, type AppointmentRow } from "./appointment-mapping.js";
import { AppointmentWriter, BOOKING_TX_OPTIONS, lockOrgBookings } from "./appointment-writer.js";
import { BookingEvents, notifyAfterCommit } from "./booking-events.js";
import { toEngineSegments } from "./plan-mapping.js";

const PAST_LIMIT = 50;
const UPCOMING_STATUSES = new Set(["BOOKED", "CHECKED_IN"]);
const HOUR = 3_600_000;

const endOf = (row: AppointmentRow) => Math.max(...row.segments.map((s) => s.endsAt.getTime()));
const sortedServiceIds = (segments: { serviceId: string }[]) => segments.map((s) => s.serviceId).sort();

interface Changeable {
  row: AppointmentRow;
  location: { id: string; organizationId: string; timezone: string };
}

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
    const isUpcoming = (r: AppointmentRow) => UPCOMING_STATUSES.has(r.status) && endOf(r) > now;
    const upcoming = withSegments.filter(isUpcoming).sort((a, b) => startOf(a) - startOf(b));
    const past = withSegments
      .filter((r) => !isUpcoming(r))
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
      const { row } = await this.lockChangeable(tx, principal, id, now);

      await tx.appointmentSegment.updateMany({
        where: { appointmentId: id, organizationId: orgId },
        data: { occupies: false },
      });
      const updated = await tx.appointment.update({
        where: { id, organizationId: orgId },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(now),
          cancelledBy: "CUSTOMER",
          cancelReason: input.reason,
          manageVersion: { increment: 1 },
        },
        include: APPOINTMENT_INCLUDE,
      });
      const after = toAppointmentDto(updated);
      await this.recordAudit(tx, principal, "appointment.cancel", id, toAppointmentDto(row), after, ip);
      return after;
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

  /**
   * Locks the caller's appointment `FOR UPDATE` (filtered by org and customer; otherwise 404),
   * then requires `BOOKED` (else 409 `CONFLICT`) and `now <= startsAt - cancelWindowHours` of its
   * location (else 409 `OUTSIDE_CANCEL_WINDOW`; design call 8).
   */
  private async lockChangeable(
    tx: Prisma.TransactionClient,
    principal: AccessClaims,
    id: string,
    now: number,
  ): Promise<Changeable> {
    // Under the org booking lock, so a deletion that committed first is seen here.
    await assertLiveCustomer(tx, principal);
    const [locked] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM appointment
      WHERE id = ${id}::uuid AND organization_id = ${principal.org}::uuid AND customer_id = ${principal.sub}::uuid
      FOR UPDATE`;
    if (!locked) throw notFound("Appointment");
    const row = await tx.appointment.findUniqueOrThrow({ where: { id }, include: APPOINTMENT_INCLUDE });
    if (row.status !== "BOOKED") throw conflict("Appointment cannot be changed");

    const location = await tx.location.findFirstOrThrow({
      where: { id: row.locationId, organizationId: principal.org },
      select: { id: true, organizationId: true, timezone: true, settings: true },
    });
    const { cancelWindowHours } = readLocationSettings(location.settings);
    if (now > startOf(row) - cancelWindowHours * HOUR) throw outsideCancelWindow();
    return { row, location: { id: location.id, organizationId: location.organizationId, timezone: location.timezone } };
  }

  private recordAudit(
    tx: Prisma.TransactionClient,
    principal: AccessClaims,
    action: "appointment.cancel" | "appointment.reschedule",
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
