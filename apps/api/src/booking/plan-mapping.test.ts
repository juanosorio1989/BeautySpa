import { describe, expect, it } from "vitest";
import type { PlannedSegment } from "@beautyspa/contracts";
import { choicesOf, toEngineSegments, toSlotDto } from "./plan-mapping.js";

const seg: PlannedSegment = {
  serviceId: "11111111-1111-4111-8111-111111111111",
  employeeId: "22222222-2222-4222-8222-222222222222",
  resourceId: null,
  startsAt: "2026-12-01T14:00:00.000Z",
  endsAt: "2026-12-01T14:30:00.000Z",
  blockEndsAt: "2026-12-01T14:35:00.000Z",
  durationMin: 30,
  priceCents: 2500,
};

describe("plan mapping", () => {
  it("round-trips a segment between ISO and epoch ms", () => {
    const [engine] = toEngineSegments([seg]);
    expect(engine).toEqual({
      serviceId: seg.serviceId,
      employeeId: seg.employeeId,
      resourceId: null,
      start: Date.parse(seg.startsAt),
      end: Date.parse(seg.endsAt),
      blockEnd: Date.parse(seg.blockEndsAt),
      durationMin: 30,
      priceCents: 2500,
    });
    const slot = toSlotDto({ start: engine!.start, end: engine!.end, segments: [engine!] });
    expect(slot).toEqual({ startsAt: seg.startsAt, endsAt: seg.endsAt, segments: [seg] });
  });

  it("lists the concrete choice of each segment", () => {
    expect(choicesOf([seg])).toEqual([{ serviceId: seg.serviceId, employeeId: seg.employeeId }]);
  });
});
