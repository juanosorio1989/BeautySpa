import { MINUTE } from "@beautyspa/datetime";
import { AvailabilityError } from "./errors";
import { findServiceOrThrow } from "./lookup";
import { MAX_CHOICES, beyondHorizon, candidatesFor, earliestStart, planAt, prepare } from "./plan";
import type { FindSlotsInput, ServiceInput, Slot } from "./types";

export function findSlots(input: FindSlotsInput): Slot[] {
  const { choices, date, ctx } = split(input);
  if (choices.length === 0) throw new AvailabilityError("NO_SERVICES");
  if (choices.length > MAX_CHOICES) throw new AvailabilityError("TOO_MANY_SERVICES");

  const services: ServiceInput[] = choices.map((c) => {
    return findServiceOrThrow(ctx.services, c.serviceId);
  });
  for (const c of choices) {
    if (c.employeeId !== "ANY" && !ctx.employees.some((e) => e.id === c.employeeId)) {
      throw new AvailabilityError("UNKNOWN_EMPLOYEE", `unknown employee ${c.employeeId}`);
    }
  }
  if (ctx.mode === "ONLINE" && services.some((s) => !s.onlineBookable)) return [];
  if (beyondHorizon(ctx, date)) return [];

  const p = prepare(ctx, date);
  const candidates = services.map((s, i) => candidatesFor(p, s, choices[i]!));
  if (candidates.some((list) => list.length === 0)) return [];

  const step = ctx.location.slotIntervalMin * MINUTE;
  const earliest = earliestStart(ctx, p.dayStart);
  const slots: Slot[] = [];
  for (let t = p.dayStart; t < p.dayEnd; t += step) {
    if (t < earliest) continue;
    const segments = planAt(p, services, candidates, t, "parallel") ?? planAt(p, services, candidates, t, "sequential");
    if (segments) {
      slots.push({ start: t, end: Math.max(...segments.map((s) => s.end)), segments });
    }
  }
  return slots;
}

function split(input: FindSlotsInput) {
  const { choices, date, ...ctx } = input;
  return { choices, date, ctx };
}
