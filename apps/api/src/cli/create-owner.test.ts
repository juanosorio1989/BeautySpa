import { describe, expect, it } from "vitest";
import { parseArgs } from "./create-owner.js";

describe("create-owner parseArgs", () => {
  it("parses --email and --locale, normalizing the email; locale defaults to en", () => {
    expect(parseArgs(["--email", " Boss@Salon.com ", "--locale", "es"])).toEqual({ email: "boss@salon.com", locale: "es" });
    expect(parseArgs(["--", "--email", "boss@salon.com"])).toEqual({ email: "boss@salon.com", locale: "en" });
  });

  it("rejects a missing or invalid email, a bad locale and unknown flags with a one-line message", () => {
    for (const argv of [[], ["--email"], ["--email", "nope"], ["--email", "a@b.co", "--locale", "fr"], ["--x", "1"]]) {
      expect(() => parseArgs(argv)).toThrow(/^[^\n]+$/);
    }
  });
});
