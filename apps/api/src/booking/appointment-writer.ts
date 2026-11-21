import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  validatePlan,
  type Context,
  type Mode,
  type PlannedSegment,
  type PlanRejection,
} from "@beautyspa/availability";
import { utcToWall } from "@beautyspa/datetime";
import { isDeadlock, isExclusionViolation } from "../common/db-errors.js";
import { invalidRef, slotTaken } from "../common/http-errors.js";
import { BookingContextService, type BookingContext } from "./booking-context.service.js";
import { choicesOf } from "./plan-mapping.js";

/**
 * Interactive-transaction options for booking writes. Waiting for `lockOrgBookings` counts
 * toward Prisma's transaction `timeout` (default 5 s), so booking writes get more headroom.
 */
export const BOOKING_TX_OPTIONS = { maxWait: 5000, timeout: 10000 } as const;

/**
 * Takes the organization's booking lock for the rest of the transaction: a transaction-scoped
 * advisory lock keyed `hashtextextended('booking:' || orgId, 0)` (stable 64-bit key). Every
 * booking write transaction takes it first, so concurrent writers of one organization run one
 * after another and the later one re-validates against the earlier one's committed rows. It is
 * per organization, not per location, because an employee's busy time spans locations.
 */
export async function lockOrgBookings(tx: Prisma.TransactionClient, orgId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('booking:' || ${orgId}::text, 0))`;
}

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

/** What `replacePlan` needs to know about the appointment whose plan changes. */
export interface ReplacePlanTarget {
  orgId: string;
  location: { id: string; organizationId: string; timezone: string };
  appointmentId: string;
  mode: Mode;
  now: number;
  override?: boolean;
}

/** Re-validates a plan inside the write transaction and writes its segments. */
@Injectable()
export class AppointmentWriter {
  constructor(private readonly context: BookingContextService) {}

  /** Throws 409 `SLOT_TAKEN` or 400 `VALIDATION_FAILED` (path `segments`) unless the plan is valid in `ctx`. */
  validateOrThrow(ctx: Context, segments: PlannedSegment[]): void {
    const result = validatePlan(ctx, choicesOf(segments), segments);
    if (result.ok) return;
    if (TAKEN.has(result.reason)) throw slotTaken();
    throw invalidRef("segments", result.reason);
  }

  /**
   * Inserts the validated plan's segments (`block_ends_at` = the plan's `blockEnd`, never
   * recomputed). With `lockOrgBookings` held, races are caught by validation; the exclusion
   * constraints stay the final guard for any writer that skipped the lock: a 23P01 becomes
   * 409 `SLOT_TAKEN`, and so does a 40P01 (two uncommitted colliding inserts wait on each
   * other and PostgreSQL aborts one). Either way the transaction rolls back.
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

  /**
   * Swaps an existing appointment's plan inside the caller's write transaction (org booking
   * lock already held): releases the org's expired holds, loads the context for the day of the
   * earliest new segment with the appointment's own segments excluded, validates the new plan
   * (409 `SLOT_TAKEN` / 400 `VALIDATION_FAILED`) and replaces the segments (design call 6).
   * Used by customer reschedule and staff move; returns the context it validated against.
   */
  async replacePlan(
    tx: Prisma.TransactionClient,
    target: ReplacePlanTarget,
    segments: PlannedSegment[],
  ): Promise<BookingContext> {
    const { orgId, location, appointmentId, mode, now, override } = target;
    await releaseExpiredHolds(tx, orgId, new Date(now));
    const earliest = Math.min(...segments.map((s) => s.start));
    const ctx = await this.context.load(tx, orgId, location, {
      mode,
      now,
      date: utcToWall(earliest, location.timezone).date,
      excludeAppointmentId: appointmentId,
      ...(override !== undefined ? { override } : {}),
    });
    this.validateOrThrow(ctx, segments);
    await this.replaceSegments(tx, { id: appointmentId, organizationId: location.organizationId }, segments);
    return ctx;
  }
}
