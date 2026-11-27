import { ForbiddenException, Inject, Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type {
  AccessClaims,
  Appointment,
  AppointmentStatus,
  StaffAppointment,
  StaffAppointmentInput,
  StaffAppointmentPatch,
  StatusChange,
} from "@beautyspa/contracts";
import { todayIn, utcToWall } from "@beautyspa/datetime";
import { AuditService } from "../audit/audit.service.js";
import { CLOCK, type Clock } from "../common/clock.js";
import { conflict, invalidRef, notFound } from "../common/http-errors.js";
import { loadReachableFor } from "../customers/reachability.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { LocationService } from "../tenancy/location.service.js";
import {
  APPOINTMENT_INCLUDE,
  startOf,
  toAppointmentRecord,
  toStaffAppointmentDto,
  type AppointmentRow,
} from "./appointment-mapping.js";
import {
  AppointmentWriter,
  BOOKING_TX_OPTIONS,
  lockOrgBookings,
  releaseExpiredHoldsAudited,
} from "./appointment-writer.js";
import { BookingContextService } from "./booking-context.service.js";
import { BookingEvents, notifyAfterCommit } from "./booking-events.js";
import { toEngineSegments } from "./plan-mapping.js";

/** Design call 7: the allowed status changes; anything else is 409 `CONFLICT`. */
const TRANSITIONS: Readonly<Record<AppointmentStatus, readonly StatusChange["status"][]>> = {
  HELD: [],
  BOOKED: ["CHECKED_IN", "COMPLETED", "NO_SHOW", "CANCELLED"],
  CHECKED_IN: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};
/** Statuses an EMPLOYEE may set, on their own appointments only. */
const EMPLOYEE_STATUSES: ReadonlySet<StatusChange["status"]> = new Set(["CHECKED_IN", "COMPLETED"]);
/** Statuses that free the appointment's time (segments stop occupying). */
const RELEASING: ReadonlySet<StatusChange["status"]> = new Set(["CANCELLED", "NO_SHOW"]);
const MOVABLE: ReadonlySet<AppointmentStatus> = new Set(["BOOKED", "CHECKED_IN"]);
/** Statuses that need the appointment's local day to have come (R13). */
const SAME_DAY_OR_LATER: ReadonlySet<StatusChange["status"]> = new Set(["CHECKED_IN", "COMPLETED"]);

/** Throws 400 on `customerId` unless it is a customer of the organization that is not deleted. */
export async function assertActiveCustomer(
  tx: Prisma.TransactionClient,
  orgId: string,
  customerId: string,
): Promise<void> {
  const found = await tx.customer.findFirst({
    where: { id: customerId, organizationId: orgId, deletedAt: null },
    select: { id: true },
  });
  if (!found) throw invalidRef("customerId", "Unknown customer");
}

/** The `Appointment` audit shape, with `override: true` added when staff used the override (R4). */
export function auditAfter(row: AppointmentRow, override: boolean): Appointment & { override?: true } {
  const dto = toAppointmentRecord(row);
  return override ? { ...dto, override: true } : dto;
}

/** Staff writes on appointments: book without a hold, move, and change status. */
@Injectable()
export class StaffAppointmentsService {
  private readonly logger = new Logger(StaffAppointmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly locations: LocationService,
    private readonly context: BookingContextService,
    private readonly writer: AppointmentWriter,
    private readonly audit: AuditService,
    private readonly events: BookingEvents,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * One transaction (org booking lock first): the customer must be an active customer of the
   * org (else 400 `customerId`), expired holds released, the plan validated in `STAFF` mode
   * (with `override` when asked) and written as `BOOKED`, source `RECEPTION`, created by the
   * caller. Audit `appointment.create` (`before: null`); `events.booked` after commit.
   */
  async create(principal: AccessClaims, input: StaffAppointmentInput, ip: string | null): Promise<StaffAppointment> {
    const orgId = principal.org;
    const segments = toEngineSegments(input.segments);
    const created = await this.prisma.$transaction(async (tx) => {
      await lockOrgBookings(tx, orgId);
      // Read after the lock so `now` never predates the wait.
      const now = this.clock.now();
      const location = await this.locations.resolve(orgId, input.locationId, tx);
      await assertActiveCustomer(tx, orgId, input.customerId);

      await releaseExpiredHoldsAudited(tx, this.audit, orgId, new Date(now));
      const earliest = Math.min(...segments.map((s) => s.start));
      const ctx = await this.context.load(tx, orgId, location, {
        mode: "STAFF",
        now,
        date: utcToWall(earliest, location.timezone).date,
        override: input.override,
      });
      this.writer.validateOrThrow(ctx, segments);

      const appt = await tx.appointment.create({
        data: {
          organizationId: location.organizationId,
          locationId: location.id,
          customerId: input.customerId,
          status: "BOOKED",
          source: "RECEPTION",
          timesSetAt: new Date(now),
          createdByStaffId: principal.sub,
          notes: input.notes,
        },
        select: { id: true, organizationId: true },
      });
      await this.writer.insertSegments(tx, appt, segments);

      const row = await tx.appointment.findUniqueOrThrow({ where: { id: appt.id }, include: APPOINTMENT_INCLUDE });
      await this.recordAudit(tx, principal, "appointment.create", appt.id, null, auditAfter(row, input.override), ip);
      return toStaffAppointmentDto(row, await loadReachableFor(tx, [row]));
    }, BOOKING_TX_OPTIONS);

    await notifyAfterCommit(this.events, this.logger, () => this.events.booked(created.id));
    return created;
  }

  /**
   * One transaction (org booking lock first): the appointment (locked `FOR UPDATE`, else 404)
   * must be `BOOKED` or `CHECKED_IN` (else 409 `CONFLICT`). Expired holds released, the new
   * plan validated in `STAFF` mode (with `override` when asked; services may change, R5) with
   * its own segments excluded (an appointment that has started is validated as of its start,
   * so it may keep that start: R9), old segments deleted and the new ones inserted (design
   * call 6), `manage_version` incremented. Audit `appointment.move`; `events.changed` after commit.
   */
  async move(
    principal: AccessClaims,
    id: string,
    patch: StaffAppointmentPatch,
    ip: string | null,
  ): Promise<StaffAppointment> {
    const orgId = principal.org;
    const segments = toEngineSegments(patch.segments);
    const moved = await this.prisma.$transaction(async (tx) => {
      await lockOrgBookings(tx, orgId);
      // Read after the lock so `now` never predates the wait.
      const now = this.clock.now();
      const row = await this.lockAppointment(tx, orgId, id);
      if (!MOVABLE.has(row.status)) throw conflict("Appointment cannot be moved");
      const location = await tx.location.findFirstOrThrow({
        where: { id: row.locationId, organizationId: orgId },
        select: { id: true, organizationId: true, timezone: true },
      });

      // In progress (R9): validate as of its own start, so the plan may keep that start (in
      // STAFF mode `now` only sets the earliest allowed start). Holds expired by the real `now`
      // are released first, so validating at the earlier instant never sees them as busy.
      const start = startOf(row);
      let planNow = now;
      if (start <= now) {
        await releaseExpiredHoldsAudited(tx, this.audit, orgId, new Date(now));
        planNow = start;
      }
      await this.writer.replacePlan(
        tx,
        { orgId, location, appointmentId: id, mode: "STAFF", now: planNow, override: patch.override },
        segments,
      );

      const updated = await tx.appointment.update({
        where: { id, organizationId: orgId },
        // A new plan: its times are set now and the customer confirms it again.
        data: { manageVersion: { increment: 1 }, timesSetAt: new Date(now), confirmedByCustomerAt: null },
        include: APPOINTMENT_INCLUDE,
      });
      await this.recordAudit(
        tx,
        principal,
        "appointment.move",
        id,
        toAppointmentRecord(row),
        auditAfter(updated, patch.override),
        ip,
      );
      return toStaffAppointmentDto(updated, await loadReachableFor(tx, [updated]));
    }, BOOKING_TX_OPTIONS);

    await notifyAfterCommit(this.events, this.logger, () => this.events.changed(id));
    return moved;
  }

  /**
   * One transaction (org booking lock first): the appointment locked `FOR UPDATE` (else 404).
   * EMPLOYEE: only appointments with a segment of theirs and only `CHECKED_IN`/`COMPLETED`, else
   * 403. Then design call 7: the transition must be allowed (else 409 `CONFLICT`), `NO_SHOW`
   * only once `now >= startsAt`; `CHECKED_IN`/`COMPLETED` only once the appointment's local day
   * (location timezone) has come, else 409 "Too early to check in" (R13). `CANCELLED` records
   * `cancelledBy STAFF`, the reason and increments `manage_version` (no cancel window for staff); `CANCELLED` and `NO_SHOW` stop the
   * segments occupying time. Audit `appointment.status`; `events.cancelled` only for `CANCELLED`.
   */
  async changeStatus(
    principal: AccessClaims,
    id: string,
    input: StatusChange,
    ip: string | null,
  ): Promise<StaffAppointment> {
    const orgId = principal.org;
    const changed = await this.prisma.$transaction(async (tx) => {
      await lockOrgBookings(tx, orgId);
      // Read after the lock so `now` never predates the wait.
      const now = this.clock.now();
      const row = await this.lockAppointment(tx, orgId, id);

      if (principal.role === "EMPLOYEE") {
        const own = row.segments.some((s) => s.staffUserId === principal.sub);
        if (!own || !EMPLOYEE_STATUSES.has(input.status)) {
          throw new ForbiddenException({ code: "FORBIDDEN", message: "Not allowed for your role" });
        }
      }
      if (!TRANSITIONS[row.status].includes(input.status)) {
        throw conflict(`Cannot change status from ${row.status} to ${input.status}`);
      }
      if (input.status === "NO_SHOW" && now < startOf(row)) {
        throw conflict("No-show only after the appointment starts");
      }
      if (SAME_DAY_OR_LATER.has(input.status)) {
        const { timezone } = await tx.location.findFirstOrThrow({
          where: { id: row.locationId, organizationId: orgId },
          select: { timezone: true },
        });
        if (utcToWall(startOf(row), timezone).date > todayIn(timezone, now)) {
          throw conflict("Too early to check in");
        }
      }

      if (RELEASING.has(input.status)) {
        await tx.appointmentSegment.updateMany({
          where: { appointmentId: id, organizationId: orgId },
          data: { occupies: false },
        });
      }
      const updated = await tx.appointment.update({
        where: { id, organizationId: orgId },
        data:
          input.status === "CANCELLED"
            ? {
                status: "CANCELLED",
                cancelledAt: new Date(now),
                cancelledBy: "STAFF",
                cancelReason: input.reason,
                manageVersion: { increment: 1 },
              }
            : { status: input.status },
        include: APPOINTMENT_INCLUDE,
      });
      await this.recordAudit(
        tx,
        principal,
        "appointment.status",
        id,
        toAppointmentRecord(row),
        toAppointmentRecord(updated),
        ip,
      );
      return toStaffAppointmentDto(updated, await loadReachableFor(tx, [updated]));
    }, BOOKING_TX_OPTIONS);

    if (changed.status === "CANCELLED") {
      await notifyAfterCommit(this.events, this.logger, () => this.events.cancelled(id));
    }
    return changed;
  }

  /** Locks the org's appointment `FOR UPDATE` (else 404) and reads it with its segments. */
  private async lockAppointment(tx: Prisma.TransactionClient, orgId: string, id: string): Promise<AppointmentRow> {
    const [locked] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM appointment
      WHERE id = ${id}::uuid AND organization_id = ${orgId}::uuid
      FOR UPDATE`;
    if (!locked) throw notFound("Appointment");
    return tx.appointment.findUniqueOrThrow({ where: { id }, include: APPOINTMENT_INCLUDE });
  }

  private recordAudit(
    tx: Prisma.TransactionClient,
    principal: AccessClaims,
    action: "appointment.create" | "appointment.move" | "appointment.status",
    id: string,
    before: Appointment | null,
    after: Appointment,
    ip: string | null,
  ): Promise<void> {
    return this.audit.record(
      {
        orgId: principal.org,
        actorType: "STAFF",
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
