import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Appointment, CustomerExport, PlannedSegment, StaffAppointment } from "@beautyspa/contracts";
import { TokenService } from "../../../src/auth/token.service.js";
import { BookingEvents } from "../../../src/booking/booking-events.js";
import { CLOCK } from "../../../src/common/clock.js";
import { createIntegrationApp, resetState, resetTenancyCache } from "../app.js";
import {
  BOOKING_NOW,
  bookSegment,
  customerSession,
  fixedClock,
  seedBookingFixture,
  SEEDED_TIMES_SET_AT,
  staffSession,
  type BookingFixture,
} from "../helpers.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** 2026-12-01 local (America/New_York, UTC-5) wall time as an epoch ms. */
const local = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return Date.parse("2026-12-01T05:00:00.000Z") + h! * HOUR + m! * MINUTE;
};
const iso = (ms: number) => new Date(ms).toISOString();

describe("staff appointments: create, move, status", () => {
  const clock = fixedClock(BOOKING_NOW);
  const events = {
    booked: vi.fn<(id: string) => Promise<void>>(),
    changed: vi.fn<(id: string) => Promise<void>>(),
    cancelled: vi.fn<(id: string) => Promise<void>>(),
  };
  let ctx: Awaited<ReturnType<typeof createIntegrationApp>>;
  let f: BookingFixture;
  let reception: { id: string; token: string };

  const http = () => request(ctx.app.getHttpServer());
  const authed = (req: request.Test, bearer: string) => req.set("Authorization", `Bearer ${bearer}`);
  const create = (body: Record<string, unknown>, bearer = reception.token) =>
    authed(http().post("/v1/staff/appointments"), bearer).send(body);
  const move = (id: string, body: Record<string, unknown>, bearer = reception.token) =>
    authed(http().patch(`/v1/staff/appointments/${id}`), bearer).send(body);
  const setStatus = (id: string, body: Record<string, unknown>, bearer = reception.token) =>
    authed(http().post(`/v1/staff/appointments/${id}/status`), bearer).send(body);

  const pedi = (startMs: number, employeeId = f.staffA, resourceId = f.resource1): PlannedSegment => ({
    serviceId: f.pediId,
    employeeId,
    resourceId,
    startsAt: iso(startMs),
    endsAt: iso(startMs + 60 * MINUTE),
    blockEndsAt: iso(startMs + 60 * MINUTE),
    durationMin: 60,
    priceCents: 4000,
  });
  const mani = (startMs: number, employeeId = f.staffA): PlannedSegment => ({
    serviceId: f.maniId,
    employeeId,
    resourceId: null,
    startsAt: iso(startMs),
    endsAt: iso(startMs + 30 * MINUTE),
    blockEndsAt: iso(startMs + 35 * MINUTE),
    durationMin: 30,
    priceCents: 2500,
  });

  /** BOOKED pedicure of Ana with staffA and chair 1 at 10:00 local (15:00Z). */
  const seedPedi = (staffUserId = f.staffA) =>
    bookSegment(ctx.prisma, f, { staffUserId, startsAt: "15:00", endsAt: "16:00", resourceId: f.resource1 });

  const employeeToken = async (staffUserId: string) =>
    (await ctx.app.get(TokenService).issueAccess({ sub: staffUserId, typ: "staff", org: f.orgId, role: "EMPLOYEE" }))
      .token;

  /** A BOOKED appointment in a second organization (own location, staff and service); returns its id. */
  const seedOtherOrgAppointment = async () => {
    const org = await ctx.prisma.organization.create({
      data: { name: "Other", slug: "other-salon", defaultLocale: "en" },
    });
    const location = await ctx.prisma.location.create({
      data: { organizationId: org.id, name: "Other main", timezone: "America/New_York", settings: {} },
    });
    const staff = await ctx.prisma.staffUser.create({
      data: { organizationId: org.id, email: "x@other.dev", role: "EMPLOYEE", locale: "en" },
    });
    const service = await ctx.prisma.service.create({
      data: { organizationId: org.id, name: { en: "Cut", es: "Corte" }, durationMin: 60, priceCents: 3000 },
    });
    const startsAt = new Date(local("10:00"));
    const endsAt = new Date(local("11:00"));
    const appt = await ctx.prisma.appointment.create({
      data: {
        organizationId: org.id,
        locationId: location.id,
        status: "BOOKED",
        source: "ONLINE",
        timesSetAt: SEEDED_TIMES_SET_AT,
        segments: {
          create: {
            organizationId: org.id,
            serviceId: service.id,
            staffUserId: staff.id,
            startsAt,
            endsAt,
            blockEndsAt: endsAt,
            durationMin: 60,
            priceCents: 3000,
            occupies: true,
          },
        },
      },
      select: { id: true },
    });
    return appt.id;
  };

  const auditsOf = (action: string) => ctx.prisma.auditLog.findMany({ where: { action }, orderBy: { id: "asc" } });

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
    reception = await staffSession(ctx.app, ctx.prisma, f, "RECEPTION");
  });

  describe("POST /staff/appointments", () => {
    it("books a pedicure for the customer as RECEPTION and records it", async () => {
      const res = await create({ customerId: f.customerId, segments: [pedi(local("10:00"))], notes: "Window seat" });
      expect(res.status).toBe(201);
      const body = res.body as StaffAppointment;
      expect(body).toMatchObject({
        status: "BOOKED",
        source: "RECEPTION",
        createdByStaffId: reception.id,
        startsAt: iso(local("10:00")),
        notes: "Window seat",
        cancelledBy: null,
      });
      expect(body.customer?.name).toBe("Ana");

      const segs = await ctx.prisma.appointmentSegment.findMany({ where: { appointmentId: body.id } });
      expect(segs).toHaveLength(1);
      expect(segs[0]).toMatchObject({ organizationId: f.orgId, occupies: true, resourceId: f.resource1 });

      const audits = await auditsOf("appointment.create");
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        organizationId: f.orgId,
        actorType: "STAFF",
        actorId: reception.id,
        entity: "appointment",
        entityId: body.id,
        before: null,
      });
      expect((audits[0]!.after as Appointment).status).toBe("BOOKED");
      expect(audits[0]!.after).not.toHaveProperty("override");
      expect(events.booked).toHaveBeenCalledWith(body.id);
    });

    it("refuses 08:00 (before hours) without override and books it with override, recorded in the audit", async () => {
      const early = [pedi(local("08:00"))];
      const refused = await create({ customerId: f.customerId, segments: early });
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe("SLOT_TAKEN");
      expect(await ctx.prisma.appointment.count()).toBe(0);

      const ok = await create({ customerId: f.customerId, segments: early, override: true });
      expect(ok.status).toBe(201);
      const audits = await auditsOf("appointment.create");
      expect(audits).toHaveLength(1);
      expect((audits[0]!.after as { override?: boolean }).override).toBe(true);
    });

    it("never allows an overlap with the same employee, even with override", async () => {
      await seedPedi();
      const res = await create({
        customerId: f.customerId,
        segments: [pedi(local("10:30"), f.staffA, f.resource2)],
        override: true,
      });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("SLOT_TAKEN");
      expect(await ctx.prisma.appointment.count()).toBe(1);
      expect(events.booked).not.toHaveBeenCalled();
    });

    it("ignores the online lead time (09:30 local books 09:45)", async () => {
      clock.set(local("09:30"));
      const res = await create({ customerId: f.customerId, segments: [pedi(local("09:45"))] });
      expect(res.status).toBe(201);
    });

    it("answers 400 on customerId for another organization's or a deleted customer", async () => {
      const otherOrg = await ctx.prisma.organization.create({
        data: { name: "Other", slug: "other-salon", defaultLocale: "en" },
      });
      const foreign = await ctx.prisma.customer.create({
        data: {
          organizationId: otherOrg.id,
          phoneE164: "+13055550199",
          name: "Zed",
          locale: "en",
          createdVia: "ONLINE",
        },
      });
      const gone = await ctx.prisma.customer.create({
        data: {
          organizationId: f.orgId,
          phoneE164: "+13055550198",
          name: null,
          locale: "en",
          createdVia: "ONLINE",
          deletedAt: new Date(BOOKING_NOW - HOUR),
        },
      });
      for (const customerId of [foreign.id, gone.id]) {
        const res = await create({ customerId, segments: [pedi(local("10:00"))] });
        expect(res.status).toBe(400);
        expect(res.body.errors).toEqual([{ path: "customerId", message: "Unknown customer" }]);
      }
      expect(await ctx.prisma.appointment.count()).toBe(0);
    });

    it("is forbidden to EMPLOYEE", async () => {
      const res = await create(
        { customerId: f.customerId, segments: [pedi(local("10:00"))] },
        await employeeToken(f.staffA),
      );
      expect(res.status).toBe(403);
    });
  });

  describe("PATCH /staff/appointments/:id", () => {
    it("moves the appointment to 11:00 and records the move", async () => {
      const { id } = await seedPedi();
      const res = await move(id, { segments: [pedi(local("11:00"))] });
      expect(res.status).toBe(200);
      const body = res.body as StaffAppointment;
      expect(body.startsAt).toBe(iso(local("11:00")));

      const row = await ctx.prisma.appointment.findUniqueOrThrow({ where: { id }, include: { segments: true } });
      expect(row.manageVersion).toBe(1);
      expect(row.segments).toHaveLength(1);
      expect(row.segments[0]!.startsAt.toISOString()).toBe(iso(local("11:00")));

      const audits = await auditsOf("appointment.move");
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({ actorType: "STAFF", actorId: reception.id, entityId: id });
      expect((audits[0]!.before as Appointment).startsAt).toBe(iso(local("10:00")));
      expect((audits[0]!.after as Appointment).startsAt).toBe(iso(local("11:00")));
      expect(events.changed).toHaveBeenCalledWith(id);
    });

    it("may change the services and move outside hours with override (recorded)", async () => {
      const { id } = await seedPedi();
      const res = await move(id, { segments: [mani(local("08:00"))], override: true });
      expect(res.status).toBe(200);
      expect((res.body as StaffAppointment).segments.map((s) => s.serviceId)).toEqual([f.maniId]);
      const audits = await auditsOf("appointment.move");
      expect((audits[0]!.after as { override?: boolean }).override).toBe(true);
    });

    it("keeps the old time when the target is taken", async () => {
      const { id } = await seedPedi();
      await bookSegment(ctx.prisma, f, {
        staffUserId: f.staffA,
        startsAt: "16:00",
        endsAt: "17:00",
        resourceId: f.resource2,
      });
      const res = await move(id, { segments: [pedi(local("11:00"))] });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("SLOT_TAKEN");
      const row = await ctx.prisma.appointment.findUniqueOrThrow({ where: { id }, include: { segments: true } });
      expect(row.manageVersion).toBe(0);
      expect(row.segments[0]!.startsAt.toISOString()).toBe(iso(local("10:00")));
    });

    it("answers 409 for a completed appointment, 404 for an unknown one, 403 for EMPLOYEE", async () => {
      const { id } = await seedPedi();
      await ctx.prisma.appointment.update({ where: { id }, data: { status: "COMPLETED" } });
      const done = await move(id, { segments: [pedi(local("11:00"))] });
      expect(done.status).toBe(409);
      expect(done.body.code).toBe("CONFLICT");

      const unknown = await move("00000000-0000-4000-8000-000000000000", { segments: [pedi(local("11:00"))] });
      expect(unknown.status).toBe(404);

      const employee = await move(id, { segments: [pedi(local("11:00"))] }, await employeeToken(f.staffA));
      expect(employee.status).toBe(403);
    });

    it("moves a CHECKED_IN appointment", async () => {
      const { id } = await seedPedi();
      await ctx.prisma.appointment.update({ where: { id }, data: { status: "CHECKED_IN" } });
      const res = await move(id, { segments: [pedi(local("10:15"))] });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: "CHECKED_IN", startsAt: iso(local("10:15")) });
      expect(events.changed).toHaveBeenCalledWith(id);
    });
  });

  describe("PATCH /staff/appointments/:id of an appointment in progress", () => {
    /** Walk-in at 10:07 local (starts 10:00 with staffA), then the clock moves to 10:20. */
    const inProgressWalkIn = async () => {
      clock.set(local("10:07"));
      const res = await authed(http().post("/v1/staff/walk-in"), reception.token).send({
        customerId: f.customerId,
        services: [{ serviceId: f.pediId, employeeId: f.staffA }],
      });
      expect(res.status).toBe(201);
      const body = res.body as StaffAppointment;
      expect(body.startsAt).toBe(iso(local("10:00")));
      clock.set(local("10:20"));
      return body;
    };

    it("keeps the 10:00 start while handing it to the other employee", async () => {
      const walkIn = await inProgressWalkIn();
      const res = await move(walkIn.id, {
        segments: [pedi(local("10:00"), f.staffB, walkIn.segments[0]!.resourceId!)],
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: "CHECKED_IN", startsAt: iso(local("10:00")) });
      expect((res.body as StaffAppointment).segments[0]!.employeeId).toBe(f.staffB);
    });

    it("adds a second service after the first one", async () => {
      const walkIn = await inProgressWalkIn();
      const first = pedi(local("10:00"), f.staffA, walkIn.segments[0]!.resourceId!);
      const res = await move(walkIn.id, { segments: [first, mani(local("11:00"))] });
      expect(res.status).toBe(200);
      expect((res.body as StaffAppointment).segments).toHaveLength(2);
    });

    it("still refuses moving an in-progress appointment to start earlier than it did", async () => {
      const walkIn = await inProgressWalkIn();
      const res = await move(walkIn.id, {
        segments: [pedi(local("09:45"), f.staffB, walkIn.segments[0]!.resourceId!)],
      });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("SLOT_TAKEN");
    });
  });

  describe("POST /staff/appointments/:id/status", () => {
    it("goes BOOKED -> CHECKED_IN -> COMPLETED and then refuses CANCELLED", async () => {
      const { id } = await seedPedi();
      clock.set(local("09:50"));
      const checkedIn = await setStatus(id, { status: "CHECKED_IN" });
      expect(checkedIn.status).toBe(200);
      expect((checkedIn.body as StaffAppointment).status).toBe("CHECKED_IN");
      const completed = await setStatus(id, { status: "COMPLETED" });
      expect(completed.status).toBe(200);
      expect((completed.body as StaffAppointment).status).toBe("COMPLETED");

      const cancel = await setStatus(id, { status: "CANCELLED" });
      expect(cancel.status).toBe(409);
      expect(cancel.body.code).toBe("CONFLICT");

      const audits = await auditsOf("appointment.status");
      expect(audits.map((a) => [(a.before as Appointment).status, (a.after as Appointment).status])).toEqual([
        ["BOOKED", "CHECKED_IN"],
        ["CHECKED_IN", "COMPLETED"],
      ]);
      expect(audits[0]).toMatchObject({ actorType: "STAFF", actorId: reception.id, entityId: id });
      const segs = await ctx.prisma.appointmentSegment.findMany({ where: { appointmentId: id } });
      expect(segs.every((s) => s.occupies)).toBe(true);
      expect(events.cancelled).not.toHaveBeenCalled();
    });

    it("refuses NO_SHOW before the start and accepts it from the start, freeing the time", async () => {
      const { id } = await seedPedi();
      clock.set(local("10:00") - 1);
      const early = await setStatus(id, { status: "NO_SHOW" });
      expect(early.status).toBe(409);
      expect(early.body.code).toBe("CONFLICT");

      clock.set(local("10:00"));
      const ok = await setStatus(id, { status: "NO_SHOW" });
      expect(ok.status).toBe(200);
      expect((ok.body as StaffAppointment).status).toBe("NO_SHOW");
      const segs = await ctx.prisma.appointmentSegment.findMany({ where: { appointmentId: id } });
      expect(segs.every((s) => !s.occupies)).toBe(true);
      expect(events.cancelled).not.toHaveBeenCalled();
    });

    it("cancels inside the customer cancel window as staff", async () => {
      const { id } = await seedPedi();
      clock.set(local("10:00") - HOUR);
      const res = await setStatus(id, { status: "CANCELLED", reason: " Salon closed early " });
      expect(res.status).toBe(200);
      const body = res.body as StaffAppointment;
      expect(body).toMatchObject({
        status: "CANCELLED",
        cancelledBy: "STAFF",
        cancelReason: "Salon closed early",
        cancelledAt: iso(local("10:00") - HOUR),
      });
      const row = await ctx.prisma.appointment.findUniqueOrThrow({ where: { id }, include: { segments: true } });
      expect(row.manageVersion).toBe(1);
      expect(row.segments.every((s) => !s.occupies)).toBe(true);
      const audits = await auditsOf("appointment.status");
      expect((audits[0]!.before as Appointment).status).toBe("BOOKED");
      expect((audits[0]!.after as Appointment).status).toBe("CANCELLED");
      expect(events.cancelled).toHaveBeenCalledWith(id);
    });

    it("keeps a staff cancel reason from the customer but not from staff or the audit", async () => {
      const { id } = await seedPedi();
      const cancelled = await setStatus(id, { status: "CANCELLED", reason: "Staff sick" });
      expect(cancelled.status).toBe(200);
      expect(cancelled.body as StaffAppointment).toMatchObject({ cancelledBy: "STAFF", cancelReason: "Staff sick" });

      const customer = await customerSession(ctx.app, f);
      const mine = await authed(http().get("/v1/me/appointments"), customer.token);
      expect(mine.status).toBe(200);
      const listed = [...mine.body.upcoming, ...mine.body.past] as Appointment[];
      expect(listed.find((a) => a.id === id)).toMatchObject({ status: "CANCELLED", cancelReason: null });

      const exported = await authed(http().get("/v1/me/export"), customer.token);
      expect(exported.status).toBe(200);
      const inExport = (exported.body as CustomerExport).appointments.find((a) => a.id === id);
      expect(inExport).toMatchObject({ status: "CANCELLED", cancelReason: null });

      const audits = await auditsOf("appointment.status");
      expect((audits[0]!.after as Appointment).cancelReason).toBe("Staff sick");
    });

    it("refuses any change of a HELD or cancelled appointment", async () => {
      const { id } = await seedPedi();
      await ctx.prisma.appointment.update({ where: { id }, data: { status: "HELD" } });
      expect((await setStatus(id, { status: "CHECKED_IN" })).status).toBe(409);
      await ctx.prisma.appointment.update({ where: { id }, data: { status: "CANCELLED" } });
      expect((await setStatus(id, { status: "COMPLETED" })).status).toBe(409);
    });

    it("lets an EMPLOYEE check in their own appointment only, and never cancel", async () => {
      const own = await seedPedi(f.staffA);
      clock.set(local("09:50"));
      const others = await bookSegment(ctx.prisma, f, {
        staffUserId: f.staffB,
        startsAt: "15:00",
        endsAt: "16:00",
        resourceId: f.resource2,
      });
      const token = await employeeToken(f.staffA);

      expect((await setStatus(own.id, { status: "CHECKED_IN" }, token)).status).toBe(200);
      expect((await setStatus(own.id, { status: "CANCELLED" }, token)).status).toBe(403);
      expect((await setStatus(others.id, { status: "CHECKED_IN" }, token)).status).toBe(403);
      expect((await ctx.prisma.appointment.findUniqueOrThrow({ where: { id: others.id } })).status).toBe("BOOKED");
      expect((await ctx.prisma.appointment.findUniqueOrThrow({ where: { id: own.id } })).status).toBe("CHECKED_IN");
    });

    it("refuses CHECKED_IN and COMPLETED on a later local day with 409", async () => {
      const { id } = await seedPedi();
      clock.set(local("10:00") - 24 * HOUR);
      const checkIn = await setStatus(id, { status: "CHECKED_IN" });
      expect(checkIn.status).toBe(409);
      expect(checkIn.body).toMatchObject({ code: "CONFLICT", detail: "Too early to check in" });
      expect((await setStatus(id, { status: "COMPLETED" })).status).toBe(409);
      expect((await ctx.prisma.appointment.findUniqueOrThrow({ where: { id } })).status).toBe("BOOKED");
      expect(await auditsOf("appointment.status")).toHaveLength(0);
    });

    it("checks in on the same local day before the start", async () => {
      const { id } = await seedPedi();
      clock.set(local("00:00"));
      const res = await setStatus(id, { status: "CHECKED_IN" });
      expect(res.status).toBe(200);
      expect((res.body as StaffAppointment).status).toBe("CHECKED_IN");
    });

    it("answers 404 for an unknown appointment id", async () => {
      const res = await setStatus("00000000-0000-4000-8000-000000000000", { status: "CHECKED_IN" });
      expect(res.status).toBe(404);
    });

    it("goes CHECKED_IN -> CANCELLED, freeing the time and notifying once", async () => {
      const { id } = await seedPedi();
      await ctx.prisma.appointment.update({ where: { id }, data: { status: "CHECKED_IN" } });
      const res = await setStatus(id, { status: "CANCELLED" });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: "CANCELLED", cancelledBy: "STAFF", cancelReason: null });
      const segs = await ctx.prisma.appointmentSegment.findMany({ where: { appointmentId: id } });
      expect(segs.every((s) => !s.occupies)).toBe(true);
      expect(events.cancelled).toHaveBeenCalledTimes(1);
      expect(events.cancelled).toHaveBeenCalledWith(id);
    });

    it("completes a BOOKED appointment directly", async () => {
      const { id } = await seedPedi();
      clock.set(local("11:00"));
      const res = await setStatus(id, { status: "COMPLETED" });
      expect(res.status).toBe(200);
      expect((res.body as StaffAppointment).status).toBe("COMPLETED");
      const segs = await ctx.prisma.appointmentSegment.findMany({ where: { appointmentId: id } });
      expect(segs.every((s) => s.occupies)).toBe(true);
    });

    it("lets an EMPLOYEE complete their own appointment but not mark another's as NO_SHOW", async () => {
      const own = await seedPedi(f.staffA);
      const others = await bookSegment(ctx.prisma, f, {
        staffUserId: f.staffB,
        startsAt: "15:00",
        endsAt: "16:00",
        resourceId: f.resource2,
      });
      clock.set(local("10:30"));
      const token = await employeeToken(f.staffA);

      const completed = await setStatus(own.id, { status: "COMPLETED" }, token);
      expect(completed.status).toBe(200);
      expect((completed.body as StaffAppointment).status).toBe("COMPLETED");
      expect((await setStatus(others.id, { status: "NO_SHOW" }, token)).status).toBe(403);
      expect((await ctx.prisma.appointment.findUniqueOrThrow({ where: { id: others.id } })).status).toBe("BOOKED");
    });

    it("answers 404 on PATCH and on status for another organization's appointment and leaves it unchanged", async () => {
      const otherId = await seedOtherOrgAppointment();
      const before = await ctx.prisma.appointment.findUniqueOrThrow({
        where: { id: otherId },
        include: { segments: true },
      });

      const moved = await move(otherId, { segments: [pedi(local("11:00"))] });
      expect(moved.status).toBe(404);
      const status = await setStatus(otherId, { status: "CANCELLED" });
      expect(status.status).toBe(404);

      const after = await ctx.prisma.appointment.findUniqueOrThrow({
        where: { id: otherId },
        include: { segments: true },
      });
      expect(after).toEqual(before);
      expect(await ctx.prisma.auditLog.count()).toBe(0);
      expect(events.changed).not.toHaveBeenCalled();
      expect(events.cancelled).not.toHaveBeenCalled();
    });
  });
});
