import type { PlannedSegment, ServiceChoice, Slot } from "@beautyspa/contracts";
import type { PlannedSegment as EnginePlannedSegment, Slot as EngineSlot } from "@beautyspa/availability";

const iso = (ms: number) => new Date(ms).toISOString();

/** Engine slot (epoch ms) to API slot (ISO instants). */
export function toSlotDto(s: EngineSlot): Slot {
  return {
    startsAt: iso(s.start),
    endsAt: iso(s.end),
    segments: s.segments.map((g) => ({
      serviceId: g.serviceId,
      employeeId: g.employeeId,
      resourceId: g.resourceId,
      startsAt: iso(g.start),
      endsAt: iso(g.end),
      blockEndsAt: iso(g.blockEnd),
      durationMin: g.durationMin,
      priceCents: g.priceCents,
    })),
  };
}

/** API segments (ISO instants) to engine segments (epoch ms). */
export function toEngineSegments(segments: PlannedSegment[]): EnginePlannedSegment[] {
  return segments.map((s) => ({
    serviceId: s.serviceId,
    employeeId: s.employeeId,
    resourceId: s.resourceId,
    start: Date.parse(s.startsAt),
    end: Date.parse(s.endsAt),
    blockEnd: Date.parse(s.blockEndsAt),
    durationMin: s.durationMin,
    priceCents: s.priceCents,
  }));
}

/** The concrete (service, employee) choice of each segment. */
export function choicesOf(segments: Pick<PlannedSegment, "serviceId" | "employeeId">[]): ServiceChoice[] {
  return segments.map((s) => ({ serviceId: s.serviceId, employeeId: s.employeeId }));
}
