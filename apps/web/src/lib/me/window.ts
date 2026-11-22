/**
 * Display hint only: whether the cancel/change window is still open. The API decides
 * (`OUTSIDE_CANCEL_WINDOW`), so a stale hint never blocks or allows anything by itself.
 */
export function canChangeOnline(startsAtIso: string, cancelWindowHours: number, nowMs: number): boolean {
  return nowMs <= Date.parse(startsAtIso) - cancelWindowHours * 3_600_000;
}
