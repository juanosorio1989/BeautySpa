import { describe, expect, it } from "vitest";
import { isExclusionViolation, isForeignKeyViolation, isUniqueViolation, pgCode } from "./db-errors.js";

describe("pgCode", () => {
  it("reads the SQLSTATE from the message", () => {
    expect(pgCode(new Error('db error: ERROR: check violation, code: "23514"'))).toBe("23514");
  });

  it("prefers meta.code and cause.code", () => {
    expect(pgCode({ meta: { code: "23P01" } })).toBe("23P01");
    expect(pgCode({ cause: { code: "23505" } })).toBe("23505");
  });

  it("returns undefined for non-objects and unknown shapes", () => {
    expect(pgCode("x")).toBeUndefined();
    expect(pgCode(null)).toBeUndefined();
    expect(pgCode(new Error("x"))).toBeUndefined();
  });
});

describe("isUniqueViolation", () => {
  it("is true for Prisma P2002 and SQLSTATE 23505", () => {
    expect(isUniqueViolation({ code: "P2002" })).toBe(true);
    expect(isUniqueViolation(new Error('code: "23505"'))).toBe(true);
  });

  it("is false for other errors", () => {
    expect(isUniqueViolation({ code: "P2003" })).toBe(false);
    expect(isUniqueViolation(new Error("x"))).toBe(false);
  });
});

describe("isForeignKeyViolation", () => {
  it("is true for Prisma P2003 and SQLSTATE 23503", () => {
    expect(isForeignKeyViolation({ code: "P2003" })).toBe(true);
    expect(isForeignKeyViolation(new Error('code: "23503"'))).toBe(true);
  });

  it("is false for other errors", () => {
    expect(isForeignKeyViolation(new Error("x"))).toBe(false);
    expect(isForeignKeyViolation({ code: "P2002" })).toBe(false);
    expect(isForeignKeyViolation(undefined)).toBe(false);
  });
});

describe("isExclusionViolation", () => {
  it("is true for SQLSTATE 23P01", () => {
    expect(
      isExclusionViolation(
        new Error('db error: ERROR: conflicting key value violates exclusion constraint, code: "23P01"'),
      ),
    ).toBe(true);
  });

  it("is false for other errors", () => {
    expect(isExclusionViolation(new Error('code: "23505"'))).toBe(false);
    expect(isExclusionViolation(new Error("x"))).toBe(false);
    expect(isExclusionViolation(undefined)).toBe(false);
  });
});
