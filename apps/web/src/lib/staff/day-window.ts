import type { AgendaEmployee } from "@beautyspa/contracts";
import { wallTimeToUtc, type IsoDate } from "@beautyspa/datetime";

/**
 * Timeline bounds of a day: earliest range start to latest range end across `employees`
 * (epoch ms). When nobody works, local 09:00-19:00 of `date` in `timeZone`.
 */
export function dayWindow(
  employees: AgendaEmployee[],
  date: IsoDate,
  timeZone: string,
): { start: number; end: number } {
  const ranges = employees.flatMap((e) => e.ranges);
  if (ranges.length === 0) {
    return { start: wallTimeToUtc(date, "09:00", timeZone), end: wallTimeToUtc(date, "19:00", timeZone) };
  }
  return {
    start: Math.min(...ranges.map((r) => Date.parse(r.start))),
    end: Math.max(...ranges.map((r) => Date.parse(r.end))),
  };
}
