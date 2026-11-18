import { addDays, localDayBoundsUtc, MINUTE, todayIn } from "@beautyspa/datetime";
import type { IsoDate } from "@beautyspa/datetime";
import { employeeFreeTime, resourceFreeTime } from "./free-time";
import { covers } from "./intervals";
import type {
  Context,
  EmployeeInput,
  Interval,
  Ms,
  PlannedSegment,
  ResourceInput,
  ServiceChoice,
  ServiceInput,
} from "./types";

/** Per-call precomputed data: free time per employee/resource, booked minutes per employee. */
export interface Prepared {
  ctx: Context;
  date: IsoDate;
  dayStart: Ms;
  dayEnd: Ms;
  employeeFree: Map<string, Interval[]>;
  resourceFree: Map<string, Interval[]>;
  booked: Map<string, number>;
}

export function prepare(ctx: Context, date: IsoDate): Prepared {
  const { location, busy } = ctx;
  const ignoreHours = ctx.mode === "STAFF" && ctx.override === true;
  const { start: dayStart, end: dayEnd } = localDayBoundsUtc(date, location.timezone);
  const employeeFree = new Map<string, Interval[]>();
  const booked = new Map<string, number>();
  for (const employee of ctx.employees) {
    employeeFree.set(employee.id, employeeFreeTime({ employee, location, date, busy, ignoreHours }));
    // R3: booked minutes come only from the input busy list.
    const minutes = busy
      .filter((b) => b.employeeId === employee.id && b.start >= dayStart && b.start < dayEnd)
      .reduce((sum, b) => sum + (b.blockEnd - b.start) / MINUTE, 0);
    booked.set(employee.id, minutes);
  }
  const resourceFree = new Map<string, Interval[]>();
  for (const resource of ctx.resources) {
    resourceFree.set(resource.id, resourceFreeTime({ resource, location, date, busy }));
  }
  return { ctx, date, dayStart, dayEnd, employeeFree, resourceFree, booked };
}

/** Duration and price for a (service, employee) pair: level override, else defaults. */
export function levelTerms(service: ServiceInput, employee: EmployeeInput): { durationMin: number; priceCents: number } {
  const override = employee.levelId === null ? undefined : service.levelOverrides[employee.levelId];
  return override ?? { durationMin: service.durationMin, priceCents: service.priceCents };
}

/** Earliest allowed start for the given day, on the slot grid. */
export function earliestStart(ctx: Context, dayStart: Ms): Ms {
  if (ctx.mode === "ONLINE") return ctx.now + ctx.location.minLeadMinutes * MINUTE;
  const step = ctx.location.slotIntervalMin * MINUTE;
  if (ctx.now <= dayStart) return dayStart;
  return dayStart + Math.floor((ctx.now - dayStart) / step) * step;
}

export function beyondHorizon(ctx: Context, date: IsoDate): boolean {
  if (ctx.mode !== "ONLINE") return false;
  const today = todayIn(ctx.location.timezone, ctx.now);
  return date > addDays(today, ctx.location.bookingHorizonDays);
}

