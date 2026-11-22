import { Logger } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomerExport, Me, Slot } from "@beautyspa/contracts";
import { RefreshTokenService } from "../../../src/auth/refresh-token.service.js";
import { BookingEvents } from "../../../src/booking/booking-events.js";
import { CLOCK } from "../../../src/common/clock.js";
import { createIntegrationApp, resetState, resetTenancyCache } from "../app.js";
import {
  BOOKING_DATE,
  BOOKING_NOW,
  bookSegment,
  customerSession,
  fixedClock,
  seedBookingFixture,
  type BookingFixture,
} from "../helpers.js";

const ANA_PHONE = "+13055550100";
const BODY = { "x-token-transport": "body" };

describe("/me profile, export and deletion", () => {
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
  const auth = (bearer: string) => ({ Authorization: `Bearer ${bearer}` });
  const getMe = (bearer: string = token) => http().get("/v1/me").set(auth(bearer));
  const patchMe = (body: Record<string, unknown>, bearer: string = token) =>
    http().patch("/v1/me").set(auth(bearer)).send(body);
  const exportMe = (bearer: string = token) => http().get("/v1/me/export").set(auth(bearer));
  const deleteMe = (bearer: string = token) => http().delete("/v1/me").set(auth(bearer));

  const consentRows = () =>
    ctx.prisma.notificationConsent.findMany({ where: { customerId: f.customerId }, orderBy: { changedAt: "asc" } });
  const auditRows = (action: string) =>
    ctx.prisma.auditLog.findMany({ where: { organizationId: f.orgId, action }, orderBy: { at: "asc" } });

  /** A COMPLETED appointment of `customerId` with staffA (or `staffUserId`) on 2026-11-20 at 14:00Z. */
  const seedPastCompleted = (
    customerId: string = f.customerId,
    notes: string | null = null,
    staffUserId = f.staffA,
  ) => {
    const startsAt = new Date("2026-11-20T14:00:00.000Z");
    const endsAt = new Date("2026-11-20T15:00:00.000Z");
    return ctx.prisma.appointment.create({
      data: {
        organizationId: f.orgId,
        locationId: f.locationId,
        customerId,
        status: "COMPLETED",
        source: "ONLINE",
        notes,
        segments: {
          create: {
            organizationId: f.orgId,
            serviceId: f.pediId,
            staffUserId,
            startsAt,
            endsAt,
            blockEndsAt: endsAt,
            durationMin: 60,
            priceCents: 4000,
            occupies: true,
          },
        },
      },
      select: { id: true },
    });
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
    vi.restoreAllMocks();
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

  describe("GET /me and PATCH /me", () => {
    it("returns the profile with every consent false", async () => {
      const res = await getMe();
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        id: f.customerId,
        phoneE164: ANA_PHONE,
        name: "Ana",
        email: null,
        locale: "es",
        consents: { WHATSAPP: false, SMS: false, EMAIL: false },
      } satisfies Me);
    });

    it("needs a customer token", async () => {
      expect((await http().get("/v1/me")).status).toBe(401);
    });

    it("updates name and consents once, and a repeat writes nothing", async () => {
      const res = await patchMe({ name: "Ana María", consents: { WHATSAPP: true } });
      expect(res.status).toBe(200);
      expect((res.body as Me).name).toBe("Ana María");
      expect((res.body as Me).consents).toEqual({ WHATSAPP: true, SMS: false, EMAIL: false });

      const rows = await consentRows();
      expect(rows.map((r) => ({ channel: r.channel, granted: r.granted, source: r.source }))).toEqual([
        { channel: "WHATSAPP", granted: true, source: "PROFILE" },
      ]);
      const audits = await auditRows("customer.update");
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        actorType: "CUSTOMER",
        actorId: f.customerId,
        entity: "customer",
        entityId: f.customerId,
        before: null,
        after: { fields: ["name", "consents.WHATSAPP"] },
      });

      const again = await patchMe({ name: "Ana María", consents: { WHATSAPP: true } });
      expect(again.status).toBe(200);
      expect(again.body).toEqual(res.body);
      expect(await consentRows()).toHaveLength(1);
      expect(await auditRows("customer.update")).toHaveLength(1);
    });

    it("writes nothing for empty consents or values equal to the current ones", async () => {
      expect((await patchMe({ consents: {} })).status).toBe(200);
      expect((await patchMe({ email: null, locale: "es", consents: { SMS: false } })).status).toBe(200);
      expect(await consentRows()).toHaveLength(0);
      expect(await auditRows("customer.update")).toHaveLength(0);
    });

    it("updates email and locale and lists only changed keys", async () => {
      const res = await patchMe({ email: "ana@example.com", locale: "en", name: "Ana" });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ email: "ana@example.com", locale: "en", name: "Ana" });
      const [audit] = await auditRows("customer.update");
      expect(audit?.after).toEqual({ fields: ["email", "locale"] });
    });

    it("rejects an empty body with 400", async () => {
      expect((await patchMe({})).status).toBe(400);
    });

    it("records consent with source BOOKING_FORM when asked, and PROFILE by default", async () => {
      const res = await patchMe({ email: "ana@example.com", consents: { EMAIL: true }, consentSource: "BOOKING_FORM" });
      expect(res.status).toBe(200);
      let history = ((await exportMe()).body as CustomerExport).consentHistory;
      expect(history.at(-1)).toMatchObject({ channel: "EMAIL", granted: true, source: "BOOKING_FORM" });
      const [audit] = await auditRows("customer.update");
      expect(audit).toMatchObject({ before: null, after: { fields: ["email", "consents.EMAIL"] } });

      clock.set(BOOKING_NOW + 60_000);
      expect((await patchMe({ consents: { EMAIL: false } })).status).toBe(200);
      history = ((await exportMe()).body as CustomerExport).consentHistory;
      expect(history.at(-1)).toMatchObject({ channel: "EMAIL", granted: false, source: "PROFILE" });
    });

    it("rejects consentSource without consents with 400 on consentSource and writes nothing", async () => {
      const res = await patchMe({ name: "X", consentSource: "BOOKING_FORM" });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_FAILED");
      expect(res.body.errors[0].path).toBe("consentSource");
      expect((await patchMe({ consentSource: "BOOKING_FORM" })).status).toBe(400);
      expect((await getMe()).body).toMatchObject({ name: "Ana" });
      expect(await auditRows("customer.update")).toHaveLength(0);
    });
  });

  describe("GET /me/export", () => {
    it("contains the consent history and only the caller's appointments", async () => {
      await patchMe({ consents: { WHATSAPP: true, EMAIL: true } });
      clock.set(BOOKING_NOW + 60_000);
      await patchMe({ consents: { EMAIL: false } });

      const past = await seedPastCompleted();
      const future = await bookSegment(ctx.prisma, f, { staffUserId: f.staffA, startsAt: "14:00", endsAt: "15:00" });
      const other = await ctx.prisma.customer.create({
        data: { organizationId: f.orgId, phoneE164: "+13055550199", name: "Bea", locale: "en", createdVia: "ONLINE" },
      });
      await seedPastCompleted(other.id, null, f.staffB);

      const res = await exportMe();
      expect(res.status).toBe(200);
      const body = res.body as CustomerExport;
      expect(body.customer).toMatchObject({
        id: f.customerId,
        name: "Ana",
        consents: { WHATSAPP: true, EMAIL: false },
      });
      expect(body.consentHistory.map((c) => [c.channel, c.granted, c.source])).toEqual(
        expect.arrayContaining([
          ["WHATSAPP", true, "PROFILE"],
          ["EMAIL", true, "PROFILE"],
          ["EMAIL", false, "PROFILE"],
        ]),
      );
      expect(body.consentHistory).toHaveLength(3);
      expect(body.consentHistory.at(-1)).toMatchObject({ channel: "EMAIL", granted: false });
      expect(body.appointments.map((a) => a.id)).toEqual([past.id, future.id]);
    });
  });

  describe("DELETE /me", () => {
    /** Signs Ana in through OTP (fake provider) to get a real refresh token. */
    const otpLogin = async (phone: string) => {
      expect((await http().post("/v1/auth/otp/start").send({ phone, locale: "es" })).status).toBe(200);
      const res = await http().post("/v1/auth/otp/verify").set(BODY).send({ phone, code: "000000" });
      expect(res.status).toBe(200);
      return res.body as { accessToken: string; refreshToken: string; isNew: boolean };
    };

    const seedDeletable = async () => {
      await ctx.prisma.customer.update({
        where: { id: f.customerId },
        data: { email: "ana@example.com", privateNotesEnc: "v1:secret" },
      });
      await patchMe({ consents: { WHATSAPP: true } });
      const future = await bookSegment(ctx.prisma, f, { staffUserId: f.staffA, startsAt: "14:00", endsAt: "15:00" });
      await ctx.prisma.appointment.update({ where: { id: future.id }, data: { notes: `Ana ${ANA_PHONE}` } });
      const past = await seedPastCompleted(f.customerId, `Ana ana@example.com`);
      return { future, past };
    };

    it("anonymizes the customer, cancels future bookings and ends every session", async () => {
      const { future, past } = await seedDeletable();
      const login = await otpLogin(ANA_PHONE);
      expect(login.isNew).toBe(false);
      const pastBefore = await ctx.prisma.appointment.findUniqueOrThrow({ where: { id: past.id } });

      const res = await deleteMe(login.accessToken);
      expect(res.status).toBe(204);

      const customer = await ctx.prisma.customer.findUniqueOrThrow({ where: { id: f.customerId } });
      expect(customer).toMatchObject({
        name: null,
        email: null,
        privateNotesEnc: null,
        phoneE164: `deleted:${f.customerId}`,
        deletedAt: new Date(BOOKING_NOW),
      });

      const cancelled = await ctx.prisma.appointment.findUniqueOrThrow({
        where: { id: future.id },
        include: { segments: true },
      });
      expect(cancelled).toMatchObject({
        status: "CANCELLED",
        cancelReason: "ACCOUNT_DELETED",
        cancelledBy: "CUSTOMER",
        cancelledAt: new Date(BOOKING_NOW),
        manageVersion: 1,
        notes: null,
        customerId: f.customerId,
      });
      expect(cancelled.segments.every((s) => !s.occupies)).toBe(true);

      const pastAfter = await ctx.prisma.appointment.findUniqueOrThrow({ where: { id: past.id } });
      expect(pastAfter).toEqual({ ...pastBefore, notes: null, updatedAt: pastAfter.updatedAt });
      expect(pastAfter.customerId).toBe(f.customerId);

      const consents = await consentRows();
      expect(consents.map((c) => [c.channel, c.granted, c.source])).toEqual([
        ["WHATSAPP", true, "PROFILE"],
        ["WHATSAPP", false, "PROFILE"],
      ]);

      const cancelAudits = await auditRows("appointment.cancel");
      expect(cancelAudits).toHaveLength(1);
      expect(cancelAudits[0]).toMatchObject({
        actorType: "CUSTOMER",
        actorId: f.customerId,
        entityId: future.id,
        before: { status: "BOOKED", notes: null },
        after: { status: "CANCELLED", cancelReason: "ACCOUNT_DELETED", notes: null },
      });
      const deleteAudits = await auditRows("customer.delete");
      expect(deleteAudits).toHaveLength(1);
      expect(deleteAudits[0]).toMatchObject({
        actorType: "CUSTOMER",
        actorId: f.customerId,
        entity: "customer",
        entityId: f.customerId,
        before: null,
        after: { fields: ["name", "email", "phoneE164", "privateNotes"] },
      });

      const leaks = await ctx.prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM audit_log
        WHERE organization_id = ${f.orgId}::uuid
          AND (coalesce(before::text, '') LIKE ${`%${ANA_PHONE}%`} OR coalesce(after::text, '') LIKE ${`%${ANA_PHONE}%`}
            OR coalesce(before::text, '') LIKE '%Ana%' OR coalesce(after::text, '') LIKE '%Ana%'
            OR coalesce(before::text, '') LIKE '%ana@example.com%' OR coalesce(after::text, '') LIKE '%ana@example.com%')`;
      expect(Number(leaks[0]!.n)).toBe(0);

      expect(events.cancelled).toHaveBeenCalledTimes(1);
      expect(events.cancelled).toHaveBeenCalledWith(future.id);

      const refresh = await http().post("/v1/auth/refresh").set(BODY).send({ refreshToken: login.refreshToken });
      expect(refresh.status).toBe(401);
      for (const res of [
        await getMe(login.accessToken),
        await patchMe({ name: "Again" }, login.accessToken),
        await exportMe(login.accessToken),
        await deleteMe(login.accessToken),
        await http().get("/v1/me/appointments").set(auth(login.accessToken)),
        await http().post(`/v1/me/appointments/${past.id}/repeat`).set(auth(login.accessToken)),
        await http().post(`/v1/me/appointments/${future.id}/cancel`).set(auth(login.accessToken)).send({}),
      ]) {
        expect(res.status).toBe(401);
        expect(res.body.code).toBe("UNAUTHORIZED");
      }

      const fresh = await otpLogin(ANA_PHONE);
      expect(fresh.isNew).toBe(true);
      const freshMe = await getMe(fresh.accessToken);
      expect(freshMe.status).toBe(200);
      expect((freshMe.body as Me).id).not.toBe(f.customerId);
      expect((freshMe.body as Me).phoneE164).toBe(ANA_PHONE);
    });

    it("scrubs the appointment notes from earlier audit rows", async () => {
      const NOTES = "Call me at 305 555 0100, Ana";
      const slots = await http().get(`/v1/availability?services=${f.pediId}:ANY&date=${BOOKING_DATE}`);
      const slot = (slots.body as Slot[])[0]!;
      const hold = await http().post("/v1/holds").send({ segments: slot.segments });
      expect(hold.status).toBe(201);
      const booked = await http()
        .post("/v1/appointments")
        .set(auth(token))
        .send({ holdId: hold.body.holdId as string, notes: NOTES });
      expect(booked.status).toBe(201);
      const appointmentId = booked.body.id as string;
      const [createBefore] = await auditRows("appointment.create");
      expect(JSON.stringify(createBefore?.after)).toContain(NOTES);

      expect((await deleteMe()).status).toBe(204);

      const leaks = await ctx.prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM audit_log
        WHERE organization_id = ${f.orgId}::uuid
          AND (coalesce(before::text, '') LIKE '%305 555 0100%' OR coalesce(after::text, '') LIKE '%305 555 0100%')`;
      expect(Number(leaks[0]!.n)).toBe(0);

      const [createAfter] = await auditRows("appointment.create");
      expect(createAfter).toMatchObject({
        id: createBefore!.id,
        action: "appointment.create",
        entityId: appointmentId,
        actorType: "CUSTOMER",
        before: createBefore!.before,
        after: { ...(createBefore!.after as Record<string, unknown>), notes: null },
      });
      expect((createAfter!.after as { status: string }).status).toBe("BOOKED");
      const [holdAudit] = await auditRows("appointment.hold");
      expect(holdAudit?.entityId).toBe(appointmentId);
    });

    it("scrubs customer cancel reasons from appointments and audit rows", async () => {
      clock.set(Date.parse("2026-11-28T12:00:00.000Z"));
      const earlier = await bookSegment(ctx.prisma, f, { staffUserId: f.staffA, startsAt: "14:00", endsAt: "15:00" });
      const later = await bookSegment(ctx.prisma, f, { staffUserId: f.staffA, startsAt: "16:00", endsAt: "17:00" });
      const cancel = await http()
        .post(`/v1/me/appointments/${earlier.id}/cancel`)
        .set(auth(token))
        .send({ reason: "Ana's phone 3055550100 broke" });
      expect(cancel.status).toBe(200);

      expect((await deleteMe()).status).toBe(204);

      const auditLeaks = await ctx.prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM audit_log
        WHERE organization_id = ${f.orgId}::uuid
          AND (coalesce(before::text, '') LIKE '%3055550100%' OR coalesce(after::text, '') LIKE '%3055550100%')`;
      expect(Number(auditLeaks[0]!.n)).toBe(0);
      const rowLeaks = await ctx.prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM appointment a
        WHERE a.organization_id = ${f.orgId}::uuid AND a::text LIKE '%3055550100%'`;
      expect(Number(rowLeaks[0]!.n)).toBe(0);

      const earlierRow = await ctx.prisma.appointment.findUniqueOrThrow({ where: { id: earlier.id } });
      expect(earlierRow).toMatchObject({ status: "CANCELLED", cancelledBy: "CUSTOMER", cancelReason: null });
      const laterRow = await ctx.prisma.appointment.findUniqueOrThrow({ where: { id: later.id } });
      expect(laterRow).toMatchObject({ status: "CANCELLED", cancelReason: "ACCOUNT_DELETED" });

      const cancels = await auditRows("appointment.cancel");
      expect(cancels.map((a) => [a.entityId, (a.after as { cancelReason: string | null }).cancelReason])).toEqual([
        [earlier.id, null],
        [later.id, "ACCOUNT_DELETED"],
      ]);
      expect((cancels[1]!.before as { cancelReason: string | null }).cancelReason).toBeNull();
    });

    it("leaves a BOOKED appointment that already started alone", async () => {
      const started = await bookSegment(ctx.prisma, f, { staffUserId: f.staffA, startsAt: "14:00", endsAt: "15:00" });
      clock.set(Date.parse("2026-12-01T14:30:00.000Z"));
      expect((await deleteMe()).status).toBe(204);
      const row = await ctx.prisma.appointment.findUniqueOrThrow({ where: { id: started.id } });
      expect(row.status).toBe("BOOKED");
      expect(events.cancelled).not.toHaveBeenCalled();
      expect(await auditRows("appointment.cancel")).toHaveLength(0);
    });

    it("rolls everything back when a step fails", async () => {
      const { future } = await seedDeletable();
      vi.spyOn(ctx.app.get(RefreshTokenService), "revokeAllFor").mockRejectedValueOnce(new Error("boom"));
      const logged = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);

      expect((await deleteMe()).status).toBe(500);

      const customer = await ctx.prisma.customer.findUniqueOrThrow({ where: { id: f.customerId } });
      expect(customer).toMatchObject({ name: "Ana", phoneE164: ANA_PHONE, email: "ana@example.com", deletedAt: null });
      const appt = await ctx.prisma.appointment.findUniqueOrThrow({ where: { id: future.id } });
      expect(appt).toMatchObject({ status: "BOOKED", notes: `Ana ${ANA_PHONE}`, manageVersion: 0 });
      expect(await consentRows()).toHaveLength(1);
      expect(await auditRows("customer.delete")).toHaveLength(0);
      expect(await auditRows("appointment.cancel")).toHaveLength(0);
      expect(events.cancelled).not.toHaveBeenCalled();
      expect(logged).toHaveBeenCalled();
    });

    it("still answers 204 when the cancelled event fails after commit", async () => {
      const future = await bookSegment(ctx.prisma, f, { staffUserId: f.staffA, startsAt: "14:00", endsAt: "15:00" });
      events.cancelled.mockRejectedValue(new Error("adapter down"));
      const logged = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
      expect((await deleteMe()).status).toBe(204);
      expect(logged).toHaveBeenCalledWith(expect.stringContaining("adapter down"), expect.anything());
      expect((await ctx.prisma.appointment.findUniqueOrThrow({ where: { id: future.id } })).status).toBe("CANCELLED");
    });
  });
});
