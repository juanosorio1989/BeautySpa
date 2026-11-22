import { describe, expect, it } from "vitest";
import { formatUsPhone, toE164 } from "./phone";

const INPUTS = ["+1 (718) 555-0123", "1-718-555-0123", "718.555.0123"];

describe("phone", () => {
  it("toE164 normalizes common US formats", () => {
    for (const i of [...INPUTS, "(718) 555-0123", "7185550123"]) expect(toE164(i)).toBe("+17185550123");
  });

  it("toE164 rejects invalid input", () => {
    for (const i of ["abc", "555-0123", "718-555-0123x", "(171) 855-5012", "(718) 155-0123"])
      expect(toE164(i)).toBeNull();
  });

  it("formatUsPhone formats as typed and drops a leading 1", () => {
    expect(formatUsPhone("7185550123")).toBe("(718) 555-0123");
    expect(formatUsPhone("718")).toBe("(718");
    expect(formatUsPhone("71855")).toBe("(718) 55");
    expect(formatUsPhone("")).toBe("");
    expect(formatUsPhone("+1 (718) 555-0123")).toBe("(718) 555-0123");
  });

  it("round-trips formatted output", () => {
    for (const i of INPUTS) expect(toE164(formatUsPhone(i))).toBe("+17185550123");
  });
});
