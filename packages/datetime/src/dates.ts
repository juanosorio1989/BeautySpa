export type IsoDate = string;
export type WallTime = string;
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** Parses `YYYY-MM-DD` to a UTC-noon epoch ms so arithmetic is unaffected by zones. */
function isoToNoonUtc(date: IsoDate): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new RangeError(`Invalid ISO date: ${date}`);
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return Date.UTC(y, m - 1, d, 12);
}

function noonUtcToIso(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function weekdayOf(date: IsoDate): Weekday {
  return new Date(isoToNoonUtc(date)).getUTCDay() as Weekday;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return noonUtcToIso(isoToNoonUtc(date) + days * DAY);
}

export function datesInRange(from: IsoDate, to: IsoDate): IsoDate[] {
  if (from > to) throw new RangeError(`Invalid range: ${from} > ${to}`);
  const result: IsoDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) result.push(d);
  return result;
}

export { isoToNoonUtc as _isoToNoonUtc };
