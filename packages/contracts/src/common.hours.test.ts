import { describe, expect, it } from "vitest";
import { DayHoursSchema, TimezoneSchema, WeekHoursSchema } from "./common";

const d = (weekday: number, start: string, end: string) => ({ weekday, start, end });

describe("DayHoursSchema", () => {
  it("accepts 24:00 as end", () => {
    expect(DayHoursSchema.safeParse(d(1, "09:00", "24:00")).success).toBe(true);
  });
  it("rejects end 00:00 with path end", () => {
    const r = DayHoursSchema.safeParse(d(1, "09:00", "00:00"));
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(["end"]);
  });
  it("rejects start 24:00, weekday 7 and unpadded start", () => {
    expect(DayHoursSchema.safeParse(d(1, "24:00", "24:00")).success).toBe(false);
    expect(DayHoursSchema.safeParse(d(7, "09:00", "10:00")).success).toBe(false);
    expect(DayHoursSchema.safeParse(d(1, "9:00", "10:00")).success).toBe(false);
  });
});

describe("WeekHoursSchema", () => {
  it("allows touching ranges", () => {
    expect(WeekHoursSchema.safeParse([d(1, "09:00", "13:00"), d(1, "13:00", "19:00")]).success).toBe(true);
  });
  it("rejects overlap with path [1]", () => {
    const r = WeekHoursSchema.safeParse([d(1, "09:00", "13:00"), d(1, "12:00", "15:00")]);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path).toEqual([1]);
  });
  it("allows same ranges on different weekdays", () => {
    expect(WeekHoursSchema.safeParse([d(1, "09:00", "13:00"), d(2, "12:00", "15:00")]).success).toBe(true);
  });
  it("reports the later-starting range when given in reverse order", () => {
    const r = WeekHoursSchema.safeParse([d(1, "12:00", "15:00"), d(1, "09:00", "13:00")]);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path).toEqual([0]);
  });
});

describe("TimezoneSchema", () => {
  it("validates IANA zones", () => {
    expect(TimezoneSchema.safeParse("America/New_York").success).toBe(true);
    expect(TimezoneSchema.safeParse("Mars/Base").success).toBe(false);
  });
});
