import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { bookSegment, createTestClient, type Fixture, rejectionCode, seedFixture, truncateAll } from "./helpers.js";

const prisma = createTestClient();
let f: Fixture;

beforeEach(async () => {
  await truncateAll(prisma);
  f = await seedFixture(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("history foreign keys are restrictive", () => {
  it("refuses to delete a customer that has an appointment (23503)", async () => {
    await bookSegment(prisma, f, { staffUserId: f.staffA, startsAt: "10:00", endsAt: "11:00" });
    const code = await rejectionCode(prisma.$executeRaw`DELETE FROM customer WHERE id = ${f.customerId}::uuid`);
    expect(code).toBe("23503");
  });

  it("refuses to delete a customer that has consent history (23503)", async () => {
    await prisma.notificationConsent.create({
      data: {
        organizationId: f.orgId,
        customerId: f.customerId,
        channel: "WHATSAPP",
        granted: true,
        source: "BOOKING_FORM",
      },
    });
    const code = await rejectionCode(prisma.$executeRaw`DELETE FROM customer WHERE id = ${f.customerId}::uuid`);
    expect(code).toBe("23503");
  });

  it("refuses to delete a resource referenced by a segment (23503)", async () => {
    await bookSegment(prisma, f, {
      staffUserId: f.staffA,
      startsAt: "10:00",
      endsAt: "11:00",
      resourceId: f.resource1,
    });
    const code = await rejectionCode(prisma.$executeRaw`DELETE FROM resource WHERE id = ${f.resource1}::uuid`);
    expect(code).toBe("23503");
  });

  it("refuses to delete a resource type used by a service (23503)", async () => {
    const code = await rejectionCode(
      prisma.$executeRaw`DELETE FROM resource_type WHERE id = ${f.resourceTypeId}::uuid`,
    );
    expect(code).toBe("23503");
  });
});

describe("tenancy and flexible columns", () => {
  it("stores organization_id directly on hot child tables", async () => {
    const rows = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name::text FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'organization_id' AND is_nullable = 'NO'
        AND table_name IN ('resource', 'appointment_segment', 'working_hours', 'time_off', 'notification_consent')
      ORDER BY table_name`;
    expect(rows.map((r) => r.table_name)).toEqual([
      "appointment_segment",
      "notification_consent",
      "resource",
      "time_off",
      "working_hours",
    ]);
  });

  it("allows a customer without a name (created at OTP verify)", async () => {
    const c = await prisma.customer.create({
      data: { organizationId: f.orgId, phoneE164: "+13055550199", locale: "es", createdVia: "ONLINE" },
    });
    expect(c.name).toBeNull();
  });

  it("accepts a non-UUID audit entity_id", async () => {
    const row = await prisma.auditLog.create({
      data: {
        organizationId: f.orgId,
        actorType: "SYSTEM",
        action: "employee_service.add",
        entity: "employee_service",
        entityId: `${f.staffA}:${f.serviceId}`,
      },
    });
    expect(row.entityId).toContain(":");
  });
});

describe("schedule checks", () => {
  const time = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);
  const workingHours = (weekday: number, start: string, end: string) =>
    prisma.workingHours.create({
      data: {
        organizationId: f.orgId,
        staffUserId: f.staffA,
        locationId: f.locationId,
        weekday,
        startTime: time(start),
        endTime: time(end),
      },
    });

  it("names all eight constraints", async () => {
    const rows = await prisma.$queryRaw<{ conname: string }[]>`
      SELECT conname::text FROM pg_constraint
      WHERE contype = 'c' AND conname IN (
        'working_hours_weekday', 'working_hours_time_order',
        'location_hours_weekday', 'location_hours_time_order',
        'time_off_time_order', 'location_closure_time_order',
        'service_amounts', 'service_level_price_amounts')
      ORDER BY conname`;
    expect(rows.map((r) => r.conname)).toEqual([
      "location_closure_time_order",
      "location_hours_time_order",
      "location_hours_weekday",
      "service_amounts",
      "service_level_price_amounts",
      "time_off_time_order",
      "working_hours_time_order",
      "working_hours_weekday",
    ]);
  });

  it("rejects working_hours weekday 7 (23514)", async () => {
    expect(await rejectionCode(workingHours(7, "09:00", "17:00"))).toBe("23514");
  });

  it("rejects working_hours ending before they start (23514)", async () => {
    expect(await rejectionCode(workingHours(1, "10:00", "09:00"))).toBe("23514");
  });

  it("accepts working_hours ending at midnight (end 00:00 = 24:00)", async () => {
    const row = await workingHours(1, "18:00", "00:00");
    expect(row.endTime.toISOString()).toBe("1970-01-01T00:00:00.000Z");
  });

  it("rejects location_hours closing before opening (23514)", async () => {
    const code = await rejectionCode(
      prisma.locationHours.create({
        data: { locationId: f.locationId, weekday: 1, opens: time("12:00"), closes: time("11:00") },
      }),
    );
    expect(code).toBe("23514");
  });

  it("rejects time_off with starts_at = ends_at (23514)", async () => {
    const at = new Date("2026-12-01T10:00:00.000Z");
    const code = await rejectionCode(
      prisma.timeOff.create({
        data: { organizationId: f.orgId, staffUserId: f.staffA, startsAt: at, endsAt: at, kind: "VACATION" },
      }),
    );
    expect(code).toBe("23514");
  });

  it("rejects a service with duration_min 0 (23514)", async () => {
    const code = await rejectionCode(
      prisma.service.create({
        data: { organizationId: f.orgId, name: { en: "X", es: "X" }, durationMin: 0, priceCents: 1000 },
      }),
    );
    expect(code).toBe("23514");
  });
});

describe("notification_log dedupe", () => {
  it("notification_log_dedupe rejects a duplicate row", async () => {
    const appt = await bookSegment(prisma, f, { staffUserId: f.staffA, startsAt: "10:00", endsAt: "11:00" });
    const row = {
      organizationId: f.orgId,
      appointmentId: appt.id,
      customerId: f.customerId,
      templateKey: "appointment.confirmed",
      manageVersion: 0,
      channel: "EMAIL" as const,
      locale: "en",
      provider: "fake",
      status: "QUEUED" as const,
    };
    await prisma.notificationLog.create({ data: row });
    const code = await prisma.notificationLog.create({ data: row }).then(
      () => undefined,
      (err: { code?: string; meta?: { target?: unknown } }) => err.code,
    );
    expect(code).toBe("P2002");
    // A new manage version or another channel is a different notification.
    await prisma.notificationLog.create({ data: { ...row, manageVersion: 1 } });
    await prisma.notificationLog.create({ data: { ...row, channel: "PUSH" } });
    const index = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname::text FROM pg_indexes WHERE indexname = 'notification_log_dedupe'`;
    expect(index).toHaveLength(1);
  });
});
