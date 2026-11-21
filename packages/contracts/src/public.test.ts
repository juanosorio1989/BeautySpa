import { describe, expect, it } from "vitest";
import { PublicLocationSchema, PublicServicesResponseSchema } from "./public";

describe("PublicServicesResponseSchema", () => {
  it("parses an empty response", () => {
    expect(PublicServicesResponseSchema.parse({ categories: [], services: [] })).toEqual({
      categories: [],
      services: [],
    });
  });
});

describe("PublicLocationSchema", () => {
  const base = {
    id: "5b8f6f0e-6f1c-4f6e-9d3a-2f7a1c0b9e11",
    name: "Main",
    address: null,
    phone: null,
    timezone: "America/New_York",
    hours: [],
  };

  it("requires booking settings", () => {
    expect(PublicLocationSchema.safeParse(base).success).toBe(false);
    const booking = { bookingHorizonDays: 60, cancelWindowHours: 24, holdMinutes: 5 };
    expect(PublicLocationSchema.safeParse({ ...base, booking }).success).toBe(true);
  });
});
