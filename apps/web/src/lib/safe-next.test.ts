import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it("keeps a same-site path", () => {
    expect(safeNext("/en/book/done/abc", "en")).toBe("/en/book/done/abc");
  });

  it("falls back to /<locale>/me when missing", () => {
    expect(safeNext(null, "es")).toBe("/es/me");
    expect(safeNext("", "es")).toBe("/es/me");
  });

  it("rejects absolute and protocol-relative urls", () => {
    for (const raw of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "evil.example",
      "javascript:alert(1)",
      "/\t/evil.example",
    ]) {
      expect(safeNext(raw, "en")).toBe("/en/me");
    }
  });
});
