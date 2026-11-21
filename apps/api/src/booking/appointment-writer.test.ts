import { BadRequestException, ConflictException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context, PlannedSegment, PlanRejection } from "@beautyspa/availability";
import type { AuditService } from "../audit/audit.service.js";
import { AppointmentWriter } from "./appointment-writer.js";
import type { BookingContextService } from "./booking-context.service.js";

const { validatePlan } = vi.hoisted(() => ({ validatePlan: vi.fn() }));
vi.mock("@beautyspa/availability", () => ({ validatePlan }));

const segment: PlannedSegment = {
  serviceId: "11111111-1111-4111-8111-111111111111",
  employeeId: "22222222-2222-4222-8222-222222222222",
  resourceId: null,
  start: Date.parse("2026-12-01T14:00:00.000Z"),
  end: Date.parse("2026-12-01T14:30:00.000Z"),
  blockEnd: Date.parse("2026-12-01T14:35:00.000Z"),
  durationMin: 30,
  priceCents: 2500,
};
const ctx = {} as Context;
/** `validateOrThrow` never touches the context loader or the audit service. */
const newWriter = () => new AppointmentWriter({} as BookingContextService, {} as AuditService);

const thrown = (reason: PlanRejection): unknown => {
  validatePlan.mockReturnValueOnce({ ok: false, reason });
  try {
    newWriter().validateOrThrow(ctx, [segment]);
  } catch (err) {
    return err;
  }
  return undefined;
};

describe("AppointmentWriter.validateOrThrow", () => {
  beforeEach(() => validatePlan.mockReset());

  it("passes the concrete choices and segments to validatePlan and returns on success", () => {
    validatePlan.mockReturnValueOnce({ ok: true });
    expect(() => newWriter().validateOrThrow(ctx, [segment])).not.toThrow();
    expect(validatePlan).toHaveBeenCalledWith(
      ctx,
      [{ serviceId: segment.serviceId, employeeId: segment.employeeId }],
      [segment],
    );
  });

  it.each<PlanRejection>(["EMPLOYEE_UNAVAILABLE", "RESOURCE_UNAVAILABLE", "TOO_SOON"])(
    "maps %s to 409 SLOT_TAKEN",
    (reason) => {
      const err = thrown(reason);
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).getResponse()).toMatchObject({ code: "SLOT_TAKEN" });
    },
  );

  it.each<PlanRejection>(["NOT_QUALIFIED", "NOT_BOOKABLE_ONLINE", "BEYOND_HORIZON", "MALFORMED_PLAN"])(
    "maps %s to 400 VALIDATION_FAILED on segments",
    (reason) => {
      const err = thrown(reason);
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).getResponse()).toMatchObject({
        code: "VALIDATION_FAILED",
        errors: [{ path: "segments" }],
      });
    },
  );
});
