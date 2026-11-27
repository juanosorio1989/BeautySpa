import { describe, it, expect } from "vitest";
import { AvailabilityQuerySchema, SlotSchema } from "./availability";

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
  it("parses override=true to true and defaults to false", () => {
    expect(
      AvailabilityQuerySchema.parse({ services: `${id}:ANY`, date: "2026-12-01", override: "true" }).override,
    ).toBe(true);
    expect(AvailabilityQuerySchema.parse({ services: `${id}:ANY`, date: "2026-12-01" }).override).toBe(false);
  });
  it("rejects override values other than true/false", () =>
    expect(
      AvailabilityQuerySchema.safeParse({ services: `${id}:ANY`, date: "2026-12-01", override: "1" }).success,
    ).toBe(false));
});

describe("SlotSchema", () => {
  const slot = {
    startsAt: "2026-12-01T23:00:00.000Z",
    endsAt: "2026-12-02T00:00:00.000Z",
    segments: [
      {
        serviceId: id,
        employeeId: id,
        resourceId: null,
        startsAt: "2026-12-01T23:00:00.000Z",
        endsAt: "2026-12-02T00:00:00.000Z",
        blockEndsAt: "2026-12-02T00:00:00.000Z",
        durationMin: 60,
        priceCents: 4000,
      },
    ],
  };
  it("keeps outsideHours when present and allows it absent", () => {
    expect(SlotSchema.parse({ ...slot, outsideHours: true }).outsideHours).toBe(true);
    expect(SlotSchema.parse(slot)).not.toHaveProperty("outsideHours");
  });
});
