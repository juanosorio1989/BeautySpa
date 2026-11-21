import { describe, it, expect } from "vitest";
import { MePatchSchema, StaffCustomerCreateSchema } from "./customer";

describe("MePatchSchema", () => {
  it("rejects an empty update", () => expect(MePatchSchema.safeParse({}).success).toBe(false));
  it("accepts a partial consents update", () =>
    expect(MePatchSchema.safeParse({ consents: { WHATSAPP: true } }).success).toBe(true));
  it("rejects a blank name", () => expect(MePatchSchema.safeParse({ name: "  " }).success).toBe(false));
});

describe("StaffCustomerCreateSchema", () => {
  it("rejects a phone without E.164 format", () =>
    expect(StaffCustomerCreateSchema.safeParse({ name: "Ana", phone: "3055550100", locale: "en" }).success).toBe(
      false,
    ));
  it("defaults email null and consents {}", () => {
    const r = StaffCustomerCreateSchema.parse({ name: "Ana", phone: "+13055550100", locale: "en" });
    expect(r.email).toBeNull();
    expect(r.consents).toEqual({});
  });
});
