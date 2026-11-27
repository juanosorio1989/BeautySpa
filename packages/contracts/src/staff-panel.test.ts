import { describe, expect, it } from "vitest";
import { BookingCatalogSchema, CustomerNotesInputSchema, CustomerNotesSchema, StaffMeSchema } from "./staff-panel";

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

describe("CustomerNotesInputSchema", () => {
  const parse = (notes: unknown) => CustomerNotesInputSchema.safeParse({ notes });
  it("trims the text", () => {
    expect(parse("  hi  ").data).toEqual({ notes: "hi" });
  });
  it("turns blank text and null into null", () => {
    expect(parse("   ").data).toEqual({ notes: null });
    expect(parse(null).data).toEqual({ notes: null });
  });
  it("limits the trimmed text to 2,000 characters", () => {
    expect(parse(` ${"a".repeat(2000)} `).success).toBe(true);
    expect(parse("a".repeat(2001)).success).toBe(false);
  });
  it("requires the field", () => {
    expect(CustomerNotesInputSchema.safeParse({}).success).toBe(false);
  });
});

describe("CustomerNotesSchema", () => {
  it("accepts the empty state and a written note", () => {
    expect(CustomerNotesSchema.safeParse({ notes: null, updatedAt: null, updatedBy: null }).success).toBe(true);
    expect(
      CustomerNotesSchema.safeParse({
        notes: "x",
        updatedAt: "2026-11-30T12:00:00.000Z",
        updatedBy: { id, name: "Ana" },
      }).success,
    ).toBe(true);
  });
});
