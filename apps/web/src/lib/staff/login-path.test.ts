import { describe, expect, it } from "vitest";
import { staffLoginPath } from "./login-path";

describe("staffLoginPath", () => {
  it("keeps the query string in next", () => {
    expect(staffLoginPath("en", "/en/staff", "date=2026-12-01")).toBe(
      "/en/staff/login?next=%2Fen%2Fstaff%3Fdate%3D2026-12-01",
    );
  });
  it("omits the ? without a query and adds customer=1 when asked", () => {
    expect(staffLoginPath("es", "/es/staff/clients", "", true)).toBe(
      "/es/staff/login?next=%2Fes%2Fstaff%2Fclients&customer=1",
    );
  });
});
