import { addDays, todayIn } from "@beautyspa/datetime";
import type { Locale } from "@beautyspa/i18n";

export { todayIn };

/** Local calendar dates `YYYY-MM-DD` from today through today + horizonDays - 1 (calendar arithmetic, DST-safe). */
export function dateStrip(todayIso: string, horizonDays: number): string[] {
  return Array.from({ length: Math.max(0, horizonDays) }, (_, i) => addDays(todayIso, i));
}

/** Short weekday and day number of a calendar date; the date has no zone, so format it in UTC. */
export function dayLabel(date: string, locale: Locale): { weekday: string; day: string } {
  const instant = new Date(`${date}T12:00:00Z`);
  const intl = locale === "en" ? "en-US" : "es-US";
  return {
    weekday: new Intl.DateTimeFormat(intl, { weekday: "short", timeZone: "UTC" }).format(instant),
    day: new Intl.DateTimeFormat(intl, { day: "numeric", timeZone: "UTC" }).format(instant),
  };
}
