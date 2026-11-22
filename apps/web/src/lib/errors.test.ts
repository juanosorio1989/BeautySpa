import { ApiError } from "@beautyspa/api-client";
import { ErrorCode, type Problem } from "@beautyspa/contracts";
import { en, es } from "@beautyspa/i18n";
import { describe, expect, it } from "vitest";
import { errorMessageKey, fieldErrors } from "./errors";

function apiError(code: Problem["code"], errors?: Problem["errors"]): ApiError {
  return new ApiError(409, { type: "about:blank", title: "x", status: 409, code, ...(errors ? { errors } : {}) });
}

describe("errors", () => {
  it("errorMessageKey maps SLOT_TAKEN, network and unknown", () => {
    expect(errorMessageKey(apiError("SLOT_TAKEN"))).toBe("errors.SLOT_TAKEN");
    expect(errorMessageKey(new TypeError("Failed to fetch"))).toBe("errors.network");
    expect(errorMessageKey(new Error("boom"))).toBe("errors.generic");
    expect(errorMessageKey("nope")).toBe("errors.generic");
  });

  it("fieldErrors collects problem.errors by path", () => {
    const err = apiError("VALIDATION_FAILED", [
      { path: "email", message: "bad" },
      { path: "phone", message: "worse" },
    ]);
    expect(fieldErrors(err)).toEqual({ email: "bad", phone: "worse" });
    expect(fieldErrors(new Error("x"))).toEqual({});
  });

  it("both catalogs have a message for every ErrorCode, generic and network", () => {
    for (const cat of [en, es]) {
      for (const code of ErrorCode.options) expect(cat.errors[code]).toBeTruthy();
      expect(cat.errors.generic).toBeTruthy();
      expect(cat.errors.network).toBeTruthy();
    }
  });
});
