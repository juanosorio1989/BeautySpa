import type { Prisma } from "@prisma/client";
import type { Appointment, StaffAppointment } from "@beautyspa/contracts";

/** Prisma include for every appointment read that is mapped to a DTO. */
export const APPOINTMENT_INCLUDE = {
  segments: { orderBy: [{ startsAt: "asc" }, { id: "asc" }] },
  customer: { select: { id: true, name: true, phoneE164: true, deletedAt: true } },
} as const satisfies Prisma.AppointmentInclude;

export type AppointmentRow = Prisma.AppointmentGetPayload<{ include: typeof APPOINTMENT_INCLUDE }>;

/** Earliest segment start (epoch ms) of an appointment, as in the DTO's `startsAt`. */
export const startOf = (row: Pick<AppointmentRow, "segments">): number =>
  Math.min(...row.segments.map((s) => s.startsAt.getTime()));

const UPCOMING_STATUSES = new Set(["BOOKED", "CHECKED_IN"]);

/** Latest segment end (epoch ms), as in the DTO's `endsAt`. */
const endOf = (row: Pick<AppointmentRow, "segments">): number =>
  Math.max(...row.segments.map((s) => s.endsAt.getTime()));

/** The upcoming/past split of customer and staff views: `BOOKED` or `CHECKED_IN` ending after `now`. */
export const isUpcoming = (row: AppointmentRow, now: number): boolean =>
  UPCOMING_STATUSES.has(row.status) && endOf(row) > now;

const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);

/**
 * The full `Appointment` shape, staff cancel reasons included: audit snapshots and the base of
 * the staff DTO. Never send it to a customer (use `toAppointmentDto`).
 * `startsAt` = earliest segment start, `endsAt` = latest segment end.
 */
export function toAppointmentRecord(row: AppointmentRow): Appointment {
  if (row.segments.length === 0) throw new Error(`Appointment ${row.id} has no segments`);
  const starts = row.segments.map((s) => s.startsAt.getTime());
  const ends = row.segments.map((s) => s.endsAt.getTime());
  return {
    id: row.id,
    locationId: row.locationId,
    status: row.status,
    source: row.source,
    startsAt: new Date(Math.min(...starts)).toISOString(),
    endsAt: new Date(Math.max(...ends)).toISOString(),
    totalPriceCents: row.segments.reduce((sum, s) => sum + s.priceCents, 0),
    notes: row.notes,
    segments: row.segments.map((s) => ({
      id: s.id,
      serviceId: s.serviceId,
      employeeId: s.staffUserId,
      resourceId: s.resourceId,
      startsAt: iso(s.startsAt),
      endsAt: iso(s.endsAt),
      blockEndsAt: iso(s.blockEndsAt),
      durationMin: s.durationMin,
      priceCents: s.priceCents,
    })),
    confirmedByCustomerAt: isoOrNull(row.confirmedByCustomerAt),
    cancelledAt: isoOrNull(row.cancelledAt),
    cancelReason: row.cancelReason,
    createdAt: iso(row.createdAt),
  };
}

/**
 * Customer-facing shape: like `toAppointmentRecord`, but a reason written by staff
 * (`cancelledBy` `STAFF`) is internal and reads as `cancelReason: null`.
 */
export function toAppointmentDto(row: AppointmentRow): Appointment {
  const dto = toAppointmentRecord(row);
  return row.cancelledBy === "STAFF" ? { ...dto, cancelReason: null } : dto;
}

/** Staff shape: the real cancel reason, the customer summary (`reachable` from `loadReachable`) and who created or cancelled it. */
export function toStaffAppointmentDto(row: AppointmentRow, reachable: ReadonlySet<string>): StaffAppointment {
  return {
    ...toAppointmentRecord(row),
    customer: row.customer
      ? {
          id: row.customer.id,
          name: row.customer.name,
          phoneE164: row.customer.phoneE164,
          reachable: reachable.has(row.customer.id),
          deleted: row.customer.deletedAt !== null,
        }
      : null,
    createdByStaffId: row.createdByStaffId,
    cancelledBy: row.cancelledBy,
  };
}
