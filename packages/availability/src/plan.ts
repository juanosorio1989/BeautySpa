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

export const MAX_CHOICES = 4;
/** Safety net: search nodes per start time and shape; beyond it that start yields no plan. */
export const MAX_NODES_PER_START = 5000;

/**
 * Buffer blocks the employee/resource after a segment, except when the same employee starts
 * another segment exactly at its end AND the segment needs no resource or that next segment
 * uses the same resource (a chair is never released early).
 */
export function blockEnds(drafts: Draft[], resourceIds: (string | null)[]): Ms[] {
  return drafts.map((d, i) => {
    const dropped = drafts.some(
      (o, j) =>
        j !== i &&
        o.employee.id === d.employee.id &&
        o.start === d.end &&
        (d.service.resourceTypeId === null || resourceIds[j] === resourceIds[i]),
    );
    return dropped ? d.end : d.end + d.service.bufferAfterMin * MINUTE;
  });
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

/**
 * Assign resources with backtracking. With `lowerBound`, only the lower-bound blocks `lbBlocks`
 * (default: `end`, i.e. every buffer dropped) are checked, a necessary condition used for pruning. Otherwise the full plan (resources
 * and employees with the real blocks) is verified. Returns resource ids and blocks, or null.
 */
export function assignResources(
  p: Prepared,
  drafts: Draft[],
  lowerBound: boolean,
  lbBlocks?: Ms[],
): { ids: (string | null)[]; blocks: Ms[] } | null {
  const ids: (string | null)[] = drafts.map(() => null);
  const minRange = (i: number): Interval => ({ start: drafts[i]!.start, end: lbBlocks?.[i] ?? drafts[i]!.end });
  const rec = (i: number): { ids: (string | null)[]; blocks: Ms[] } | null => {
    if (i === drafts.length) {
      if (lowerBound) return { ids: [...ids], blocks: drafts.map((d, j) => lbBlocks?.[j] ?? d.end) };
      const blocks = blockEnds(drafts, ids);
      return employeesFit(p, drafts, blocks) && resourcesFit(p, drafts, blocks, ids) ? { ids: [...ids], blocks } : null;
    }
    const d = drafts[i]!;
    if (d.service.resourceTypeId === null) return rec(i + 1);
    for (const r of resourcesOfType(p, d.service.resourceTypeId)) {
      if (!covers(p.resourceFree.get(r.id) ?? [], minRange(i))) continue;
      if (ids.some((x, j) => j < i && x === r.id && overlaps(minRange(i), minRange(j)))) continue;
      ids[i] = r.id;
      const found = rec(i + 1);
      if (found) return found;
      ids[i] = null;
    }
    return null;
  };
  return rec(0);
}

export type Shape = "parallel" | "sequential";

/** Try to plan all choices at start `t` with the given shape; returns segments in client order. */
export function planAt(
  p: Prepared,
  services: ServiceInput[],
  candidates: EmployeeInput[][],
  t: Ms,
  shape: Shape,
  maxNodes: number = MAX_NODES_PER_START,
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
    const found = assignResources(p, all, false);
    if (found === null) return null;
    return all.map((d, i) => ({
      serviceId: d.service.id,
      employeeId: d.employee.id,
      resourceId: found.ids[i] ?? null,
      start: d.start,
      end: d.end,
      blockEnd: found.blocks[i]!,
      durationMin: d.durationMin,
      priceCents: d.priceCents,
    }));
  };

  let nodes = 0;
  const freeKey = (e: EmployeeInput): string => JSON.stringify(p.employeeFree.get(e.id) ?? []);

  /** Sound lower bound of each placed segment's block: keep the buffer unless it can still be dropped. */
  const lowerBlocks = (placed: Draft[], nextCursor: Ms, unplacedParallel: boolean, maxParallelEnd: Ms): Ms[] =>
    placed.map((d) => {
      const dropPossible =
        placed.some((o) => o !== d && o.employee.id === d.employee.id && o.start === d.end) ||
        (placed.length < n && (d.end === nextCursor || (unplacedParallel && d.end >= maxParallelEnd)));
      return dropPossible ? d.end : d.end + d.service.bufferAfterMin * MINUTE;
    });

  const rec = (k: number, cursor: Ms): PlannedSegment[] | null => {
    if (k === n) return finish();
    const seen = new Set<string>();
    const idx = order[k]!;
    const service = services[idx]!;
    const inBlock = shape === "parallel" && service.parallelizable;
    const start = inBlock ? t : cursor;
    for (const employee of candidates[idx]!) {
      const { durationMin, priceCents } = levelTerms(service, employee);
      const end = start + durationMin * MINUTE;
      if (!covers(p.employeeFree.get(employee.id) ?? [], { start, end })) continue;
      if (drafts.some((d) => d !== undefined && d.employee.id === employee.id && overlaps({ start, end }, d))) continue;
      // Symmetry: interchangeable = same terms for this and every remaining choice, same candidacy, same free time (unless already in the plan).
      const used = drafts.some((d) => d !== undefined && d.employee.id === employee.id);
      const remaining = order
        .slice(k + 1)
        .map((j) => (candidates[j]!.includes(employee) ? JSON.stringify(levelTerms(services[j]!, employee)) : "-"))
        .join("|");
      const key = used ? `id:${employee.id}` : `${durationMin}|${priceCents}|${remaining}|${freeKey(employee)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (++nodes > maxNodes) return null;
      drafts[idx] = { employee, service, start, end, durationMin, priceCents };
      const placed = drafts.filter((d): d is Draft => d !== undefined);
      // Parallel block ends when its last member is placed: next cursor is the max end so far.
      const nextCursor = inBlock
        ? k + 1 < n && !(services[order[k + 1]!]!.parallelizable)
          ? Math.max(...placed.map((d) => d.end))
          : cursor
        : end;
      const unplacedParallel = shape === "parallel" && order.slice(k + 1).some((i) => services[i]!.parallelizable);
      const maxParallelEnd = Math.max(...placed.filter((d) => d.service.parallelizable).map((d) => d.end), 0);
      const lb = lowerBlocks(placed, nextCursor, unplacedParallel, maxParallelEnd);
      // Prune: placed segments must be employee- and resource-feasible with the lower-bound blocks.
      if (!employeesFit(p, placed, lb) || assignResources(p, placed, true, lb) === null) {
        drafts[idx] = undefined;
        continue;
      }
      const found = rec(k + 1, nextCursor);
      if (found) return found;
      drafts[idx] = undefined;
    }
    return null;
  };
  return rec(0, t);
}

/** Check resource ids against free time, type, and in-plan overlap using the given blocks. */
export function resourcesFit(p: Prepared, drafts: Draft[], blocks: Ms[], ids: (string | null)[]): boolean {
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
