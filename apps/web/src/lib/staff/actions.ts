import type { StaffAppointment, StaffMe } from "@beautyspa/contracts";
import { todayIn, utcToWall } from "@beautyspa/datetime";

export type StaffAction = "checkIn" | "complete" | "noShow" | "move" | "cancel";

export interface ActionContext {
  role: StaffMe["role"];
  meId: string;
  now: number;
  timeZone: string;
}

/**
 * Buttons to show for an appointment. A hint only: the API decides (409/403 are still handled).
 * `enabledFrom` (epoch ms) means the action is shown disabled until then.
 */
export function allowedActions(
  a: StaffAppointment,
  ctx: ActionContext,
): { action: StaffAction; enabledFrom?: number }[] {
  const out: { action: StaffAction; enabledFrom?: number }[] = [];
  const startsAt = Date.parse(a.startsAt);
  // check in / complete only from the appointment's own local day
  const dayStarted = todayIn(ctx.timeZone, ctx.now) >= utcToWall(startsAt, ctx.timeZone).date;
  const booked = a.status === "BOOKED";
  const open = booked || a.status === "CHECKED_IN";

  if (booked && dayStarted) out.push({ action: "checkIn" });
  if (open && dayStarted) out.push({ action: "complete" });

  if (ctx.role === "EMPLOYEE") {
    return a.segments.some((s) => s.employeeId === ctx.meId) ? out : [];
  }

  if (booked) out.push(ctx.now < startsAt ? { action: "noShow", enabledFrom: startsAt } : { action: "noShow" });
  if (open) out.push({ action: "move" }, { action: "cancel" });
  return out;
}