/** Qualified employees for a choice, ordered for assignment. Explicit choices yield one candidate. */
export function candidatesFor(p: Prepared, service: ServiceInput, choice: ServiceChoice): EmployeeInput[] {
  const { ctx } = p;
  const eligible = ctx.employees.filter(
    (e) =>
      e.serviceIds.includes(service.id) &&
      (ctx.mode === "STAFF" || e.bookableOnline) &&
      (choice.employeeId === "ANY" || e.id === choice.employeeId),
  );
  return eligible.sort(
    (a, b) => (p.booked.get(a.id) ?? 0) - (p.booked.get(b.id) ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

export interface Draft {
  employee: EmployeeInput;
  service: ServiceInput;
  start: Ms;
  end: Ms;
  durationMin: number;
  priceCents: number;
}

/**
 * Buffer blocks the employee/resource after a segment, except when the same employee
 * starts another segment exactly at its end (one client's back-to-back services).
 */
export function blockEnds(drafts: { employeeId: string; start: Ms; end: Ms; bufferMin: number }[]): Ms[] {
  return drafts.map((d) =>
    drafts.some((o) => o !== d && o.employeeId === d.employeeId && o.start === d.end)
      ? d.end
      : d.end + d.bufferMin * MINUTE,
  );
}

const overlaps = (a: Interval, b: Interval): boolean => a.start < b.end && b.start < a.end;

/** Employee-side checks: free time covers each block, and no employee is double-used in the plan. */
export function employeesFit(p: Prepared, drafts: Draft[], blocks: Ms[]): boolean {
  for (let i = 0; i < drafts.length; i++) {
    const d = drafts[i]!;
    const range = { start: d.start, end: blocks[i]! };
    if (!covers(p.employeeFree.get(d.employee.id) ?? [], range)) return false;
    for (let j = 0; j < i; j++) {
      if (drafts[j]!.employee.id === d.employee.id && overlaps(range, { start: drafts[j]!.start, end: blocks[j]! })) {
        return false;
      }
    }
  }
  return true;
}

/** Resource of the right type, first by name, that is free and unused by the rest of the plan. */
function resourcesOfType(p: Prepared, typeId: string): ResourceInput[] {
  return p.ctx.resources
    .filter((r) => r.resourceTypeId === typeId)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1));
}

/** Assign resources with backtracking; returns resource id (or null) per draft, or null if impossible. */
export function assignResources(p: Prepared, drafts: Draft[], blocks: Ms[]): (string | null)[] | null {
  const result: (string | null)[] = drafts.map(() => null);
  const rec = (i: number): boolean => {
    if (i === drafts.length) return true;
    const d = drafts[i]!;
    if (d.service.resourceTypeId === null) return rec(i + 1);
    const range = { start: d.start, end: blocks[i]! };
    for (const r of resourcesOfType(p, d.service.resourceTypeId)) {
      if (!covers(p.resourceFree.get(r.id) ?? [], range)) continue;
      let clash = false;
      for (let j = 0; j < i; j++) {
        if (result[j] === r.id && overlaps(range, { start: drafts[j]!.start, end: blocks[j]! })) clash = true;
      }
      if (clash) continue;
      result[i] = r.id;
      if (rec(i + 1)) return true;
      result[i] = null;
    }
    return false;
  };
  return rec(0) ? result : null;
}

export type Shape = "parallel" | "sequential";

/** Try to plan all choices at start `t` with the given shape; returns segments in client order. */
export function planAt(
  p: Prepared,
  services: ServiceInput[],
  candidates: EmployeeInput[][],
  t: Ms,
  shape: Shape,
): PlannedSegment[] | null {
  const n = services.length;
  const parallelIdx = services.map((s, i) => (s.parallelizable ? i : -1)).filter((i) => i >= 0);
  if (shape === "parallel" && parallelIdx.length < 2) return null;
  const order =
    shape === "parallel"
      ? [...parallelIdx, ...services.map((_, i) => i).filter((i) => !parallelIdx.includes(i))]
      : services.map((_, i) => i);
  const drafts: (Draft | undefined)[] = new Array<Draft | undefined>(n).fill(undefined);

  const finish = (): PlannedSegment[] | null => {
    const all = drafts as Draft[];
    const blocks = blockEnds(all.map((d) => ({ employeeId: d.employee.id, start: d.start, end: d.end, bufferMin: d.service.bufferAfterMin })));
    if (!employeesFit(p, all, blocks)) return null;
    const resources = assignResources(p, all, blocks);
    if (resources === null) return null;
    return all.map((d, i) => ({
      serviceId: d.service.id,
      employeeId: d.employee.id,
      resourceId: resources[i] ?? null,
      start: d.start,
      end: d.end,
      blockEnd: blocks[i]!,
      durationMin: d.durationMin,
      priceCents: d.priceCents,
    }));
  };

  const rec = (k: number, cursor: Ms): PlannedSegment[] | null => {
    if (k === n) return finish();
    const idx = order[k]!;
    const service = services[idx]!;
    const inBlock = shape === "parallel" && service.parallelizable;
    const start = inBlock ? t : cursor;
    for (const employee of candidates[idx]!) {
      const { durationMin, priceCents } = levelTerms(service, employee);
      const end = start + durationMin * MINUTE;
      if (!covers(p.employeeFree.get(employee.id) ?? [], { start, end })) continue;
      if (drafts.some((d) => d !== undefined && d.employee.id === employee.id && overlaps({ start, end }, d))) continue;
      drafts[idx] = { employee, service, start, end, durationMin, priceCents };
      // Parallel block ends when its last member is placed: next cursor is the max end so far.
      const nextCursor = inBlock
        ? k + 1 < n && !(services[order[k + 1]!]!.parallelizable)
          ? Math.max(...drafts.filter((d): d is Draft => d !== undefined).map((d) => d.end))
          : cursor
        : end;
      const found = rec(k + 1, nextCursor);
      if (found) return found;
      drafts[idx] = undefined;
    }
    return null;
  };
  return rec(0, t);
}

/** Validate caller-provided resource ids against free time, type, and in-plan overlap. */
export function assignResourcesCheck(p: Prepared, drafts: Draft[], blocks: Ms[], ids: (string | null)[]): boolean {
  for (let i = 0; i < drafts.length; i++) {
    const id = ids[i];
    const typeId = drafts[i]!.service.resourceTypeId;
    if (id === null || id === undefined || typeId === null) continue;
    const resource = p.ctx.resources.find((r) => r.id === id);
    if (!resource || resource.resourceTypeId !== typeId) return false;
    const range = { start: drafts[i]!.start, end: blocks[i]! };
    if (!covers(p.resourceFree.get(id) ?? [], range)) return false;
    for (let j = 0; j < i; j++) {
      if (ids[j] === id && overlaps(range, { start: drafts[j]!.start, end: blocks[j]! })) return false;
    }
  }
  return true;
}
