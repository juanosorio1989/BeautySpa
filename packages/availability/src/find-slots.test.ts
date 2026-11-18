import { describe, expect, it } from "vitest";
import {
  ana, ANA_ID, at, bea, BEA_ID, carla, CARLA_ID, chair1, CHAIR_1_ID, chair2, CHAIR_2_ID, dani, DANI_ID,
  gel, GEL_ID, haircut, HAIRCUT_ID, location, makeEmployee, mani, MANI_ID, MON, pedi, PEDI_ID,
} from "../test/fixtures";
import { AvailabilityError } from "./errors";
import { findSlots } from "./find-slots";
import type { BusySegment, FindSlotsInput, ServiceChoice } from "./types";

const NOW = Date.parse("2026-12-06T12:00:00Z");
const base = (choices: ServiceChoice[], o: Partial<FindSlotsInput> = {}): FindSlotsInput => ({
  location,
  services: [mani, pedi, gel, haircut],
  employees: [ana, bea, carla, dani],
  resources: [chair1, chair2],
  busy: [],
  mode: "ONLINE",
  now: NOW,
  choices,
  date: MON,
  ...o,
});
const c = (serviceId: string, employeeId = "ANY"): ServiceChoice => ({ serviceId, employeeId });
const busy = (employeeId: string, resourceId: string | null, from: string, to: string): BusySegment => ({
  employeeId, resourceId, start: at(MON, from), blockEnd: at(MON, to),
});
const wholeDay = (employeeId: string, resourceId: string | null) => busy(employeeId, resourceId, "00:00", "23:59");

