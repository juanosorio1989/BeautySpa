import { describe, expect, it } from "vitest";
import { dateStrip, dayLabel, todayIn } from "./date-strip";

describe("dateStrip", () => {
  it("lists each local day once across DST", () => {
    expect(dateStrip("2026-10-30", 5)).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03"]);
    expect(dateStrip("2026-03-07", 3)).toEqual(["2026-03-07", "2026-03-08", "2026-03-09"]);
  });

  it("is empty for a non-positive horizon", () => {
    expect(dateStrip("2026-10-30", 0)).toEqual([]);
  });
});

describe("todayIn", () => {
  it("uses the location timezone, not UTC", () => {
    const nowMs = Date.parse("2026-11-21T03:30:00Z");
    expect(todayIn("America/New_York", nowMs)).toBe("2026-11-20");
    expect(todayIn("UTC", nowMs)).toBe("2026-11-21");
  });
});

describe("dayLabel", () => {
  it("gives the weekday and day number of a calendar date", () => {
    expect(dayLabel("2026-11-19", "en")).toEqual({ weekday: "Thu", day: "19", full: "Thursday, November 19" });
    expect(dayLabel("2026-11-19", "es").full).toMatch(/jueves.*19.*noviembre/i);
    expect(dayLabel("2026-11-19", "es").day).toBe("19");
  });
});
