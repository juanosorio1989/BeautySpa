import type { Prisma } from "@prisma/client";
import type { AuditService } from "../audit/audit.service.js";
import { conflict, notFound, outsideCancelWindow } from "../common/http-errors.js";
import { readLocationSettings } from "../common/location-settings.js";
import { APPOINTMENT_INCLUDE, startOf, toAppointmentDto, type AppointmentRow } from "./appointment-mapping.js";

const HOUR = 3_600_000;

/**
 * Whether a customer may still cancel or reschedule an appointment starting at `startsAtMs`:
 * `now <= startsAt - cancelWindowHours` (design call 8).
 */
export function insideCancelWindow(nowMs: number, startsAtMs: number, cancelWindowHours: number): boolean {
  return nowMs <= startsAtMs - cancelWindowHours * HOUR;
}

export interface ChangeableAppointment {
  row: AppointmentRow;
  location: { id: string; organizationId: string; timezone: string };
}

/**
 * Locks the customer's appointment `FOR UPDATE` (filtered by org and customer; otherwise 404),
 * then requires `BOOKED` (else 409 `CONFLICT`) and `insideCancelWindow` of its location (else 409
 * `OUTSIDE_CANCEL_WINDOW`). Call inside the booking transaction, after `lockOrgBookings`.
 */
export async function lockChangeableAppointment(
  tx: Prisma.TransactionClient,
  args: { orgId: string; customerId: string; appointmentId: string; nowMs: number },
): Promise<ChangeableAppointment> {
  const { orgId, customerId, appointmentId: id } = args;
  const [locked] = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM appointment
    WHERE id = ${id}::uuid AND organization_id = ${orgId}::uuid AND customer_id = ${customerId}::uuid
    FOR UPDATE`;
  if (!locked) throw notFound("Appointment");
  const row = await tx.appointment.findUniqueOrThrow({ where: { id }, include: APPOINTMENT_INCLUDE });
  if (row.status !== "BOOKED") throw conflict("Appointment cannot be changed");

  const location = await tx.location.findFirstOrThrow({
    where: { id: row.locationId, organizationId: orgId },
    select: { id: true, organizationId: true, timezone: true, settings: true },
  });
  const { cancelWindowHours } = readLocationSettings(location.settings);
  if (!insideCancelWindow(args.nowMs, startOf(row), cancelWindowHours)) throw outsideCancelWindow();
  return { row, location: { id: location.id, organizationId: location.organizationId, timezone: location.timezone } };
}

/**
 * The customer cancel shared by `POST /me/appointments/:id/cancel` and the manage link: the customer's
 * `BOOKED` appointment inside the cancel window becomes `CANCELLED` by `CUSTOMER` (errors as in
 * `lockChangeableAppointment`), its segments stop occupying time and `manage_version` increments.
 * Audit `appointment.cancel` (actor CUSTOMER). Call inside the booking transaction (`BOOKING_TX_OPTIONS`),
 * after `lockOrgBookings` and after checking the customer is live; the caller sends `events.cancelled`
 * after commit.
 */
export async function cancelByCustomer(
  tx: Prisma.TransactionClient,
  deps: { audit: AuditService; now: Date },
  args: { orgId: string; customerId: string; appointmentId: string; reason: string | null; ip: string | null },
): Promise<AppointmentRow> {
  const { orgId, customerId, appointmentId: id } = args;
  const { row } = await lockChangeableAppointment(tx, {
    orgId,
    customerId,
    appointmentId: id,
    nowMs: deps.now.getTime(),
  });

  await tx.appointmentSegment.updateMany({
    where: { appointmentId: id, organizationId: orgId },
    data: { occupies: false },
  });
  const updated = await tx.appointment.update({
    where: { id, organizationId: orgId },
    data: {
      status: "CANCELLED",
      cancelledAt: deps.now,
      cancelledBy: "CUSTOMER",
      cancelReason: args.reason,
      manageVersion: { increment: 1 },
    },
    include: APPOINTMENT_INCLUDE,
  });
  await deps.audit.record(
    {
      orgId,
      actorType: "CUSTOMER",
      actorId: customerId,
      action: "appointment.cancel",
      entity: "appointment",
      entityId: id,
      before: toAppointmentDto(row),
      after: toAppointmentDto(updated),
      ip: args.ip,
    },
    tx,
  );
  return updated;
}
