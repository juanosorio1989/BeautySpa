import type { StaffAppointment } from "@beautyspa/contracts";
import { describe, expect, it } from "vitest";
import { allowedActions } from "./actions";

const tz = "America/New_York";
const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const START = Date.parse("2026-12-01T15:00:00.000Z"); // 10:00 local
const seg = (employeeId: string) => ({ employeeId }) as never;
const appt = (status: StaffAppointment["status"], employees: string[] = [ME], startsAt = START) =>
  ({
    status,
    startsAt: new Date(startsAt).toISOString(),
    segments: employees.map(seg),
  }) as unknown as StaffAppointment;
const ctx = (role: "OWNER" | "RECEPTION" | "EMPLOYEE", now: number) => ({ role, meId: ME, now, timeZone: tz });
const names = (r: ReturnType<typeof allowedActions>) => r.map((x) => x.action);

const sameDayBefore = START - 3_600_000;
const sameDayAfter = START + 3_600_000;

describe("allowedActions", () => {
  it("BOOKED on its day offers everything, with no-show gated until the start", () => {
    const r = allowedActions(appt("BOOKED"), ctx("RECEPTION", sameDayBefore));
    expect(names(r)).toEqual(["checkIn", "complete", "noShow", "move", "cancel"]);
    expect(r.find((x) => x.action === "noShow")?.enabledFrom).toBe(START);
    expect(r.find((x) => x.action === "checkIn")?.enabledFrom).toBeUndefined();
  });

  it("no-show is enabled once now reaches the start", () => {
    const r = allowedActions(appt("BOOKED"), ctx("OWNER", START));
    expect(r.find((x) => x.action === "noShow")?.enabledFrom).toBeUndefined();
    expect(names(allowedActions(appt("BOOKED"), ctx("OWNER", sameDayAfter)))).toContain("noShow");
  });

  it("CHECKED_IN offers complete, move and cancel", () => {
    expect(names(allowedActions(appt("CHECKED_IN"), ctx("OWNER", sameDayAfter)))).toEqual([
      "complete",
      "move",
      "cancel",
    ]);
  });

  it.each(["COMPLETED", "CANCELLED", "NO_SHOW", "HELD"] as const)("%s offers nothing", (status) => {
    expect(allowedActions(appt(status), ctx("OWNER", sameDayAfter))).toEqual([]);
  });

  it("a future day hides check in and complete", () => {
    const dayBefore = START - 24 * 3_600_000;
    expect(names(allowedActions(appt("BOOKED"), ctx("OWNER", dayBefore)))).toEqual(["noShow", "move", "cancel"]);
    expect(names(allowedActions(appt("CHECKED_IN"), ctx("OWNER", dayBefore)))).toEqual(["move", "cancel"]);
  });

  it("compares local dates, not instants (11 pm the evening before is still the day before)", () => {
    const lateEvening = Date.parse("2026-12-02T04:30:00.000Z"); // 23:30 on 12-01 in New York
    const nextMorning = appt("BOOKED", [ME], Date.parse("2026-12-02T14:00:00.000Z")); // 12-02 09:00 local
    expect(names(allowedActions(nextMorning, ctx("OWNER", lateEvening)))).not.toContain("checkIn");
  });

  it("EMPLOYEE gets only check in and complete, on their own segments", () => {
    expect(names(allowedActions(appt("BOOKED"), ctx("EMPLOYEE", sameDayAfter)))).toEqual(["checkIn", "complete"]);
    expect(names(allowedActions(appt("CHECKED_IN"), ctx("EMPLOYEE", sameDayAfter)))).toEqual(["complete"]);
    expect(names(allowedActions(appt("BOOKED", [OTHER, ME]), ctx("EMPLOYEE", sameDayAfter)))).toEqual([
      "checkIn",
      "complete",
    ]);
  });

  it("EMPLOYEE without a segment of their own gets nothing", () => {
    expect(allowedActions(appt("BOOKED", [OTHER]), ctx("EMPLOYEE", sameDayAfter))).toEqual([]);
  });
});
