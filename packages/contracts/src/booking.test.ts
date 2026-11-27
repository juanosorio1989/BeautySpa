import { describe, it, expect } from "vitest";
import {
  AgendaQuerySchema,
  HoldInputSchema,
  BookInputSchema,
  CancelInputSchema,
  StatusChangeSchema,
  StaffAppointmentInputSchema,
  WalkInInputSchema,
} from "./booking";

const id = "123e4567-e89b-42d3-a456-426614174000";
const seg = {
  serviceId: id,
  employeeId: id,
  resourceId: null,
  startsAt: "2026-12-01T15:00:00Z",
  endsAt: "2026-12-01T16:00:00Z",
  blockEndsAt: "2026-12-01T16:00:00Z",
  durationMin: 60,
  priceCents: 5000,
};

describe("HoldInputSchema", () => {
  it("rejects 0 segments", () => expect(HoldInputSchema.safeParse({ segments: [] }).success).toBe(false));
  it("rejects 5 segments", () =>
    expect(HoldInputSchema.safeParse({ segments: Array(5).fill(seg) }).success).toBe(false));
  it("accepts 1 segment", () => expect(HoldInputSchema.safeParse({ segments: [seg] }).success).toBe(true));
});

describe("BookInputSchema", () => {
  it("defaults notes to null", () => expect(BookInputSchema.parse({ holdId: id }).notes).toBeNull());
  it("rejects notes over 500 chars", () =>
    expect(BookInputSchema.safeParse({ holdId: id, notes: "a".repeat(501) }).success).toBe(false));
});

describe("StatusChangeSchema", () => {
  it("rejects BOOKED and HELD", () => {
    expect(StatusChangeSchema.safeParse({ status: "BOOKED" }).success).toBe(false);
    expect(StatusChangeSchema.safeParse({ status: "HELD" }).success).toBe(false);
  });
  it("accepts COMPLETED with default reason null", () =>
    expect(StatusChangeSchema.parse({ status: "COMPLETED" }).reason).toBeNull());
});

describe("StaffAppointmentInputSchema", () => {
  it("defaults override to false", () =>
    expect(StaffAppointmentInputSchema.parse({ customerId: id, segments: [seg] }).override).toBe(false));
});

describe("blank notes and reasons", () => {
  const blank = "   ";
  it("turns blank BookInputSchema.notes into null", () =>
    expect(BookInputSchema.parse({ holdId: id, notes: blank }).notes).toBeNull());
  it("turns blank CancelInputSchema.reason into null", () =>
    expect(CancelInputSchema.parse({ reason: blank }).reason).toBeNull());
  it("turns blank StatusChangeSchema.reason into null", () =>
    expect(StatusChangeSchema.parse({ status: "CANCELLED", reason: blank }).reason).toBeNull());
  it("turns blank WalkInInputSchema.notes into null", () =>
    expect(
      WalkInInputSchema.parse({ services: [{ serviceId: id, employeeId: "ANY" }], notes: blank }).notes,
    ).toBeNull());
  it("turns blank StaffAppointmentInputSchema.notes into null", () =>
    expect(StaffAppointmentInputSchema.parse({ customerId: id, segments: [seg], notes: blank }).notes).toBeNull());
  it("keeps trimmed text", () => expect(CancelInputSchema.parse({ reason: "  sick  " }).reason).toBe("sick"));
  it("still rejects a reason over 200 chars", () =>
    expect(CancelInputSchema.safeParse({ reason: "a".repeat(201) }).success).toBe(false));
});

describe("AgendaQuerySchema", () => {
  it("defaults includeCancelled to false", () =>
    expect(AgendaQuerySchema.parse({ date: "2026-12-01" }).includeCancelled).toBe(false));
  it("parses true", () =>
    expect(AgendaQuerySchema.parse({ date: "2026-12-01", includeCancelled: "true" }).includeCancelled).toBe(true));
  it("rejects yes", () =>
    expect(AgendaQuerySchema.safeParse({ date: "2026-12-01", includeCancelled: "yes" }).success).toBe(false));
});
