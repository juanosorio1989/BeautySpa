import type { Appointment } from "@beautyspa/contracts";

/** Codes the system writes as `cancelReason`; they are not text for people. */
const SYSTEM_CANCEL_REASONS = new Set(["HOLD_EXPIRED", "ACCOUNT_DELETED"]);

/**
 * The cancel reason worth showing to the customer: their own text. The API already sends `null`
 * for reasons written by staff (the customer DTO has no `cancelledBy`), so only system codes are
 * left to hide.
 */
export function customerCancelReason(appointment: Pick<Appointment, "cancelReason">): string | null {
  const reason = appointment.cancelReason;
  return reason && !SYSTEM_CANCEL_REASONS.has(reason) ? reason : null;
}
