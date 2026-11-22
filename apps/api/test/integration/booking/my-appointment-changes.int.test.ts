import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Appointment, Repeat, Slot } from "@beautyspa/contracts";
import { AppointmentWriter } from "../../../src/booking/appointment-writer.js";
import { BookingEvents } from "../../../src/booking/booking-events.js";
import { CLOCK } from "../../../src/common/clock.js";
import { slotTaken } from "../../../src/common/http-errors.js";
import { createIntegrationApp, resetState, resetTenancyCache } from "../app.js";
import {
  BOOKING_DATE,
  BOOKING_NOW,
  bookSegment,
  customerSession,
  fixedClock,
  seedBookingFixture,
  SEEDED_TIMES_SET_AT,
  type BookingFixture,
} from "../helpers.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

describe("POST /me/appointments/:id/cancel | reschedule | repeat", () => {
  const clock = fixedClock(BOOKING_NOW);
  const events = {
    booked: vi.fn<(id: string) => Promise<void>>(),
    changed: vi.fn<(id: string) => Promise<void>>(),
    cancelled: vi.fn<(id: string) => Promise<void>>(),
  };
  let ctx: Awaited<ReturnType<typeof createIntegrationApp>>;
  let f: BookingFixture;
  let token: string;

  const http = () => request(ctx.app.getHttpServer());
  const post = (path: string, body: Record<string, unknown> = {}, bearer: string = token) =>
    http().post(`/v1/me/appointments/${path}`).set("Authorization", `Bearer ${bearer}`).send(body);

  const slotsFor = async (query: string, bearer: string = token): Promise<Slot[]> => {
    const res = await http().get(`/v1/availability?${query}`).set("Authorization", `Bearer ${bearer}`);
    expect(res.status).toBe(200);
    return res.body as Slot[];
  };

  interface SeedSegment {
    serviceId: string;
    staffUserId: string;
    resourceId?: string | null;
    startsAt: string;
    durationMin: number;
  }

  /** A BOOKED (by default) appointment of the caller written straight to the DB. */
  const seedAppointment = (
    segments: SeedSegment[],
    opts: { customerId?: string; status?: "BOOKED" | "CANCELLED" } = {},
  ) =>
    ctx.prisma.appointment.create({
      data: {
        organizationId: f.orgId,
        locationId: f.locationId,
        customerId: opts.customerId ?? f.customerId,
        status: opts.status ?? "BOOKED",
        source: "ONLINE",
        timesSetAt: SEEDED_TIMES_SET_AT,
        segments: {
          create: segments.map((s) => {
            const startsAt = new Date(s.startsAt);
            const endsAt = new Date(startsAt.getTime() + s.durationMin * MINUTE);
            return {
              organizationId: f.orgId,
              serviceId: s.serviceId,
              staffUserId: s.staffUserId,
              resourceId: s.resourceId ?? null,
              startsAt,
              endsAt,
              blockEndsAt: endsAt,
              durationMin: s.durationMin,
              priceCents: 4000,
              occupies: (opts.status ?? "BOOKED") === "BOOKED",
            };
          }),
        },
      },
      select: { id: true },
    });

  /** Pedicure with staffA and chair 1 on 2026-12-01 at 14:00Z (09:00 local). */
  const START = Date.parse("2026-12-01T14:00:00.000Z");
  const seedPedi = (customerId?: string) =>
    seedAppointment(
      [
        {
          serviceId: f.pediId,
          staffUserId: f.staffA,
          resourceId: f.resource1,
          startsAt: new Date(START).toISOString(),
          durationMin: 60,
        },
      ],
      { customerId },
    );

  const snapshot = async (id: string) => {
    const row = await ctx.prisma.appointment.findUniqueOrThrow({
      where: { id },
      include: { segments: { orderBy: { startsAt: "asc" } } },
    });
    return {
      status: row.status,
      manageVersion: row.manageVersion,
      cancelledAt: row.cancelledAt,
      segments: row.segments.map((s) => ({ id: s.id, startsAt: s.startsAt, occupies: s.occupies })),
    };
  };

  beforeAll(async () => {
    ctx = await createIntegrationApp({
      override: (b) => b.overrideProvider(CLOCK).useValue(clock).overrideProvider(BookingEvents).useValue(events),
    });
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await resetState(ctx.prisma, ctx.redis);
    resetTenancyCache(ctx.app);
    clock.set(BOOKING_NOW);
    for (const fn of Object.values(events)) {
      fn.mockReset();
      fn.mockResolvedValue(undefined);
    }
    f = await seedBookingFixture(ctx.prisma);
    token = (await customerSession(ctx.app, f)).token;
  });

  describe("cancel", () => {
    it("cancels a booking 48 h ahead, frees its time and records the change", async () => {
      clock.set(START - 48 * HOUR);
      const { id } = await seedPedi();
      const staffAQuery = `services=${f.pediId}:${f.staffA}&date=${BOOKING_DATE}`;
      const startIso = new Date(START).toISOString();
      expect((await slotsFor(staffAQuery)).map((s) => s.startsAt)).not.toContain(startIso);

      const res = await post(`${id}/cancel`, { reason: "  Feeling sick  " });
      expect(res.status).toBe(200);
      const body = res.body as Appointment;
      expect(body.status).toBe("CANCELLED");
      expect(body.cancelReason).toBe("Feeling sick");
      expect(body.cancelledAt).toBe(new Date(START - 48 * HOUR).toISOString());

      const row = await ctx.prisma.appointment.findUniqueOrThrow({ where: { id }, include: { segments: true } });
      expect(row.status).toBe("CANCELLED");
      expect(row.cancelledBy).toBe("CUSTOMER");
      expect(row.manageVersion).toBe(1);
      expect(row.segments.every((s) => !s.occupies)).toBe(true);

      expect((await slotsFor(staffAQuery)).map((s) => s.startsAt)).toContain(startIso);

      const audits = await ctx.prisma.auditLog.findMany({ where: { action: "appointment.cancel" } });
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        organizationId: f.orgId,
        actorType: "CUSTOMER",
        actorId: f.customerId,
        entity: "appointment",
        entityId: id,
      });
      expect((audits[0]!.before as { status: string }).status).toBe("BOOKED");
      expect((audits[0]!.after as { status: string }).status).toBe("CANCELLED");
      expect(events.cancelled).toHaveBeenCalledWith(id);
    });

    it("allows cancelling exactly at the window edge and refuses 1 ms later", async () => {
      const { id } = await seedPedi();
      clock.set(START - 24 * HOUR + 1);
      const late = await post(`${id}/cancel`);
      expect(late.status).toBe(409);
      expect(late.body.code).toBe("OUTSIDE_CANCEL_WINDOW");
      expect((await snapshot(id)).status).toBe("BOOKED");

      clock.set(START - 24 * HOUR);
      const ok = await post(`${id}/cancel`);
      expect(ok.status).toBe(200);
      expect((ok.body as Appointment).cancelReason).toBeNull();
    });

    it("with cancelWindowHours 0 allows cancelling until the start", async () => {
      await ctx.prisma.location.update({ where: { id: f.locationId }, data: { settings: { cancelWindowHours: 0 } } });
      const first = await seedPedi();
      const second = await seedAppointment([
        { serviceId: f.maniId, staffUserId: f.staffB, startsAt: new Date(START).toISOString(), durationMin: 30 },
      ]);
      clock.set(START + 1);
      expect((await post(`${first.id}/cancel`)).body.code).toBe("OUTSIDE_CANCEL_WINDOW");
      clock.set(START);
      expect((await post(`${first.id}/cancel`)).status).toBe(200);
      clock.set(START - 1);
      expect((await post(`${second.id}/cancel`)).status).toBe(200);
    });

    it("answers 409 CONFLICT for an appointment that is already cancelled", async () => {
      const { id } = await seedAppointment(
        [{ serviceId: f.pediId, staffUserId: f.staffA, startsAt: new Date(START).toISOString(), durationMin: 60 }],
        { status: "CANCELLED" },
      );
      const res = await post(`${id}/cancel`);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("CONFLICT");
      expect(events.cancelled).not.toHaveBeenCalled();
    });
  });

  describe("reschedule", () => {
    it("moves the booking 15 min later over its own old time", async () => {
      const { id } = await seedPedi();
      const slots = await slotsFor(`services=${f.pediId}:${f.staffA}&date=${BOOKING_DATE}&excludeAppointmentId=${id}`);
      const target = slots.find((s) => s.startsAt === new Date(START + 15 * MINUTE).toISOString());
      expect(target).toBeDefined();

      const res = await post(`${id}/reschedule`, { segments: target!.segments });
      expect(res.status).toBe(200);
      const body = res.body as Appointment;
      expect(body.id).toBe(id);
      expect(body.status).toBe("BOOKED");
      expect(body.startsAt).toBe(target!.startsAt);

      const segs = await ctx.prisma.appointmentSegment.findMany({ where: { appointmentId: id } });
      expect(segs).toHaveLength(1);
      expect(segs[0]!.startsAt.toISOString()).toBe(target!.segments[0]!.startsAt);
      expect(segs[0]!.blockEndsAt.toISOString()).toBe(target!.segments[0]!.blockEndsAt);
      expect(segs[0]!.occupies).toBe(true);
      expect((await snapshot(id)).manageVersion).toBe(1);

      const audits = await ctx.prisma.auditLog.findMany({ where: { action: "appointment.reschedule" } });
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({ actorType: "CUSTOMER", actorId: f.customerId, entityId: id });
      expect((audits[0]!.before as Appointment).startsAt).toBe(new Date(START).toISOString());
      expect((audits[0]!.after as Appointment).startsAt).toBe(target!.startsAt);
      expect(events.changed).toHaveBeenCalledWith(id);
    });

    it("answers 409 SLOT_TAKEN when another booking took the slot and keeps the old time", async () => {
      const { id } = await seedPedi();
      const slots = await slotsFor(`services=${f.pediId}:${f.staffA}&date=${BOOKING_DATE}&excludeAppointmentId=${id}`);
      const target = slots.find((s) => s.startsAt === "2026-12-01T16:00:00.000Z")!;
      expect(target).toBeDefined();
      const other = await ctx.prisma.customer.create({
        data: { organizationId: f.orgId, phoneE164: "+13055550177", name: "Cid", locale: "en", createdVia: "ONLINE" },
      });
      await bookSegment(
        ctx.prisma,
        { ...f, customerId: other.id },
        {
          staffUserId: f.staffA,
          startsAt: "16:00",
          endsAt: "17:00",
          resourceId: f.resource2,
        },
      );
      const before = await snapshot(id);

      const res = await post(`${id}/reschedule`, { segments: target.segments });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("SLOT_TAKEN");

      const afterwards = await snapshot(id);
      expect(afterwards).toEqual(before);
      expect(afterwards.segments.every((s) => s.occupies)).toBe(true);
      expect(afterwards.manageVersion).toBe(0);
      expect(await ctx.prisma.auditLog.count({ where: { action: "appointment.reschedule" } })).toBe(0);
      expect(events.changed).not.toHaveBeenCalled();
    });

    it("rolls back the deleted old segments when inserting the new ones fails", async () => {
      const { id } = await seedPedi();
      const slots = await slotsFor(`services=${f.pediId}:${f.staffA}&date=${BOOKING_DATE}&excludeAppointmentId=${id}`);
      const target = slots.find((s) => s.startsAt === "2026-12-01T16:00:00.000Z")!;
      const before = await snapshot(id);
      const insert = vi.spyOn(AppointmentWriter.prototype, "insertSegments").mockRejectedValueOnce(slotTaken());

      const res = await post(`${id}/reschedule`, { segments: target.segments });
      expect(insert).toHaveBeenCalledTimes(1);
      insert.mockRestore();
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("SLOT_TAKEN");
      expect(await snapshot(id)).toEqual(before);
      expect(await ctx.prisma.auditLog.count({ where: { action: "appointment.reschedule" } })).toBe(0);
    });

    it("answers 409 OUTSIDE_CANCEL_WINDOW inside the window", async () => {
      const { id } = await seedPedi();
      const slots = await slotsFor(`services=${f.pediId}:${f.staffA}&date=${BOOKING_DATE}&excludeAppointmentId=${id}`);
      const target = slots.find((s) => s.startsAt === "2026-12-01T16:00:00.000Z")!;
      const before = await snapshot(id);
      clock.set(START - 24 * HOUR + 1);
      const res = await post(`${id}/reschedule`, { segments: target.segments });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("OUTSIDE_CANCEL_WINDOW");
      expect(await snapshot(id)).toEqual(before);
    });

    it("answers 400 on segments when the new plan changes the services, changing nothing", async () => {
      const { id } = await seedPedi();
      const slots = await slotsFor(`services=${f.maniId}:${f.staffA}&date=${BOOKING_DATE}&excludeAppointmentId=${id}`);
      const target = slots.find((s) => s.startsAt === "2026-12-01T16:00:00.000Z")!;
      expect(target).toBeDefined();
      const before = await snapshot(id);
      const res = await post(`${id}/reschedule`, { segments: target.segments });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_FAILED");
      expect(res.body.errors[0].path).toBe("segments");
      expect(await snapshot(id)).toEqual(before);
      expect(await ctx.prisma.auditLog.count({ where: { entityId: id } })).toBe(0);
      expect(events.changed).not.toHaveBeenCalled();
    });

    it("answers 409 CONFLICT for a cancelled appointment", async () => {
      const { id } = await seedAppointment(
        [{ serviceId: f.pediId, staffUserId: f.staffA, startsAt: new Date(START).toISOString(), durationMin: 60 }],
        { status: "CANCELLED" },
      );
      const slots = await slotsFor(`services=${f.pediId}:${f.staffA}&date=${BOOKING_DATE}`);
      const target = slots.find((s) => s.startsAt === "2026-12-01T16:00:00.000Z")!;
      const before = await snapshot(id);
      const res = await post(`${id}/reschedule`, { segments: target.segments });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("CONFLICT");
      expect(await snapshot(id)).toEqual(before);
    });
  });

  describe("ownership", () => {
    it("answers 404 for another customer's appointment on cancel, reschedule and repeat, changing nothing", async () => {
      const other = await ctx.prisma.customer.create({
        data: { organizationId: f.orgId, phoneE164: "+13055550166", name: "Dee", locale: "en", createdVia: "ONLINE" },
      });
      const { id } = await seedPedi(other.id);
      const { token: otherToken } = await customerSession(ctx.app, f, other.id);
      const slots = await slotsFor(
        `services=${f.pediId}:${f.staffA}&date=${BOOKING_DATE}&excludeAppointmentId=${id}`,
        otherToken,
      );
      const target = slots.find((s) => s.startsAt === "2026-12-01T16:00:00.000Z")!;
      const before = await snapshot(id);

      const cancel = await post(`${id}/cancel`);
      expect(cancel.status).toBe(404);
      expect(cancel.body.code).toBe("NOT_FOUND");
      expect((await post(`${id}/reschedule`, { segments: target.segments })).status).toBe(404);
      expect((await post(`${id}/repeat`)).status).toBe(404);

      expect(await snapshot(id)).toEqual(before);
      expect(await ctx.prisma.auditLog.count({ where: { entityId: id } })).toBe(0);
      expect(events.cancelled).not.toHaveBeenCalled();
      expect(events.changed).not.toHaveBeenCalled();
    });

    it("answers 404 for an appointment of another organization", async () => {
      const { id } = await seedPedi();
      const slots = await slotsFor(`services=${f.pediId}:${f.staffA}&date=${BOOKING_DATE}&excludeAppointmentId=${id}`);
      const target = slots.find((s) => s.startsAt === "2026-12-01T16:00:00.000Z")!;
      const otherOrg = await ctx.prisma.organization.create({
        data: { name: "Other", slug: "other", defaultLocale: "en" },
      });
      await ctx.prisma
        .$executeRaw`UPDATE appointment SET organization_id = ${otherOrg.id}::uuid WHERE id = ${id}::uuid`;
      const before = await snapshot(id);
      expect((await post(`${id}/cancel`)).status).toBe(404);
      expect((await post(`${id}/reschedule`, { segments: target.segments })).status).toBe(404);
      expect((await post(`${id}/repeat`)).status).toBe(404);
      expect(await snapshot(id)).toEqual(before);
      expect(await ctx.prisma.auditLog.count({ where: { entityId: id } })).toBe(0);
    });
  });

  describe("repeat", () => {
    const seedManiPedi = () =>
      seedAppointment([
        { serviceId: f.maniId, staffUserId: f.staffA, startsAt: "2026-12-01T14:00:00.000Z", durationMin: 30 },
        {
          serviceId: f.pediId,
          staffUserId: f.staffB,
          resourceId: f.resource1,
          startsAt: "2026-12-01T14:35:00.000Z",
          durationMin: 60,
        },
      ]);

    it("returns the services in order with their employees", async () => {
      const { id } = await seedManiPedi();
      const res = await post(`${id}/repeat`);
      expect(res.status).toBe(200);
      expect(res.body as Repeat).toEqual({
        locationId: f.locationId,
        services: [
          { serviceId: f.maniId, employeeId: f.staffA },
          { serviceId: f.pediId, employeeId: f.staffB },
        ],
      });
    });

    it("falls back to ANY for an employee who is no longer bookable", async () => {
      const { id } = await seedManiPedi();
      await ctx.prisma.staffUser.update({ where: { id: f.staffB }, data: { active: false } });
      const res = await post(`${id}/repeat`);
      expect(res.status).toBe(200);
      expect((res.body as Repeat).services).toEqual([
        { serviceId: f.maniId, employeeId: f.staffA },
        { serviceId: f.pediId, employeeId: "ANY" },
      ]);
    });

    it("falls back to ANY when the employee lost the service, left the location or is not online", async () => {
      const { id } = await seedManiPedi();
      await ctx.prisma.employeeService.delete({
        where: { staffUserId_serviceId: { staffUserId: f.staffA, serviceId: f.maniId } },
      });
      await ctx.prisma.employeeProfile.update({ where: { staffUserId: f.staffB }, data: { bookableOnline: false } });
      let res = await post(`${id}/repeat`);
      expect((res.body as Repeat).services.map((s) => s.employeeId)).toEqual(["ANY", "ANY"]);

      await ctx.prisma.employeeProfile.update({ where: { staffUserId: f.staffB }, data: { bookableOnline: true } });
      await ctx.prisma.staffLocation.deleteMany({ where: { staffUserId: f.staffB } });
      res = await post(`${id}/repeat`);
      expect((res.body as Repeat).services.map((s) => s.employeeId)).toEqual(["ANY", "ANY"]);
    });

    it("drops an inactive service and works for a cancelled appointment", async () => {
      const { id } = await seedManiPedi();
      await ctx.prisma.service.update({ where: { id: f.maniId }, data: { active: false } });
      await ctx.prisma.appointment.update({ where: { id }, data: { status: "CANCELLED" } });
      const res = await post(`${id}/repeat`);
      expect(res.status).toBe(200);
      expect((res.body as Repeat).services).toEqual([{ serviceId: f.pediId, employeeId: f.staffB }]);
    });
  });
});
