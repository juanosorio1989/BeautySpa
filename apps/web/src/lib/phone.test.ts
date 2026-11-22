import { describe, expect, it } from "vitest";
import { formatUsPhone, toE164 } from "./phone";

describe("phone", () => {
  it("toE164 normalizes common US formats", () => {
    expect(toE164("(718) 555-0123")).toBe("+17185550123");
    expect(toE164("718-555-0123")).toBe("+17185550123");
    expect(toE164("7185550123")).toBe("+17185550123");
    expect(toE164("1 718 555 0123")).toBe("+17185550123");
    expect(toE164("+1 (718) 555-0123")).toBe("+17185550123");
    expect(toE164("abc")).toBeNull();
    expect(toE164("555-0123")).toBeNull();
  });

  it("formatUsPhone formats as typed", () => {
    expect(formatUsPhone("7185550123")).toBe("(718) 555-0123");
    expect(formatUsPhone("718")).toBe("(718");
    expect(formatUsPhone("71855")).toBe("(718) 55");
    expect(formatUsPhone("")).toBe("");
  });
});
