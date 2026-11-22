import { afterEach, describe, expect, it } from "vitest";
import { formatDate, formatPrice, formatTime, formatTimeRange } from "./format";

const ORIGINAL_TZ = process.env.TZ;

describe("format", () => {
  afterEach(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });

  it("formatTime uses the location zone, not the process zone", () => {
    process.env.TZ = "America/Los_Angeles";
    expect(formatTime("2026-11-19T16:00:00Z", "America/New_York", "en")).toMatch(/^11:00\sAM$/);
    expect(formatTime("2026-11-19T16:00:00Z", "America/New_York", "es")).toMatch(/^11:00\sa\.\s?m\.$/);
  });

  it("formatPrice 6500 -> $65.00", () => {
    expect(formatPrice(6500, "en")).toBe("$65.00");
    expect(formatPrice(6500, "es")).toContain("65.00");
  });

  it("formatDate renders in the location zone", () => {
    expect(formatDate("2026-11-20T03:00:00Z", "America/New_York", "en", "long")).toContain("November 19");
    expect(formatDate("2026-11-20T03:00:00Z", "America/New_York", "en", "short")).toContain("Nov");
  });

  it("formatTimeRange joins start and end", () => {
    const r = formatTimeRange("2026-11-19T16:00:00Z", "2026-11-19T17:00:00Z", "America/New_York", "en");
    expect(r).toMatch(/11:00\sAM.*12:00\sPM/);
  });
});
