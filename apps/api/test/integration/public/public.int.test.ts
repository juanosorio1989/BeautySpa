import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createIntegrationApp, resetState, resetTenancyCache } from "../app.js";
import { seedFixture, staffSession, type Fixture } from "../helpers.js";

describe("public catalog reads", () => {
  let ctx: Awaited<ReturnType<typeof createIntegrationApp>>;
  let f: Fixture;
  let junior: string;
  let senior: string;
  let juniorStaff: string;
  let seniorStaff: string;

  const get = (path: string) => request(ctx.app.getHttpServer()).get(`/v1${path}`);
  const staff = async (displayName: string, levelId: string | null, serviceIds: string[], bookableOnline = true) => {
    const s = await ctx.prisma.staffUser.create({
      data: {
        organizationId: f.orgId,
        role: "EMPLOYEE",
        locale: "en",
        employeeProfile: { create: { displayName, levelId, bookableOnline } },
        staffLocations: { create: { locationId: f.locationId } },
        employeeServices: { create: serviceIds.map((serviceId) => ({ serviceId })) },
      },
    });
    return s.id;
  };

  beforeAll(async () => {
    ctx = await createIntegrationApp();
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await resetState(ctx.prisma, ctx.redis);
    resetTenancyCache(ctx.app);
    f = await seedFixture(ctx.prisma);
    junior = (
      await ctx.prisma.level.create({
        data: { organizationId: f.orgId, name: { en: "Junior", es: "Junior" }, rank: 1 },
      })
    ).id;
    senior = (
      await ctx.prisma.level.create({
        data: { organizationId: f.orgId, name: { en: "Senior", es: "Senior" }, rank: 2 },
      })
    ).id;
    await ctx.prisma.serviceLevelPrice.create({
      data: { serviceId: f.serviceId, levelId: senior, durationMin: 60, priceCents: 5500 },
    });
    juniorStaff = await staff("Zoe", junior, [f.serviceId]);
    seniorStaff = await staff("Ana", senior, [f.serviceId]);
  });

  const serviceIds = async () => ((await get("/public/services")).body.services as { id: string }[]).map((s) => s.id);

  it("lists services with the cheapest qualified price as fromPriceCents", async () => {
    const res = await get("/public/services");
    expect(res.status).toBe(200);
    expect(res.body.services).toHaveLength(1);
    expect(res.body.services[0]).toMatchObject({ id: f.serviceId, priceCents: 4000, fromPriceCents: 4000 });

    await ctx.prisma.staffUser.update({ where: { id: juniorStaff }, data: { active: false } });
    const only = await get("/public/services");
    expect(only.body.services[0]).toMatchObject({ priceCents: 4000, fromPriceCents: 5500 });
  });

  it("returns only categories that have a listed service", async () => {
    const used = await ctx.prisma.serviceCategory.create({
      data: { organizationId: f.orgId, name: { en: "Feet", es: "Pies" }, sort: 1 },
    });
    await ctx.prisma.serviceCategory.create({
      data: { organizationId: f.orgId, name: { en: "Empty", es: "Vacia" }, sort: 0 },
    });
    await ctx.prisma.service.update({ where: { id: f.serviceId }, data: { categoryId: used.id } });
    const res = await get("/public/services");
    expect(res.body.categories).toEqual([{ id: used.id, name: { en: "Feet", es: "Pies" }, sort: 1 }]);
  });

  it("hides a service whose only qualified employee is deactivated", async () => {
    await ctx.prisma.staffUser.updateMany({
      where: { id: { in: [juniorStaff, seniorStaff] } },
      data: { active: false },
    });
    expect(await serviceIds()).toEqual([]);
  });

  it("hides a service when onlineBookable is false or the service is inactive", async () => {
    await ctx.prisma.service.update({ where: { id: f.serviceId }, data: { onlineBookable: false } });
    expect(await serviceIds()).toEqual([]);
    await ctx.prisma.service.update({ where: { id: f.serviceId }, data: { onlineBookable: true, active: false } });
    expect(await serviceIds()).toEqual([]);
  });

  it.each(["Pedicure chair", "Treatment cabin"])(
    "hides a service needing a %s resource type with no active resource",
    async (name) => {
      const type = await ctx.prisma.resourceType.create({
        data: { organizationId: f.orgId, name: { en: name, es: name } },
      });
      const svc = await ctx.prisma.service.create({
        data: {
          organizationId: f.orgId,
          name: { en: "Needs room", es: "Necesita sala" },
          durationMin: 30,
          priceCents: 3000,
          resourceTypeId: type.id,
        },
      });
      await ctx.prisma.employeeService.create({ data: { staffUserId: seniorStaff, serviceId: svc.id } });
      const res = await ctx.prisma.resource.create({
        data: { organizationId: f.orgId, locationId: f.locationId, resourceTypeId: type.id, name: "R1" },
      });
      expect(await serviceIds()).toContain(svc.id);
      await ctx.prisma.resource.update({ where: { id: res.id }, data: { active: false } });
      expect(await serviceIds()).not.toContain(svc.id);
      expect(await serviceIds()).toContain(f.serviceId);
    },
  );

  it("lists bookable employees sorted by displayName with their listed services only", async () => {
    const hidden = await ctx.prisma.service.create({
      data: {
        organizationId: f.orgId,
        name: { en: "Hidden", es: "Oculto" },
        durationMin: 30,
        priceCents: 1000,
        onlineBookable: false,
      },
    });
    await ctx.prisma.employeeService.create({ data: { staffUserId: seniorStaff, serviceId: hidden.id } });
    const res = await get("/public/employees");
    expect(res.status).toBe(200);
    expect(res.body.map((e: { displayName: string }) => e.displayName)).toEqual(["Ana", "Zoe"]);
    expect(res.body[0]).toMatchObject({ id: seniorStaff, level: { id: senior, rank: 2 }, serviceIds: [f.serviceId] });
  });

  it("hides employees with bookableOnline false or inactive", async () => {
    await ctx.prisma.employeeProfile.update({ where: { staffUserId: juniorStaff }, data: { bookableOnline: false } });
    let names = (await get("/public/employees")).body.map((e: { displayName: string }) => e.displayName);
    expect(names).toEqual(["Ana"]);
    await ctx.prisma.staffUser.update({ where: { id: seniorStaff }, data: { active: false } });
    names = (await get("/public/employees")).body;
    expect(names).toEqual([]);
  });

  it("lists locations sorted by name with hours, a midnight close as 24:00, no token needed", async () => {
    await ctx.prisma.location.create({
      data: { organizationId: f.orgId, name: "Aaa", timezone: "America/New_York", settings: {} },
    });
    await ctx.prisma.locationHours.create({
      data: {
        locationId: f.locationId,
        weekday: 1,
        opens: new Date("1970-01-01T09:00:00.000Z"),
        closes: new Date("1970-01-01T00:00:00.000Z"),
      },
    });
    const res = await get("/public/locations");
    expect(res.status).toBe(200);
    expect(res.body.map((l: { name: string }) => l.name)).toEqual(["Aaa", "Main"]);
    expect(res.body[1].hours).toEqual([{ weekday: 1, start: "09:00", end: "24:00" }]);
  });

  it("exposes booking settings: defaults, then stored values", async () => {
    const defaults = { bookingHorizonDays: 60, cancelWindowHours: 24, holdMinutes: 5 };
    expect((await get("/public/locations")).body[0].booking).toEqual(defaults);
    const owner = await staffSession(ctx.app, ctx.prisma, f, "OWNER");
    const stored = { bookingHorizonDays: 30, cancelWindowHours: 12, holdMinutes: 7 };
    const patch = await request(ctx.app.getHttpServer())
      .patch("/v1/staff/settings")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ settings: stored });
    expect(patch.status).toBe(200);
    expect((await get("/public/locations")).body[0].booking).toEqual(stored);
  });

  it.each(["/public/services", "/public/employees"])("rejects a non-UUID locationId on %s with 400", async (path) => {
    expect((await get(`${path}?locationId=nope`)).status).toBe(400);
  });

  it("requires locationId when the organization has several locations", async () => {
    await ctx.prisma.location.create({
      data: { organizationId: f.orgId, name: "Second", timezone: "America/New_York", settings: {} },
    });
    expect((await get("/public/services")).status).toBe(400);
    expect((await get(`/public/services?locationId=${f.locationId}`)).status).toBe(200);
    expect((await get(`/public/employees?locationId=${f.locationId}`)).status).toBe(200);
  });
});
