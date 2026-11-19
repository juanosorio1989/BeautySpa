import type { DayHours, EndWallTime } from "@beautyspa/contracts";

/**
 * API wall times are "HH:MM"; an end may be "24:00" (end of day). Prisma maps a
 * `@db.Time` column to a `Date` on 1970-01-01 UTC, and `time` cannot hold
 * 24:00, so an end of 24:00 is stored as 00:00. The CHECK constraints accept
 * end = 00:00 only for that meaning (see data-model.md).
 */
const pad = (n: number) => String(n).padStart(2, "0");

/** Reads a `@db.Time` value as "HH:MM"; as an `"end"`, 00:00 means "24:00". */
export function timeToWall(t: Date, role: "start" | "end"): EndWallTime {
  const hh = t.getUTCHours();
  const mm = t.getUTCMinutes();
  if (role === "end" && hh === 0 && mm === 0) return "24:00";
  return `${pad(hh)}:${pad(mm)}`;
}

/** Converts "HH:MM" (or "24:00") to the `Date` Prisma writes to a `@db.Time` column. */
export function wallToTime(w: EndWallTime): Date {
  const hhmm = w === "24:00" ? "00:00" : w;
  return new Date(`1970-01-01T${hhmm}:00.000Z`);
}

/** Maps hour rows to API `DayHours`, sorted by `(weekday, start)`. */
export function dayHoursFromRows(rows: { weekday: number; start: Date; end: Date }[]): DayHours[] {
  return rows
    .map((r) => ({ weekday: r.weekday, start: timeToWall(r.start, "start"), end: timeToWall(r.end, "end") }))
    .sort((a, b) => a.weekday - b.weekday || (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}
