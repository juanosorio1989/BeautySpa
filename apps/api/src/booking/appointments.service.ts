import { Inject, Injectable, Logger } from "@nestjs/common";
import type { AccessClaims, Appointment, BookInput } from "@beautyspa/contracts";
import { AuditService } from "../audit/audit.service.js";
import { CLOCK, type Clock } from "../common/clock.js";
import { conflict, holdExpired, invalidRef, notFound } from "../common/http-errors.js";
import { assertLiveCustomer } from "../common/live-customer.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RateLimitService } from "../rate-limit/rate-limit.service.js";
import { APPOINTMENT_INCLUDE, toAppointmentDto } from "./appointment-mapping.js";
import { BOOKING_TX_OPTIONS, lockOrgBookings } from "./appointment-writer.js";
import { BookingEvents, notifyAfterCommit } from "./booking-events.js";

const PER_CUSTOMER = { limit: 10, windowSec: 3600 };

interface LockedHold {
  status: string;
  hold_expires_at: Date | null;
  cancel_reason: string | null;
}

/** Confirms a hold as a booking for the signed-in customer. */
@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger(AppointmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly rateLimit: RateLimitService,
    private readonly events: BookingEvents,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * One transaction: org booking lock, then the hold row locked `FOR UPDATE` (filtered by the
   * token's org), then the checks in order: unknown → 404; expired (still `HELD` past
   * `holdExpiresAt`, or released by a sweep) → 409 `HOLD_EXPIRED`; any other non-`HELD` → 409
   * `CONFLICT`; caller missing or deleted (a still-valid token after `DELETE /me`) → 401
   * `UNAUTHORIZED`; customer without a name → 400 path `name`. The plan is not re-validated: the
   * hold's segments already occupy the time. `events.booked` runs after commit.
   */
  async book(principal: AccessClaims, input: BookInput, ip: string | null): Promise<Appointment> {
    await this.rateLimit.enforce(`book:customer:${principal.sub}`, PER_CUSTOMER.limit, PER_CUSTOMER.windowSec);
    const orgId = principal.org;
    const booked = await this.prisma.$transaction(async (tx) => {
      await lockOrgBookings(tx, orgId);
      // Read after the lock so `now` never predates the wait.
      const now = this.clock.now();
      const [hold] = await tx.$queryRaw<LockedHold[]>`
        SELECT status::text AS status, hold_expires_at, cancel_reason
        FROM appointment
        WHERE id = ${input.holdId}::uuid AND organization_id = ${orgId}::uuid
        FOR UPDATE`;
      if (!hold) throw notFound("Hold");
      const expiredHeld =
        hold.status === "HELD" && hold.hold_expires_at !== null && hold.hold_expires_at.getTime() <= now;
      const released = hold.status === "CANCELLED" && hold.cancel_reason === "HOLD_EXPIRED";
      if (expiredHeld || released) throw holdExpired();
      if (hold.status !== "HELD") throw conflict("Hold already used");

      const customer = await assertLiveCustomer(tx, principal);
      if (!customer.name) throw invalidRef("name", "Name is required before booking");

      const before = await tx.appointment.findUniqueOrThrow({
        where: { id: input.holdId },
        include: APPOINTMENT_INCLUDE,
      });
      const row = await tx.appointment.update({
        where: { id: input.holdId, organizationId: orgId },
        data: {
          status: "BOOKED",
          customerId: principal.sub,
          holdExpiresAt: null,
          timesSetAt: new Date(now),
          notes: input.notes,
        },
        include: APPOINTMENT_INCLUDE,
      });
      const after = toAppointmentDto(row);
      await this.audit.record(
        {
          orgId,
          actorType: "CUSTOMER",
          actorId: principal.sub,
          action: "appointment.create",
          entity: "appointment",
          entityId: row.id,
          before: toAppointmentDto(before),
          after,
          ip,
        },
        tx,
      );
      return after;
    }, BOOKING_TX_OPTIONS);

    await notifyAfterCommit(this.events, this.logger, () => this.events.booked(booked.id));
    return booked;
  }
}
