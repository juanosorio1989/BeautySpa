import { describe, expect, it } from "vitest";
import { errorCode } from "./error-code.js";
import { PushError } from "./providers/channel-provider.js";

describe("errorCode", () => {
  it("maps Resend status errors to resend_<status>", () => {
    expect(errorCode(new Error("Resend send failed: 500"))).toBe("resend_500");
    expect(errorCode(new Error("Resend send failed: 429"))).toBe("resend_429");
  });

  it("maps a Resend timeout to resend_timeout", () => {
    expect(errorCode(new Error("Resend send failed: timeout"))).toBe("resend_timeout");
  });

  it("maps PushError to push_<status> or push_none", () => {
    expect(errorCode(new PushError(410))).toBe("push_410");
    expect(errorCode(new PushError("none"))).toBe("push_none");
  });

  it("anything else is unknown", () => {
    expect(errorCode(new Error("boom"))).toBe("unknown");
    expect(errorCode("Resend send failed: 500")).toBe("unknown");
    expect(errorCode(null)).toBe("unknown");
    expect(errorCode(undefined)).toBe("unknown");
    expect(errorCode({ message: "Resend send failed: 500" })).toBe("unknown");
    expect(errorCode(new Error("Resend send failed: 500 extra"))).toBe("unknown");
  });

  it("an Error whose message contains an email maps to unknown", () => {
    expect(errorCode(new Error("rejected recipient ana@salon.com"))).toBe("unknown");
    expect(errorCode(new Error("Resend send failed: ana@salon.com"))).toBe("unknown");
  });

  it("never exceeds 200 chars", () => {
    expect(errorCode(new Error("Resend send failed: " + "9".repeat(500))).length).toBeLessThanOrEqual(200);
  });
});
