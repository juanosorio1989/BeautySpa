import { describe, expect, it } from "vitest";
import { ManageCancelInputSchema, ManageViewSchema } from "./manage";

const appointment = {
  id: "5b8f6f0e-6f1c-4f6e-9d3a-2f7a1c0b9e11",
  locationId: "5b8f6f0e-6f1c-4f6e-9d3a-2f7a1c0b9e12",
  status: "BOOKED",
  source: "ONLINE",
  startsAt: "2026-12-01T14:00:00.000Z",
  endsAt: "2026-12-01T15:00:00.000Z",
  totalPriceCents: 4000,
  notes: null,
  segments: [
    {
      id: "5b8f6f0e-6f1c-4f6e-9d3a-2f7a1c0b9e13",
      serviceId: "5b8f6f0e-6f1c-4f6e-9d3a-2f7a1c0b9e14",
      employeeId: "5b8f6f0e-6f1c-4f6e-9d3a-2f7a1c0b9e15",
      resourceId: null,
      startsAt: "2026-12-01T14:00:00.000Z",
      endsAt: "2026-12-01T15:00:00.000Z",
      blockEndsAt: "2026-12-01T15:00:00.000Z",
      durationMin: 60,
      priceCents: 4000,
    },
  ],
  confirmedByCustomerAt: null,
  cancelledAt: null,
  cancelReason: null,
  createdAt: "2026-11-20T00:00:00.000Z",
};

describe("ManageViewSchema", () => {
  const view = {
    appointment,
    location: { name: "Main", addressLine: "1 Main St, Miami", phone: null, timezone: "America/New_York" },
    canCancel: true,
    canConfirm: true,
  };

  it("parses a view with a nullable phone", () => {
    expect(ManageViewSchema.parse(view)).toEqual(view);
  });

  it("requires addressLine and both flags", () => {
    const location: Record<string, unknown> = { ...view.location };
    delete location.addressLine;
    expect(ManageViewSchema.safeParse({ ...view, location }).success).toBe(false);
    const noFlag: Record<string, unknown> = { ...view };
    delete noFlag.canConfirm;
    expect(ManageViewSchema.safeParse(noFlag).success).toBe(false);
  });
});

describe("ManageCancelInputSchema", () => {
  it("accepts an empty body and stores a blank reason as null", () => {
    expect(ManageCancelInputSchema.parse({})).toEqual({ reason: null });
    expect(ManageCancelInputSchema.parse({ reason: "  " })).toEqual({ reason: null });
  });
});
