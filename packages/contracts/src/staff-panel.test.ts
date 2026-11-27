import { describe, expect, it } from "vitest";
import { BookingCatalogSchema, StaffMeSchema } from "./staff-panel";

const id = "11111111-1111-4111-8111-111111111111";

describe("StaffMeSchema", () => {
  it("accepts a staff role", () => {
    expect(StaffMeSchema.safeParse({ id, name: "Ana", email: "a@x.dev", role: "OWNER" }).success).toBe(true);
  });
  it("rejects role CUSTOMER", () => {
    expect(StaffMeSchema.safeParse({ id, name: "Ana", email: "a@x.dev", role: "CUSTOMER" }).success).toBe(false);
  });
});

describe("BookingCatalogSchema", () => {
  const base = { categories: [], services: [], employees: [], popularServiceIds: [] };
  it("accepts an empty catalog", () => {
    expect(BookingCatalogSchema.safeParse(base).success).toBe(true);
  });
  it("rejects more than 6 popular services", () => {
    expect(BookingCatalogSchema.safeParse({ ...base, popularServiceIds: Array(7).fill(id) }).success).toBe(false);
  });
});
