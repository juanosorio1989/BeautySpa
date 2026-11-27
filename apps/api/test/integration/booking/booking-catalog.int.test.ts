import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { BookingCatalog } from "@beautyspa/contracts";
import { CLOCK } from "../../../src/common/clock.js";
import { TokenService } from "../../../src/auth/token.service.js";
import { createIntegrationApp, resetState, resetTenancyCache } from "../app.js";
import {
  BOOKING_NOW,
  fixedClock,
  seedBookingFixture,
  SEEDED_TIMES_SET_AT,
  staffSession,
  type BookingFixture,
} from "../helpers.js";

const DAY = 86_400_000;

describe("GET /staff/booking-catalog", () => {
  const clock = fixedClock(BOOKING_NOW);
  let ctx: Awaited<ReturnType<typeof createIntegrationApp>>;
  let f: BookingFixture;
  let reception: { id: string; token: string };

  const get = (token = reception.token) =>
    request(ctx.app.getHttpServer()).get("/v1/staff/booking-catalog").set("Authorization", `Bearer ${token}`);

  const book = (serviceId: string, startsAt: Date, status: "BOOKED" | "HELD" | "CANCELLED" | "COMPLETED" = "BOOKED") =>
    ctx.prisma.appointment.create({
      data: {
        organizationId: f.orgId,
        locationId: f.locationId,
        customerId: status === "HELD" ? null : f.customerId,
        status,
        source: "ONLINE",
        timesSetAt: SEEDED_TIMES_SET_AT,
        ...(status === "HELD" ? { holdExpiresAt: new Date(BOOKING_NOW + 3_600_000) } : {}),
        segments: {
          create: {
            organizationId: f.orgId,
            serviceId,
            staffUserId: f.staffA,
            startsAt,
            endsAt: new Date(startsAt.getTime() + 1_800_000),
            blockEndsAt: new Date(startsAt.getTime() + 1_800_000),
            durationMin: 30,
            priceCents: 1000,
          },
        },
      },
    });
  const ago = (days: number) => new Date(BOOKING_NOW - days * DAY);
  const newService = (en: string) =>
    ctx.prisma.service.create({
      data: { organizationId: f.orgId, name: { en, es: en }, durationMin: 30, priceCents: 1000 },
    });

  beforeAll(async () => {
    ctx = await createIntegrationApp({ override: (b) => b.overrideProvider(CLOCK).useValue(clock) });
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

  it("includes offline services and offline employees, excludes inactive services", async () => {
    await ctx.prisma.service.update({ where: { id: f.maniId }, data: { onlineBookable: false } });
    await ctx.prisma.employeeProfile.update({ where: { staffUserId: f.staffB }, data: { bookableOnline: false } });
    await newService("Hidden").then((s) => ctx.prisma.service.update({ where: { id: s.id }, data: { active: false } }));
    const res = await get();
    expect(res.status).toBe(200);
    const body = res.body as BookingCatalog;
    expect(body.services.map((s) => s.id).sort()).toEqual([f.pediId, f.maniId].sort());
    expect(body.services.find((s) => s.id === f.maniId)?.onlineBookable).toBe(false);
    expect(body.employees.map((e) => e.displayName)).toEqual(["Alex", "Blair"]);
    expect(body.employees[0]?.serviceIds.sort()).toEqual([f.pediId, f.maniId].sort());
  });

  it("orders services by category sort then name and lists categories by sort", async () => {
    const c2 = await ctx.prisma.serviceCategory.create({
      data: { organizationId: f.orgId, name: { en: "B", es: "B" }, sort: 2 },
    });
    const c1 = await ctx.prisma.serviceCategory.create({
      data: { organizationId: f.orgId, name: { en: "A", es: "A" }, sort: 1 },
    });
    await ctx.prisma.service.update({ where: { id: f.pediId }, data: { categoryId: c1.id } });
    await ctx.prisma.service.update({ where: { id: f.maniId }, data: { categoryId: c2.id } });
    const body = (await get()).body as BookingCatalog;
    expect(body.categories.map((c) => c.id)).toEqual([c1.id, c2.id]);
    expect(body.services.map((s) => s.id)).toEqual([f.pediId, f.maniId]);
  });

  it("ranks popular services by recent non-held, non-cancelled appointments, ties by English name", async () => {
    const [zed, abe, cold] = [await newService("Zed"), await newService("Abe"), await newService("Cold")];
    await book(f.maniId, ago(1));
    await book(f.maniId, ago(2));
    await book(zed.id, ago(3));
    await book(abe.id, ago(4));
    await book(f.pediId, ago(5), "COMPLETED");
    await book(cold.id, ago(6), "HELD");
    await book(cold.id, ago(7), "CANCELLED");
    await book(cold.id, ago(91)); // outside 90 days
    const body = (await get()).body as BookingCatalog;
    expect(body.popularServiceIds).toEqual([f.maniId, abe.id, f.pediId, zed.id]);
  });

  it("caps popular services at 6", async () => {
    for (let i = 0; i < 7; i += 1) await book((await newService(`S${i}`)).id, ago(1 + i));
    expect(((await get()).body as BookingCatalog).popularServiceIds).toHaveLength(6);
  });

  it("answers 403 to an EMPLOYEE", async () => {
    const token = (
      await ctx.app.get(TokenService).issueAccess({ sub: f.staffA, typ: "staff", org: f.orgId, role: "EMPLOYEE" })
    ).token;
    expect((await get(token)).status).toBe(403);
  });
});
