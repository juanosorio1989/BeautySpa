import { localDayBoundsUtc, MINUTE, utcToWall } from "@beautyspa/datetime";
import { AvailabilityError } from "./errors";
import { findServiceOrThrow } from "./lookup";
import {
  assignResourcesCheck,
  beyondHorizon,
  blockEnds,
  earliestStart,
  employeesFit,
  levelTerms,
  prepare,
} from "./plan";
import type { Draft } from "./plan";
import type { Context, Ms, PlanRejection, PlannedSegment, ServiceChoice } from "./types";

type Result = { ok: true } | { ok: false; reason: PlanRejection };
const fail = (reason: PlanRejection): Result => ({ ok: false, reason });

export function validatePlan(ctx: Context, choices: ServiceChoice[], segments: PlannedSegment[]): Result {
  if (choices.length === 0 || choices.length !== segments.length) return fail("MALFORMED_PLAN");
  const drafts: Draft[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const choice = choices[i]!;
    if (seg.serviceId !== choice.serviceId) return fail("MALFORMED_PLAN");
    let service;
    try {
      service = findServiceOrThrow(ctx.services, seg.serviceId);
    } catch (e) {
      if (e instanceof AvailabilityError) return fail("MALFORMED_PLAN");
      throw e;
    }
    if (ctx.mode === "ONLINE" && !service.onlineBookable) return fail("NOT_BOOKABLE_ONLINE");
    const employee = ctx.employees.find((e) => e.id === seg.employeeId);
    if (!employee || !employee.serviceIds.includes(service.id)) return fail("NOT_QUALIFIED");
    if (choice.employeeId !== "ANY" && choice.employeeId !== employee.id) return fail("NOT_QUALIFIED");
    if (ctx.mode === "ONLINE" && !employee.bookableOnline) return fail("NOT_BOOKABLE_ONLINE");
    const terms = levelTerms(service, employee);
    if (
      seg.durationMin !== terms.durationMin ||
      seg.priceCents !== terms.priceCents ||
      seg.end - seg.start !== terms.durationMin * MINUTE
    ) {
      return fail("MALFORMED_PLAN");
    }
    drafts.push({ employee, service, start: seg.start, end: seg.end, ...terms });
  }

  const t = Math.min(...segments.map((s) => s.start));
  const date = utcToWall(t, ctx.location.timezone).date;
  const { start: dayStart, end: dayEnd } = localDayBoundsUtc(date, ctx.location.timezone);
  if (beyondHorizon(ctx, date)) return fail("BEYOND_HORIZON");
  if (t < earliestStart(ctx, dayStart)) return fail("TOO_SOON");
  if ((t - dayStart) % (ctx.location.slotIntervalMin * MINUTE) !== 0) return fail("MALFORMED_PLAN");
  if (segments.some((s) => s.end > dayEnd)) return fail("MALFORMED_PLAN");
  if (!shapeOk(drafts, t)) return fail("MALFORMED_PLAN");

  const blocks = blockEnds(drafts.map((d) => ({ employeeId: d.employee.id, start: d.start, end: d.end, bufferMin: d.service.bufferAfterMin })));
  if (segments.some((s, i) => s.blockEnd !== blocks[i])) return fail("MALFORMED_PLAN");

  const p = prepare(ctx, date);
  if (!employeesFit(p, drafts, blocks)) return fail("EMPLOYEE_UNAVAILABLE");
  const resourceIds = segments.map((s) => s.resourceId);
  const needs = drafts.map((d) => d.service.resourceTypeId !== null);
  if (resourceIds.some((id, i) => (id !== null) !== needs[i])) {
    return fail(needs.some((x, i) => x && resourceIds[i] === null) ? "RESOURCE_UNAVAILABLE" : "MALFORMED_PLAN");
  }
  return assignResourcesCheck(p, drafts, blocks, resourceIds) ? { ok: true } : fail("RESOURCE_UNAVAILABLE");
}

/** Plan shape: fully sequential from `t`, or parallel block of all parallelizable services at `t` then the rest. */
function shapeOk(drafts: Draft[], t: Ms): boolean {
  const sequential = drafts.every((d, i) => d.start === (i === 0 ? t : drafts[i - 1]!.end));
  if (sequential) return true;
  const block = drafts.filter((d) => d.service.parallelizable);
  if (block.length < 2) return false;
  let cursor = Math.max(...block.map((d) => d.end));
  for (const d of drafts) {
    if (d.service.parallelizable) {
      if (d.start !== t) return false;
    } else {
      if (d.start !== cursor) return false;
      cursor = d.end;
    }
  }
  return true;
}