describe("findSlots", () => {
  it("1. haircut/dani", () => {
    const s = findSlots(base([c(HAIRCUT_ID, DANI_ID)]));
    expect(s).toHaveLength(37);
    expect(s[0]!.start).toBe(at(MON, "09:00"));
    expect(s[0]!.end).toBe(at(MON, "10:00"));
    expect(s.at(-1)!.start).toBe(at(MON, "18:00"));
  });
  it("2. mani/ana includes buffer", () => {
    const s = findSlots(base([c(MANI_ID, ANA_ID)]));
    expect(s).toHaveLength(38);
    expect(s.at(-1)!.start).toBe(at(MON, "18:15"));
  });
  it("3. busy window", () => {
    const s = findSlots(base([c(HAIRCUT_ID, DANI_ID)], { busy: [busy(DANI_ID, null, "10:00", "11:00")] }));
    const starts = s.map((x) => x.start);
    expect(starts).toContain(at(MON, "09:00"));
    expect(starts).not.toContain(at(MON, "09:15"));
    expect(starts).not.toContain(at(MON, "10:45"));
    expect(starts).toContain(at(MON, "11:00"));
  });
  it("4. mani + pedi in parallel", () => {
    const s = findSlots(base([c(MANI_ID), c(PEDI_ID)]))[0]!;
    const [m, p] = s.segments;
    expect(m!.start).toBe(at(MON, "09:00"));
    expect(p!.start).toBe(at(MON, "09:00"));
    expect(new Set([m!.employeeId, p!.employeeId])).toEqual(new Set([ANA_ID, BEA_ID]));
    expect(p!.resourceId).toBe(CHAIR_1_ID);
    expect(m!.resourceId).toBeNull();
    expect(s.end).toBe(at(MON, "09:45"));
  });
  it("5. sequential fallback drops same-employee buffer", () => {
    const off = [{ start: at(MON, "00:00"), end: at("2026-12-08", "00:00") }];
    const s = findSlots(base([c(MANI_ID), c(PEDI_ID)], { employees: [ana, makeEmployee(bea, { timeOff: off }), carla, dani] }))[0]!;
    const [m, p] = s.segments;
    expect([m!.employeeId, p!.employeeId]).toEqual([ANA_ID, ANA_ID]);
    expect([m!.start, m!.end, m!.blockEnd]).toEqual([at(MON, "09:00"), at(MON, "09:30"), at(MON, "09:30")]);
    expect([p!.start, p!.end]).toEqual([at(MON, "09:30"), at(MON, "10:15")]);
    expect(s.end).toBe(at(MON, "10:15"));
  });
  it("6. no chair free", () => {
    expect(findSlots(base([c(MANI_ID), c(PEDI_ID)], { busy: [wholeDay(CARLA_ID, CHAIR_1_ID), wholeDay(CARLA_ID, CHAIR_2_ID)] }))).toEqual([]);
  });
  it("7. parallel block then haircut", () => {
    const s = findSlots(base([c(MANI_ID), c(PEDI_ID), c(HAIRCUT_ID, DANI_ID)]))[0]!;
    expect(s.segments[0]!.start).toBe(at(MON, "09:00"));
    expect(s.segments[1]!.start).toBe(at(MON, "09:00"));
    expect(s.segments[2]!.start).toBe(at(MON, "09:45"));
    expect(s.segments[2]!.end).toBe(at(MON, "10:45"));
  });
  it("8. three parallelizable with two techs go sequential", () => {
    const s = findSlots(base([c(MANI_ID), c(PEDI_ID), c(GEL_ID)]))[0]!;
    expect(s.segments.map((x) => [x.start, x.end])).toEqual([
      [at(MON, "09:00"), at(MON, "09:30")],
      [at(MON, "09:30"), at(MON, "10:15")],
      [at(MON, "10:15"), at(MON, "10:30")],
    ]);
  });
  it("9. ANY tie-break", () => {
    expect(findSlots(base([c(MANI_ID)]))[0]!.segments[0]!.employeeId).toBe(ANA_ID);
    const s = findSlots(base([c(MANI_ID)], { busy: [busy(ANA_ID, null, "15:00", "17:00")] }));
    expect(s[0]!.segments[0]!.employeeId).toBe(BEA_ID);
  });
  it("10. level override", () => {
    const k = findSlots(base([c(HAIRCUT_ID, CARLA_ID)]))[0]!;
    expect(k.end - k.start).toBe(45 * 60_000);
    expect(k.segments[0]!.priceCents).toBe(7000);
    const d = findSlots(base([c(HAIRCUT_ID, DANI_ID)]))[0]!;
    expect(d.end - d.start).toBe(60 * 60_000);
    expect(d.segments[0]!.priceCents).toBe(5000);
  });
  it("11. DST days", () => {
    const now = Date.parse("2026-03-01T12:00:00Z");
    const a = findSlots(base([c(HAIRCUT_ID, DANI_ID)], { date: "2026-03-08", now }));
    expect(a).toHaveLength(37);
    expect(a[0]!.start).toBe(Date.parse("2026-03-08T13:00:00Z"));
    const b = findSlots(base([c(HAIRCUT_ID, DANI_ID)], { date: "2026-11-01", now: Date.parse("2026-10-25T12:00:00Z") }));
    expect(b).toHaveLength(37);
    expect(b[0]!.start).toBe(Date.parse("2026-11-01T14:00:00Z"));
  });
  it("12. lead time", () => {
    const now = Date.parse("2026-12-07T15:10:00Z");
    expect(findSlots(base([c(HAIRCUT_ID, DANI_ID)], { now }))[0]!.start).toBe(Date.parse("2026-12-07T16:15:00Z"));
    expect(findSlots(base([c(HAIRCUT_ID, DANI_ID)], { now, mode: "STAFF" }))[0]!.start).toBe(Date.parse("2026-12-07T15:00:00Z"));
  });
  it("13. horizon", () => {
    const ch = [c(HAIRCUT_ID, DANI_ID)];
    expect(findSlots(base(ch, { date: "2027-02-04" })).length).toBeGreaterThan(0);
    expect(findSlots(base(ch, { date: "2027-02-05" }))).toEqual([]);
    expect(findSlots(base(ch, { date: "2027-02-05", mode: "STAFF" })).length).toBeGreaterThan(0);
  });
  it("13b. past date online is empty", () => {
    expect(findSlots(base([c(HAIRCUT_ID, DANI_ID)], { date: "2026-12-05" }))).toEqual([]);
  });
  it("14. bookableOnline false", () => {
    const employees = [ana, bea, carla, makeEmployee(dani, { bookableOnline: false })];
    expect(findSlots(base([c(HAIRCUT_ID, DANI_ID)], { employees }))).toEqual([]);
    expect(findSlots(base([c(HAIRCUT_ID, DANI_ID)], { employees, mode: "STAFF" })).length).toBeGreaterThan(0);
  });
  it("14b. service not online bookable", () => {
    const services = [mani, pedi, gel, { ...haircut, onlineBookable: false }];
    expect(findSlots(base([c(HAIRCUT_ID, DANI_ID)], { services }))).toEqual([]);
    expect(findSlots(base([c(HAIRCUT_ID, DANI_ID)], { services, mode: "STAFF" })).length).toBeGreaterThan(0);
  });
  it("15. STAFF override ignores hours and time off", () => {
    const off = [{ start: at(MON, "00:00"), end: at("2026-12-08", "00:00") }];
    const s = findSlots(base([c(HAIRCUT_ID, DANI_ID)], {
      mode: "STAFF", override: true, employees: [ana, bea, carla, makeEmployee(dani, { timeOff: off })],
    }));
    expect(s.length).toBeGreaterThan(0);
    expect(s[0]!.start).toBe(at(MON, "00:00"));
  });
  it("16. mani ANY twice runs in parallel with distinct employees", () => {
    const s = findSlots(base([c(MANI_ID), c(MANI_ID)]))[0]!;
    expect(s.segments[0]!.start).toBe(s.segments[1]!.start);
    expect(new Set(s.segments.map((x) => x.employeeId))).toEqual(new Set([ANA_ID, BEA_ID]));
  });
  it("17. input errors", () => {
    const code = (ch: ServiceChoice[]) => {
      try { findSlots(base(ch)); } catch (e) { return e instanceof AvailabilityError ? e.code : "other"; }
      return "none";
    };
    expect(code([])).toBe("NO_SERVICES");
    expect(code([c(MANI_ID), c(MANI_ID), c(MANI_ID), c(MANI_ID), c(MANI_ID)])).toBe("TOO_MANY_SERVICES");
    expect(code([c("nope")])).toBe("UNKNOWN_SERVICE");
    expect(code([c(MANI_ID, "ghost")])).toBe("UNKNOWN_EMPLOYEE");
    expect(findSlots(base([c(MANI_ID, CARLA_ID)]))).toEqual([]);
  });
  it("R2. unrelated busy does not leak across employees/resources", () => {
    const other = [busy(CARLA_ID, CHAIR_2_ID, "09:00", "19:00")];
    expect(findSlots(base([c(HAIRCUT_ID, DANI_ID)], { busy: other }))).toHaveLength(37);
    const s = findSlots(base([c(MANI_ID), c(PEDI_ID)], { busy: other }))[0]!;
    expect(s.segments[1]!.resourceId).toBe(CHAIR_1_ID);
    expect(s.start).toBe(at(MON, "09:00"));
  });
  it("same-employee ordering counts only input busy minutes", () => {
    const s = findSlots(base([c(MANI_ID)], { busy: [busy(ANA_ID, null, "08:00", "08:30")] }));
    expect(s[0]!.segments[0]!.employeeId).toBe(BEA_ID);
  });
  it("sequential plan with a resource blocked at later start falls through to next resource", () => {
    const s = findSlots(base([c(PEDI_ID), c(PEDI_ID)]))[0]!;
    expect(new Set(s.segments.map((x) => x.resourceId))).toEqual(new Set([CHAIR_1_ID, CHAIR_2_ID]));
  });
  it("C1. scarce resources do not blow up the search", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      makeEmployee(ana, { id: `00000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}` }),
    );
    const t0 = Date.now();
    const s = findSlots(base([c(PEDI_ID), c(PEDI_ID), c(PEDI_ID), c(PEDI_ID)], {
      mode: "STAFF", employees: many, busy: [wholeDay(CARLA_ID, CHAIR_1_ID), wholeDay(CARLA_ID, CHAIR_2_ID)],
    }));
    expect(s).toEqual([]);
    expect(Date.now() - t0).toBeLessThan(200);
  });
  it("R6. buffer is kept when the same employee's next segment uses another/no resource", () => {
    const onlyAna = [ana, { ...bea, timeOff: [{ start: at(MON, "00:00"), end: at("2026-12-08", "00:00") }] }];
    // gel would have to start at pedi's end by ana, but the chair buffer keeps ana blocked
    expect(findSlots(base([c(PEDI_ID), c(GEL_ID)], { employees: onlyAna }))).toEqual([]);
  });
  it("R6. buffer dropped when the same chair is reused by the same employee", () => {
    const onlyAna = [ana, { ...bea, timeOff: [{ start: at(MON, "00:00"), end: at("2026-12-08", "00:00") }] }];
    const s = findSlots(base([c(PEDI_ID), c(PEDI_ID)], { employees: onlyAna }))[0]!;
    const [a, b] = s.segments;
    expect(b!.start).toBe(a!.end);
    expect(a!.resourceId).toBe(b!.resourceId);
    expect(a!.blockEnd).toBe(a!.end);
  });
  it("R7. ANY ordering uses input busy only, not in-plan segments", () => {
    // bea busy 1h earlier in the day: input ordering always prefers ana for every segment.
    const s = findSlots(base([c(MANI_ID), c(MANI_ID), c(GEL_ID), c(PEDI_ID)], {
      busy: [busy(BEA_ID, null, "09:00", "10:00")],
      employees: [ana, bea, carla, dani],
    }));
    const first = s.find((x) => x.start === at(MON, "10:00"))!;
    expect(first.segments.map((x) => x.employeeId)[0]).toBe(ANA_ID);
    // fully sequential (4 parallelizable, 2 techs): every segment picks ana while she is free
    const seq = findSlots(base([c(MANI_ID), c(MANI_ID), c(GEL_ID), c(MANI_ID)], { busy: [busy(BEA_ID, null, "09:00", "10:00")] }));
    expect(seq[0]!.segments.every((x) => x.employeeId === ANA_ID)).toBe(true);
  });
});
