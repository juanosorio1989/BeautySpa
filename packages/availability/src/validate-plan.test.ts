import { describe, expect, it } from "vitest";
import {
  ana,
  ANA_ID,
  at,
  bea,
  BEA_ID,
  carla,
  CARLA_ID,
  chair1,
  CHAIR_1_ID,
  chair2,
  CHAIR_2_ID,
  dani,
  gel,
  haircut,
  location,
  mani,
  MANI_ID,
  MON,
  pedi,
  PEDI_ID,
  DANI_ID,
  HAIRCUT_ID,
} from "../test/fixtures";
import { findSlots } from "./find-slots";
import { validatePlan } from "./validate-plan";
import type { Context, PlannedSegment, ServiceChoice } from "./types";

const NOW = Date.parse("2026-12-06T12:00:00Z");
const ctx: Context = {
  location,
  services: [mani, pedi, gel, haircut],
  employees: [ana, bea, carla, dani],
  resources: [chair1, chair2],
  busy: [],
  mode: "ONLINE",
  now: NOW,
};
const choices: ServiceChoice[] = [
  { serviceId: MANI_ID, employeeId: "ANY" },
  { serviceId: PEDI_ID, employeeId: "ANY" },
];
const plan = (cs = choices, c = ctx) => findSlots({ ...c, choices: cs, date: MON })[0]!.segments;
const withSeg = (segs: PlannedSegment[], i: number, o: Partial<PlannedSegment>) =>
  segs.map((s, k) => (k === i ? { ...s, ...o } : s));
const reason = (segs: PlannedSegment[], c = ctx, cs = choices) => {
  const r = validatePlan(c, cs, segs);
  return r.ok ? "ok" : r.reason;
};

