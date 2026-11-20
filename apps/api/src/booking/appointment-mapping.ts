import type { Prisma } from "@prisma/client";
import type { Appointment, StaffAppointment } from "@beautyspa/contracts";

/** Prisma include for every appointment read that is mapped to a DTO. */
export const APPOINTMENT_INCLUDE = {
  segments: { orderBy: [{ startsAt: "asc" }, { id: "asc" }] },
  customer: { select: { id: true, name: true, phoneE164: true } },
} as const satisfies Prisma.AppointmentInclude;

export type AppointmentRow = Prisma.AppointmentGetPayload<{ include: typeof APPOINTMENT_INCLUDE }>;

const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);

/** Customer-facing shape: `startsAt` = earliest segment start, `endsAt` = latest segment end. */
export function toAppointmentDto(row: AppointmentRow): Appointment {
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

/** Staff shape: the customer summary and who created or cancelled it. */
export function toStaffAppointmentDto(row: AppointmentRow): StaffAppointment {
  return {
    ...toAppointmentDto(row),
    customer: row.customer ? { id: row.customer.id, name: row.customer.name, phoneE164: row.customer.phoneE164 } : null,
    createdByStaffId: row.createdByStaffId,
    cancelledBy: row.cancelledBy,
  };
}
