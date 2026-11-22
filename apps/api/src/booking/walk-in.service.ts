import { Inject, Injectable, Logger } from "@nestjs/common";
import type { AccessClaims, StaffAppointment, WalkInInput } from "@beautyspa/contracts";
import { AvailabilityError, findSlots, type Slot } from "@beautyspa/availability";
import { MINUTE, localDayBoundsUtc, todayIn } from "@beautyspa/datetime";
import { AuditService } from "../audit/audit.service.js";
import { CLOCK, type Clock } from "../common/clock.js";
import { invalidRef, slotTaken } from "../common/http-errors.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { LocationService } from "../tenancy/location.service.js";
import { APPOINTMENT_INCLUDE, toAppointmentRecord, toStaffAppointmentDto } from "./appointment-mapping.js";
import {
  AppointmentWriter,
  BOOKING_TX_OPTIONS,
  lockOrgBookings,
  releaseExpiredHoldsAudited,
} from "./appointment-writer.js";
import { BookingContextService, type BookingContext } from "./booking-context.service.js";
import { BookingEvents, notifyAfterCommit } from "./booking-events.js";
import { assertActiveCustomer } from "./staff-appointments.service.js";

/** Walk-ins: the first free plan starting now (design call 9), checked in at once. */
@Injectable()
export class WalkInService {
  private readonly logger = new Logger(WalkInService.name);

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
   * One transaction (org booking lock first): `customerId`, when given, must be an active
   * customer of the org (else 400 `customerId`); expired holds released; `findSlots` in `STAFF`
   * mode for today in the location's timezone; the first slot starting at or before
   * `floor(now to grid) + slotIntervalMin` is re-validated and written as `CHECKED_IN`, source
   * `WALK_IN`, created by the caller. None → 409 `SLOT_TAKEN`. Audit `appointment.create`
   * (`before: null`); `events.booked` after commit.
   */
  async create(principal: AccessClaims, input: WalkInInput, ip: string | null): Promise<StaffAppointment> {
    const orgId = principal.org;
    const created = await this.prisma.$transaction(async (tx) => {
      await lockOrgBookings(tx, orgId);
      // Read after the lock so `now` never predates the wait.
      const now = this.clock.now();
      const location = await this.locations.resolve(orgId, input.locationId, tx);
      if (input.customerId !== null) await assertActiveCustomer(tx, orgId, input.customerId);

      await releaseExpiredHoldsAudited(tx, this.audit, orgId, new Date(now));
      const date = todayIn(location.timezone, now);
      const ctx = await this.context.load(tx, orgId, location, { mode: "STAFF", now, date });
      const slot = this.firstSlotNow(ctx, input, date, now);
      if (!slot) throw slotTaken("No free slot right now");
      this.writer.validateOrThrow(ctx, slot.segments);

      const appt = await tx.appointment.create({
        data: {
          organizationId: location.organizationId,
          locationId: location.id,
          customerId: input.customerId,
          status: "CHECKED_IN",
          source: "WALK_IN",
          createdByStaffId: principal.sub,
          notes: input.notes,
        },
        select: { id: true, organizationId: true },
      });
      await this.writer.insertSegments(tx, appt, slot.segments);

      const row = await tx.appointment.findUniqueOrThrow({ where: { id: appt.id }, include: APPOINTMENT_INCLUDE });
      await this.audit.record(
        {
          orgId,
          actorType: "STAFF",
          actorId: principal.sub,
          action: "appointment.create",
          entity: "appointment",
          entityId: appt.id,
          before: null,
          after: toAppointmentRecord(row),
          ip,
        },
        tx,
      );
      return toStaffAppointmentDto(row);
    }, BOOKING_TX_OPTIONS);

    await notifyAfterCommit(this.events, this.logger, () => this.events.booked(created.id));
    return created;
  }

  /** The first slot of today starting no later than one grid step after now rounded down to the grid. */
  private firstSlotNow(ctx: BookingContext, input: WalkInInput, date: string, now: number): Slot | undefined {
    const step = ctx.location.slotIntervalMin * MINUTE;
    const dayStart = localDayBoundsUtc(date, ctx.location.timezone).start;
    const floor = dayStart + Math.floor((now - dayStart) / step) * step;
    let slots: Slot[];
    try {
      slots = findSlots({ ...ctx, choices: input.services, date });
    } catch (err) {
      if (err instanceof AvailabilityError && (err.code === "UNKNOWN_SERVICE" || err.code === "UNKNOWN_EMPLOYEE")) {
        throw invalidRef("services", "Unknown service or employee");
      }
      throw err;
    }
    return slots.find((s) => s.start <= floor + step);
  }
}
