import { describe, expect, it } from "vitest";
import { dayHoursFromRows, timeToWall, wallToTime } from "./wall-time.js";

const t = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00Z`);

describe("timeToWall", () => {
  it("maps a midnight end to 24:00", () => {
    expect(timeToWall(t("00:00"), "end")).toBe("24:00");
  });

  it("keeps a midnight start as 00:00", () => {
    expect(timeToWall(t("00:00"), "start")).toBe("00:00");
  });

  it("reads UTC hours and minutes", () => {
    expect(timeToWall(t("09:30"), "start")).toBe("09:30");
    expect(timeToWall(t("18:05"), "end")).toBe("18:05");
  });
});

describe("wallToTime", () => {
  it("stores 24:00 as midnight", () => {
    expect(wallToTime("24:00").toISOString()).toBe("1970-01-01T00:00:00.000Z");
  });

  it("stores HH:MM on 1970-01-01 UTC", () => {
    expect(wallToTime("09:30").toISOString()).toBe("1970-01-01T09:30:00.000Z");
  });

  it("round-trips through timeToWall", () => {
    expect(timeToWall(wallToTime("24:00"), "end")).toBe("24:00");
    expect(timeToWall(wallToTime("13:45"), "start")).toBe("13:45");
  });
});

describe("dayHoursFromRows", () => {
  it("sorts by weekday then start and maps a midnight end to 24:00", () => {
    const rows = [
      { weekday: 2, start: t("14:00"), end: t("00:00") },
      { weekday: 1, start: t("09:00"), end: t("12:00") },
      { weekday: 2, start: t("08:00"), end: t("12:00") },
    ];
    expect(dayHoursFromRows(rows)).toEqual([
      { weekday: 1, start: "09:00", end: "12:00" },
      { weekday: 2, start: "08:00", end: "12:00" },
      { weekday: 2, start: "14:00", end: "24:00" },
    ]);
  });
});
