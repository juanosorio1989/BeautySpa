import { describe, expect, it } from "vitest";
import { wallTimeToUtc } from "@beautyspa/datetime";
import { dayWindow } from "./day-window";

const emp = (ranges: { start: string; end: string }[]) => ({ id: "e", displayName: "A", active: true, ranges });

describe("dayWindow", () => {
  it("on the DST day uses local working hours", () => {
    const tz = "America/New_York";
    const start = wallTimeToUtc("2026-11-01", "09:00", tz);
    const end = wallTimeToUtc("2026-11-01", "17:00", tz);
    const iso = (n: number) => new Date(n).toISOString();
    const w = dayWindow([emp([{ start: iso(start), end: iso(end) }])] as never, "2026-11-01", tz);
    expect(w).toEqual({ start, end });
    expect(new Date(start).toISOString()).toBe("2026-11-01T14:00:00.000Z"); // 9:00 EST
  });

  it("takes the earliest start and latest end across employees", () => {
    const w = dayWindow(
      [
        emp([{ start: "2026-11-02T14:00:00.000Z", end: "2026-11-02T20:00:00.000Z" }]),
        emp([{ start: "2026-11-02T15:00:00.000Z", end: "2026-11-02T23:00:00.000Z" }]),
      ] as never,
      "2026-11-02",
      "America/New_York",
    );
    expect(w).toEqual({ start: Date.parse("2026-11-02T14:00:00.000Z"), end: Date.parse("2026-11-02T23:00:00.000Z") });
  });

  it("falls back to 9 to 19 local", () => {
    const tz = "America/New_York";
    expect(dayWindow([emp([])] as never, "2026-11-01", tz)).toEqual({
      start: wallTimeToUtc("2026-11-01", "09:00", tz),
      end: wallTimeToUtc("2026-11-01", "19:00", tz),
    });
    expect(new Date(dayWindow([], "2026-11-01", tz).start).toISOString()).toBe("2026-11-01T14:00:00.000Z"); // 9:00 EST
  });
});
