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

  it("parses a single string service into an array of choices", () => {
    const r = AvailabilityQuerySchema.parse({ services: `${id}:ANY`, date: "2026-12-01" });
    expect(r.services).toEqual([{ serviceId: id, employeeId: "ANY" }]);
  });
  it("parses repeated string services", () => {
    const r = AvailabilityQuerySchema.parse({ services: [`${id}:ANY`, `${id}:${id}`], date: "2026-12-01" });
    expect(r.services).toEqual([
      { serviceId: id, employeeId: "ANY" },
      { serviceId: id, employeeId: id },
    ]);
  });
  it("rejects a bare serviceId string at services.0", () => {
    const r = AvailabilityQuerySchema.safeParse({ services: id, date: "2026-12-01" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.some((i) => i.path.join(".") === "services.0")).toBe(true);
  });
  it("rejects five string services", () =>
    expect(
      AvailabilityQuerySchema.safeParse({ services: Array(5).fill(`${id}:ANY`), date: "2026-12-01" }).success,
    ).toBe(false));
  it("rejects a non-uuid excludeAppointmentId", () =>
    expect(
      AvailabilityQuerySchema.safeParse({ services: `${id}:ANY`, date: "2026-12-01", excludeAppointmentId: "x" })
        .success,
    ).toBe(false));
});
