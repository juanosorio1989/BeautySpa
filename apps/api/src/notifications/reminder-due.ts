import type { TemplateKey } from "./templates/types.js";

/**
 * Reminder kinds. `offsetMs`: how long before the start the reminder is due. `lateMs`: it is no longer sent once
 * fewer than `lateMs` remain before the start (the 24 h one yields to the 2 h one; the 2 h one stops at the start).
 */
export const REMINDERS = [
  { key: "appointment.reminder_24h", offsetMs: 86_400_000, lateMs: 7_200_000 },
  { key: "appointment.reminder_2h", offsetMs: 7_200_000, lateMs: 0 },
] as const satisfies readonly { key: TemplateKey; offsetMs: number; lateMs: number }[];

export type Reminder = (typeof REMINDERS)[number];

/**
 * Pure source of truth for the scan predicate (the SQL in `ReminderScanner` mirrors it): due, booked at least
 * `offset` before the start, and not too late.
 */
export function isReminderDue(
  r: Pick<Reminder, "offsetMs" | "lateMs">,
  a: { startsAt: Date; timesSetAt: Date },
  nowMs: number,
): boolean {
  const start = a.startsAt.getTime();
  const dueAt = start - r.offsetMs;
  return dueAt <= nowMs && dueAt >= a.timesSetAt.getTime() && nowMs < start - r.lateMs;
}