describe("validatePlan", () => {
  it("accepts a plan produced by findSlots", () => {
    expect(validatePlan(ctx, choices, plan())).toEqual({ ok: true });
  });
  it("accepts sequential and mixed plans", () => {
    const three = [...choices, { serviceId: HAIRCUT_ID, employeeId: DANI_ID }];
    expect(reason(plan(three), ctx, three)).toBe("ok");
    const seq = [choices[0]!, choices[1]!, { serviceId: gel.id, employeeId: "ANY" }];
    expect(reason(plan(seq), ctx, seq)).toBe("ok");
    const sameEmp = {
      ...ctx,
      employees: [ana, { ...bea, timeOff: [{ start: at(MON, "00:00"), end: at("2026-12-08", "00:00") }] }, carla, dani],
    };
    expect(reason(plan(choices, sameEmp), sameEmp)).toBe("ok");
  });
  it("RESOURCE_UNAVAILABLE when chairs are busy", () => {
    const segs = plan();
    const busy = [
      { employeeId: CARLA_ID, resourceId: CHAIR_1_ID, start: at(MON, "09:00"), blockEnd: at(MON, "10:00") },
      { employeeId: CARLA_ID, resourceId: CHAIR_2_ID, start: at(MON, "09:00"), blockEnd: at(MON, "10:00") },
    ];
    expect(reason(segs, { ...ctx, busy })).toBe("RESOURCE_UNAVAILABLE");
  });
  it("RESOURCE_UNAVAILABLE for wrong type, missing, or shared resource", () => {
    const segs = plan();
    expect(reason(withSeg(segs, 1, { resourceId: null }))).toBe("RESOURCE_UNAVAILABLE");
    expect(reason(withSeg(segs, 1, { resourceId: "ghost" }))).toBe("RESOURCE_UNAVAILABLE");
    const two = [choices[1]!, choices[1]!];
    const s2 = plan(two);
    expect(reason(withSeg(s2, 1, { resourceId: s2[0]!.resourceId }), ctx, two)).toBe("RESOURCE_UNAVAILABLE");
  });
  it("MALFORMED when a resource is given to a service without one", () => {
    expect(reason(withSeg(plan(), 0, { resourceId: CHAIR_1_ID }))).toBe("MALFORMED_PLAN");
  });
  it("NOT_QUALIFIED", () => {
    expect(reason(withSeg(plan(), 0, { employeeId: CARLA_ID }))).toBe("NOT_QUALIFIED");
    expect(reason(withSeg(plan(), 0, { employeeId: "ghost" }))).toBe("NOT_QUALIFIED");
    const explicit = [{ serviceId: MANI_ID, employeeId: ANA_ID }, choices[1]!];
    expect(reason(withSeg(plan(explicit), 0, { employeeId: BEA_ID }), ctx, explicit)).toBe("NOT_QUALIFIED");
  });
  it("TOO_SOON, BEYOND_HORIZON, NOT_BOOKABLE_ONLINE", () => {
    const segs = plan();
    expect(reason(segs, { ...ctx, now: at(MON, "09:00") })).toBe("TOO_SOON");
    expect(reason(segs, { ...ctx, now: Date.parse("2026-10-01T00:00:00Z") })).toBe("BEYOND_HORIZON");
    expect(reason(segs, { ...ctx, services: [{ ...mani, onlineBookable: false }, pedi, gel, haircut] })).toBe(
      "NOT_BOOKABLE_ONLINE",
    );
    expect(
      reason(segs, {
        ...ctx,
        employees: [{ ...ana, bookableOnline: false }, { ...bea, bookableOnline: false }, carla, dani],
      }),
    ).toBe("NOT_BOOKABLE_ONLINE");
  });
  it("STAFF skips lead/horizon but not past", () => {
    const segs = plan();
    expect(reason(segs, { ...ctx, mode: "STAFF", now: at(MON, "09:00") })).toBe("ok");
    expect(reason(segs, { ...ctx, mode: "STAFF", now: at(MON, "09:20") })).toBe("TOO_SOON");
  });
  it("MALFORMED_PLAN cases", () => {
    const segs = plan();
    expect(reason(segs.slice(0, 1))).toBe("MALFORMED_PLAN");
    expect(reason(withSeg(segs, 0, { serviceId: PEDI_ID }))).toBe("MALFORMED_PLAN");
    expect(reason(withSeg(segs, 0, { durationMin: 31 }))).toBe("MALFORMED_PLAN");
    expect(reason(withSeg(segs, 0, { priceCents: 1 }))).toBe("MALFORMED_PLAN");
    expect(reason(withSeg(segs, 0, { end: segs[0]!.end + 1 }))).toBe("MALFORMED_PLAN");
    expect(reason(withSeg(segs, 0, { blockEnd: segs[0]!.blockEnd + 60_000 }))).toBe("MALFORMED_PLAN");
    expect(
      reason(
        withSeg(segs, 1, {
          start: segs[1]!.start + 15 * 60_000,
          end: segs[1]!.end + 15 * 60_000,
          blockEnd: segs[1]!.blockEnd + 15 * 60_000,
        }),
      ),
    ).toBe("MALFORMED_PLAN");
    expect(
      reason(
        withSeg(segs, 0, {
          start: segs[0]!.start + 60_000,
          end: segs[0]!.end + 60_000,
          blockEnd: segs[0]!.blockEnd + 60_000,
        }),
      ),
    ).toBe("MALFORMED_PLAN");
    expect(reason([])).toBe("MALFORMED_PLAN");
  });
  it("EMPLOYEE_UNAVAILABLE", () => {
    const segs = plan();
    const busy = [
      { employeeId: segs[0]!.employeeId, resourceId: null, start: at(MON, "09:00"), blockEnd: at(MON, "09:30") },
    ];
    expect(reason(segs, { ...ctx, busy })).toBe("EMPLOYEE_UNAVAILABLE");
    const same = withSeg(segs, 1, { employeeId: segs[0]!.employeeId });
    expect(reason(same)).toBe("EMPLOYEE_UNAVAILABLE");
  });
  it("STAFF override validates outside hours", () => {
    const early = [{ serviceId: HAIRCUT_ID, employeeId: DANI_ID }];
    const c: Context = { ...ctx, mode: "STAFF", override: true, now: NOW };
    const segs: PlannedSegment[] = [
      {
        serviceId: HAIRCUT_ID,
        employeeId: DANI_ID,
        resourceId: null,
        start: at(MON, "07:00"),
        end: at(MON, "08:00"),
        blockEnd: at(MON, "08:00"),
        durationMin: 60,
        priceCents: 5000,
      },
    ];
    expect(reason(segs, c, early)).toBe("ok");
    expect(reason(segs, { ...c, override: false }, early)).toBe("EMPLOYEE_UNAVAILABLE");
  });
  it("I2. missing resourceId is RESOURCE_UNAVAILABLE", () => {
    const segs = plan().map((x) => ({ ...x }));
    delete (segs[1] as Partial<PlannedSegment>).resourceId;
    expect(validatePlan(ctx, choices, segs)).toEqual({ ok: false, reason: "RESOURCE_UNAVAILABLE" });
  });
  it("I3. more than 4 choices is MALFORMED_PLAN", () => {
    const six: ServiceChoice[] = Array.from({ length: 6 }, () => ({ serviceId: gel.id, employeeId: "ANY" }));
    const segs: PlannedSegment[] = six.map((_, i) => ({
      serviceId: gel.id,
      employeeId: i % 2 ? BEA_ID : ANA_ID,
      resourceId: null,
      start: at(MON, "09:00") + i * 15 * 60_000,
      end: at(MON, "09:15") + i * 15 * 60_000,
      blockEnd: at(MON, "09:15") + i * 15 * 60_000,
      durationMin: 15,
      priceCents: 1500,
    }));
    expect(reason(segs, ctx, six)).toBe("MALFORMED_PLAN");
  });
  it("R6. validate rejects a dropped buffer on a chair segment", () => {
    const onlyAna = ctx;
    const cs = [choices[1]!, { serviceId: gel.id, employeeId: "ANY" }];
    const t = at(MON, "09:00");
    const m = 60_000;
    const forged: PlannedSegment[] = [
      {
        serviceId: PEDI_ID,
        employeeId: ANA_ID,
        resourceId: CHAIR_1_ID,
        start: t,
        end: t + 45 * m,
        blockEnd: t + 45 * m,
        durationMin: 45,
        priceCents: 4000,
      },
      {
        serviceId: gel.id,
        employeeId: ANA_ID,
        resourceId: null,
        start: t + 45 * m,
        end: t + 60 * m,
        blockEnd: t + 60 * m,
        durationMin: 15,
        priceCents: 1500,
      },
    ];
    expect(reason(forged, onlyAna, cs)).toBe("MALFORMED_PLAN");
  });
});
