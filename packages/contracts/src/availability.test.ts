import { describe, it, expect } from "vitest";
import { AvailabilityQuerySchema } from "./availability";

const id = "123e4567-e89b-42d3-a456-426614174000";
const choice = { serviceId: id, employeeId: id };

describe("AvailabilityQuerySchema", () => {
  it("rejects empty services", () =>
    expect(AvailabilityQuerySchema.safeParse({ services: [], date: "2026-12-07" }).success).toBe(false));
  it("rejects 5 services", () =>
    expect(AvailabilityQuerySchema.safeParse({ services: Array(5).fill(choice), date: "2026-12-07" }).success).toBe(
      false,
    ));
  it("accepts ANY employee", () =>
    expect(
      AvailabilityQuerySchema.safeParse({
        services: [{ serviceId: id, employeeId: "ANY" }],
        date: "2026-12-07",
      }).success,
    ).toBe(true));
});
