import { describe, expect, it } from "vitest";
import { canChangeOnline } from "./window";

const START = "2026-11-20T15:00:00.000Z";
const HOUR = 3_600_000;

describe("canChangeOnline", () => {
  it("is true well before the window", () => {
    expect(canChangeOnline(START, 24, Date.parse(START) - 48 * HOUR)).toBe(true);
  });
  it("is true exactly at the window edge", () => {
    expect(canChangeOnline(START, 24, Date.parse(START) - 24 * HOUR)).toBe(true);
  });
  it("is false one millisecond after the edge", () => {
    expect(canChangeOnline(START, 24, Date.parse(START) - 24 * HOUR + 1)).toBe(false);
  });
  it("is false after the start", () => {
    expect(canChangeOnline(START, 0, Date.parse(START) + 1)).toBe(false);
  });
});
