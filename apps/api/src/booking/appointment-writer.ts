import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { validatePlan, type Context, type PlannedSegment, type PlanRejection } from "@beautyspa/availability";
import { isDeadlock, isExclusionViolation } from "../common/db-errors.js";
import { invalidRef, slotTaken } from "../common/http-errors.js";
import { choicesOf } from "./plan-mapping.js";

/**
 * Releases every `HELD` appointment whose hold has expired (`hold_expires_at <= now`), of one
 * organization or of all when `orgId` is null: `CANCELLED` by `SYSTEM` with reason
 * `HOLD_EXPIRED` (`hold_expires_at` kept), and its segments stop occupying time. The appointment
 * update runs first and takes the row locks, so a concurrent confirm of the same hold cannot
 * end up `BOOKED` with released segments. Returns the number of appointments released.
 */
export async function releaseExpiredHolds(
  tx: Prisma.TransactionClient,
  orgId: string | null,
  now: Date,
): Promise<number> {
  const released = await tx.appointment.updateManyAndReturn({
    where: {
      status: "HELD",
      holdExpiresAt: { lte: now },
      ...(orgId !== null ? { organizationId: orgId } : {}),
    },
    data: { status: "CANCELLED", cancelledAt: now, cancelledBy: "SYSTEM", cancelReason: "HOLD_EXPIRED" },
    select: { id: true },
  });
  if (released.length === 0) return 0;
  await tx.appointmentSegment.updateMany({
    where: { appointmentId: { in: released.map((a) => a.id) } },
    data: { occupies: false },
  });
  return released.length;
}

/** Rejections the client fixes by refreshing slots (409); the rest mean a bad plan (400). Design call 5. */
const TAKEN: ReadonlySet<PlanRejection> = new Set(["EMPLOYEE_UNAVAILABLE", "RESOURCE_UNAVAILABLE", "TOO_SOON"]);

/** Re-validates a plan inside the write transaction and writes its segments. */
@Injectable()
export class AppointmentWriter {
  /** Throws 409 `SLOT_TAKEN` or 400 `VALIDATION_FAILED` (path `segments`) unless the plan is valid in `ctx`. */
  validateOrThrow(ctx: Context, segments: PlannedSegment[]): void {
    const result = validatePlan(ctx, choicesOf(segments), segments);
    if (result.ok) return;
    if (TAKEN.has(result.reason)) throw slotTaken();
    throw invalidRef("segments", result.reason);
  }

  /**
   * Inserts the validated plan's segments (`block_ends_at` = the plan's `blockEnd`, never
   * recomputed). The exclusion constraints are the final guard against a concurrent writer:
   * a 23P01 becomes 409 `SLOT_TAKEN`, and so does a 40P01, because two inserts that collide
   * while both are uncommitted wait on each other and PostgreSQL aborts one of them (the
   * other commits). Either way the transaction is aborted and rolls back.
   */
  async insertSegments(
    tx: Prisma.TransactionClient,
    appt: { id: string; organizationId: string },
    segments: PlannedSegment[],
  ): Promise<void> {
    try {
      await tx.appointmentSegment.createMany({
        data: segments.map((seg) => ({
          organizationId: appt.organizationId,
          appointmentId: appt.id,
          serviceId: seg.serviceId,
          staffUserId: seg.employeeId,
          resourceId: seg.resourceId,
          startsAt: new Date(seg.start),
          endsAt: new Date(seg.end),
          blockEndsAt: new Date(seg.blockEnd),
          durationMin: seg.durationMin,
          priceCents: seg.priceCents,
          occupies: true,
        })),
      });
    } catch (err) {
      if (isExclusionViolation(err) || isDeadlock(err)) throw slotTaken();
      throw err;
    }
  }

  /** Deletes the appointment's segments and inserts the new plan (reschedule and move; design call 6). */
  async replaceSegments(
    tx: Prisma.TransactionClient,
    appt: { id: string; organizationId: string },
    segments: PlannedSegment[],
  ): Promise<void> {
    await tx.appointmentSegment.deleteMany({ where: { appointmentId: appt.id, organizationId: appt.organizationId } });
    await this.insertSegments(tx, appt, segments);
  }
}
