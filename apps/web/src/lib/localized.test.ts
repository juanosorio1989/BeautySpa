import { describe, expect, it } from "vitest";
import { localized } from "./localized";

describe("localized", () => {
  it("falls back to en when es is empty", () => {
    expect(localized({ en: "Haircut", es: "" }, "es")).toBe("Haircut");
  });
  it("falls back to es when en is empty", () => {
    expect(localized({ en: "", es: "Corte" }, "en")).toBe("Corte");
  });
  it("uses the requested language and handles null", () => {
    expect(localized({ en: "Haircut", es: "Corte" }, "es")).toBe("Corte");
    expect(localized(null, "en")).toBe("");
  });
});
