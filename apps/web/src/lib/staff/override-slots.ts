import type { Slot } from "@beautyspa/contracts";
import { utcToWall } from "@beautyspa/datetime";

/** "Other time…" lists override slots whose local start is from 06:00 through 22:59. */
export const OVERRIDE_FIRST_HOUR = 6;
export const OVERRIDE_LAST_HOUR = 22;

/** `GET /availability?override=true` covers the whole local day; keep the plausible hours only. */
export function listedOverrideSlots(slots: Slot[], timezone: string): Slot[] {
  return slots.filter((s) => {
    const hour = Number(utcToWall(Date.parse(s.startsAt), timezone).time.slice(0, 2));
    return hour >= OVERRIDE_FIRST_HOUR && hour <= OVERRIDE_LAST_HOUR;
  });
}
