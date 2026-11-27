import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { StaffCustomer, StaffCustomerAppointments, StaffCustomerSearchResult } from "@beautyspa/contracts";
import { CLOCK } from "../../../src/common/clock.js";
import { TokenService } from "../../../src/auth/token.service.js";
import { createIntegrationApp, resetState, resetTenancyCache } from "../app.js";
import {
  BOOKING_NOW,
  bookSegment,
  fixedClock,
  seedBookingFixture,
  SEEDED_TIMES_SET_AT,
  staffSession,
  type BookingFixture,
} from "../helpers.js";

describe("staff customers", () => {
  let ctx: Awaited<ReturnType<typeof createIntegrationApp>>;
  let f: BookingFixture;
  let reception: { id: string; token: string };

  const http = () => request(ctx.app.getHttpServer());
  const search = (q: string, bearer = reception.token) =>
    http().get("/v1/staff/customers").query({ q }).set("Authorization", `Bearer ${bearer}`);
  const create = (body: Record<string, unknown>, bearer = reception.token) =>
    http().post("/v1/staff/customers").set("Authorization", `Bearer ${bearer}`).send(body);
  const employeeToken = async (staffUserId: string) =>
    (await ctx.app.get(TokenService).issueAccess({ sub: staffUserId, typ: "staff", org: f.orgId, role: "EMPLOYEE" }))
      .token;

  beforeAll(async () => {
    ctx = await createIntegrationApp({ override: (b) => b.overrideProvider(CLOCK).useValue(fixedClock(BOOKING_NOW)) });
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await resetState(ctx.prisma, ctx.redis);
    resetTenancyCache(ctx.app);
    f = await seedBookingFixture(ctx.prisma);
    reception = await staffSession(ctx.app, ctx.prisma, f, "RECEPTION");
  });

  describe("GET /staff/customers", () => {
    it("finds by name and by phone digits", async () => {
      const byName = await search("an");
      expect(byName.status).toBe(200);
      const list = byName.body as StaffCustomer[];
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({
        id: f.customerId,
        name: "Ana",
        phoneE164: "+13055550100",
        consents: { WHATSAPP: false, SMS: false, EMAIL: false, PUSH: false },
      });
      const byPhone = await search("5550100");
      expect((byPhone.body as StaffCustomer[]).map((c) => c.id)).toEqual([f.customerId]);
    });

    it("rejects a one-character query with 400", async () => {
      expect((await search("a")).status).toBe(400);
    });

    it("never returns a soft-deleted customer", async () => {
      await ctx.prisma.customer.update({ where: { id: f.customerId }, data: { deletedAt: new Date() } });
      expect((await search("an")).body).toEqual([]);
    });

    it("limits an EMPLOYEE to customers they served (non-HELD)", async () => {
      const other = await ctx.prisma.customer.create({
        data: { organizationId: f.orgId, phoneE164: "+13055550101", name: "Anna", locale: "en", createdVia: "ONLINE" },
      });
      await bookSegment(ctx.prisma, f, { staffUserId: f.staffA, startsAt: "15:00", endsAt: "16:00" });
      const heldByA = await ctx.prisma.appointment.create({
        data: {
          organizationId: f.orgId,
          locationId: f.locationId,
          customerId: other.id,
          status: "HELD",
          source: "ONLINE",
          timesSetAt: SEEDED_TIMES_SET_AT,
          holdExpiresAt: new Date(Date.now() + 3_600_000),
          segments: {
            create: {
              organizationId: f.orgId,
              serviceId: f.serviceId,
              staffUserId: f.staffA,
              startsAt: new Date("2026-12-01T17:00:00.000Z"),
              endsAt: new Date("2026-12-01T18:00:00.000Z"),
              blockEndsAt: new Date("2026-12-01T18:00:00.000Z"),
              durationMin: 60,
              priceCents: 4000,
            },
          },
        },
      });
      expect(heldByA.id).toBeTruthy();
      const asA = await search("an", await employeeToken(f.staffA));
      expect((asA.body as StaffCustomer[]).map((c) => c.id)).toEqual([f.customerId]);
      const asB = await search("an", await employeeToken(f.staffB));
      expect(asB.body).toEqual([]);
      const asReception = await search("an");
      expect((asReception.body as StaffCustomer[]).map((c) => c.name)).toEqual(["Ana", "Anna"]);
    });
  });

  describe("last visit in search", () => {
    const visit = (
      customerId: string,
      status: "COMPLETED" | "CANCELLED" | "CHECKED_IN",
      startsAt: string,
      serviceIds: string[],
    ) =>
      ctx.prisma.appointment.create({
        data: {
          organizationId: f.orgId,
          locationId: f.locationId,
          customerId,
          status,
          source: "RECEPTION",
          timesSetAt: SEEDED_TIMES_SET_AT,
          segments: {
            create: serviceIds.map((serviceId, i) => {
              const start = new Date(Date.parse(startsAt) + i * 3_600_000);
              return {
                organizationId: f.orgId,
                serviceId,
                staffUserId: f.staffA,
                startsAt: start,
                endsAt: new Date(start.getTime() + 1_800_000),
                blockEndsAt: new Date(start.getTime() + 1_800_000),
                durationMin: 30,
                priceCents: 2500,
                occupies: false,
              };
            }),
          },
        },
      });

    it("returns the latest completed visit in the location timezone and null with only a cancelled one", async () => {
      const other = await ctx.prisma.customer.create({
        data: { organizationId: f.orgId, phoneE164: "+13055550101", name: "Anna", locale: "en", createdVia: "ONLINE" },
      });
      await visit(f.customerId, "COMPLETED", "2026-11-10T15:00:00.000Z", [f.pediId]);
      // 2026-11-21 02:30 UTC = 2026-11-20 21:30 in New York
      await visit(f.customerId, "COMPLETED", "2026-11-21T02:30:00.000Z", [f.maniId, f.pediId]);
      await visit(other.id, "CANCELLED", "2026-11-12T15:00:00.000Z", [f.pediId]);
      const res = await search("an");
      const list = res.body as StaffCustomerSearchResult[];
      expect(list.map((c) => c.name)).toEqual(["Ana", "Anna"]);
      expect(list[0]!.lastVisit).toEqual({ date: "2026-11-20", serviceIds: [f.maniId, f.pediId] });
      expect(list[1]!.lastVisit).toBeNull();
    });
  });

  describe("GET /staff/customers/:id", () => {
    const detail = (id: string, bearer = reception.token) =>
      http().get(`/v1/staff/customers/${id}`).set("Authorization", `Bearer ${bearer}`);

    it("returns the customer", async () => {
      const res = await detail(f.customerId);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: f.customerId, name: "Ana", consents: { EMAIL: false } });
    });

    it("answers 404 for a deleted, other-org or unknown id", async () => {
      const otherOrg = await ctx.prisma.organization.create({
        data: { name: "Other", slug: "other-org", defaultLocale: "en" },
      });
      const foreign = await ctx.prisma.customer.create({
        data: {
          organizationId: otherOrg.id,
          phoneE164: "+13055550177",
          name: "Zed",
          locale: "en",
          createdVia: "ONLINE",
        },
      });
      expect((await detail(foreign.id)).status).toBe(404);
      await ctx.prisma.customer.update({ where: { id: f.customerId }, data: { deletedAt: new Date() } });
      expect((await detail(f.customerId)).status).toBe(404);
    });

    it("answers 403 for an EMPLOYEE", async () => {
      expect((await detail(f.customerId, await employeeToken(f.staffA))).status).toBe(403);
    });
  });

  describe("GET /staff/customers/:id/appointments", () => {
    const list = (id: string, bearer = reception.token) =>
      http().get(`/v1/staff/customers/${id}/appointments`).set("Authorization", `Bearer ${bearer}`);

    it("splits upcoming and past, caps past at 20 newest and keeps staff cancel reasons", async () => {
      await bookSegment(ctx.prisma, f, { staffUserId: f.staffA, startsAt: "15:00", endsAt: "16:00" });
      const base = Date.parse("2026-11-01T15:00:00.000Z");
      for (let i = 0; i < 25; i++) {
        const start = new Date(base + (i * 86_400_000) / 2);
        await ctx.prisma.appointment.create({
          data: {
            organizationId: f.orgId,
            locationId: f.locationId,
            customerId: f.customerId,
            status: i === 24 ? "CANCELLED" : "COMPLETED",
            source: "RECEPTION",
            timesSetAt: SEEDED_TIMES_SET_AT,
            ...(i === 24 ? { cancelledAt: start, cancelledBy: "STAFF" as const, cancelReason: "Sick" } : {}),
            segments: {
              create: {
                organizationId: f.orgId,
                serviceId: f.serviceId,
                staffUserId: f.staffA,
                startsAt: start,
                endsAt: new Date(start.getTime() + 3_600_000),
                blockEndsAt: new Date(start.getTime() + 3_600_000),
                durationMin: 60,
                priceCents: 4000,
                occupies: false,
              },
            },
          },
        });
      }
      const res = await list(f.customerId);
      expect(res.status).toBe(200);
      const body = res.body as StaffCustomerAppointments;
      expect(body.upcoming).toHaveLength(1);
      expect(body.past).toHaveLength(20);
      expect(body.past[0]!.cancelReason).toBe("Sick");
      expect(body.past[0]!.cancelledBy).toBe("STAFF");
      const starts = body.past.map((a) => a.startsAt);
      expect([...starts].sort().reverse()).toEqual(starts);
      expect(body.past[0]!.customer).toMatchObject({ id: f.customerId, reachable: false });
    });

    it("answers 404 for another organization's customer and 403 for an EMPLOYEE", async () => {
      const otherOrg = await ctx.prisma.organization.create({
        data: { name: "Other", slug: "other-org", defaultLocale: "en" },
      });
      const foreign = await ctx.prisma.customer.create({
        data: {
          organizationId: otherOrg.id,
          phoneE164: "+13055550177",
          name: "Zed",
          locale: "en",
          createdVia: "ONLINE",
        },
      });
      expect((await list(foreign.id)).status).toBe(404);
      expect((await list(f.customerId, await employeeToken(f.staffA))).status).toBe(403);
    });
  });

  describe("POST /staff/customers", () => {
    const body = { name: "Bea Ruiz", phone: "+13055550199", locale: "en", consents: { WHATSAPP: true } };

    it("creates the customer, records consent and an audit row without personal data", async () => {
      const res = await create({ ...body, email: "bea@example.com" });
      expect(res.status).toBe(201);
      const dto = res.body as StaffCustomer;
      expect(dto).toMatchObject({
        name: "Bea Ruiz",
        phoneE164: "+13055550199",
        email: "bea@example.com",
        locale: "en",
        consents: { WHATSAPP: true, SMS: false, EMAIL: false, PUSH: false },
      });
      const row = await ctx.prisma.customer.findUniqueOrThrow({ where: { id: dto.id } });
      expect(row.createdVia).toBe("RECEPTION");
      expect(row.phoneVerifiedAt).toBeNull();
      const consents = await ctx.prisma.notificationConsent.findMany({ where: { customerId: dto.id } });
      expect(consents).toHaveLength(1);
      expect(consents[0]).toMatchObject({ channel: "WHATSAPP", granted: true, source: "RECEPTION" });
      const audit = await ctx.prisma.auditLog.findMany({ where: { action: "customer.create" } });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        entity: "customer",
        entityId: dto.id,
        actorType: "STAFF",
        actorId: reception.id,
      });
      expect(audit[0]!.before).toBeNull();
      const text = JSON.stringify(audit[0]!.after);
      expect(text).not.toContain("Bea");
      expect(text).not.toContain("5550199");
      expect(text).not.toContain("example.com");
      expect((audit[0]!.after as { fields: string[] }).fields).toEqual(
        expect.arrayContaining(["name", "phone", "locale", "email", "consents"]),
      );
    });

    it("answers 409 CONFLICT for a duplicate phone", async () => {
      const res = await create({ ...body, phone: "+13055550100" });
      expect(res.status).toBe(409);
      expect((res.body as { code: string }).code).toBe("CONFLICT");
    });

    it("forbids an EMPLOYEE", async () => {
      expect((await create(body, await employeeToken(f.staffA))).status).toBe(403);
    });
  });
});
