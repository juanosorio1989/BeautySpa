import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TenancyService } from "../../../src/tenancy/tenancy.service.js";
import { createIntegrationApp, resetState } from "../app.js";
import { seedFixture, staffSession, type Fixture } from "../helpers.js";

describe("catalog simple CRUD (categories, levels, resource types, resources)", () => {
  let ctx: Awaited<ReturnType<typeof createIntegrationApp>>;
  let f: Fixture;
  let owner: { id: string; token: string };

  const api = (method: "get" | "post" | "patch" | "delete", path: string, token = owner.token) =>
    request(ctx.app.getHttpServer())[method](`/v1${path}`).set("Authorization", `Bearer ${token}`);

  beforeAll(async () => {
    ctx = await createIntegrationApp();
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await resetState(ctx.prisma, ctx.redis);
    // TenancyService caches the org id; the fixture org is recreated for every test.
    (ctx.app.get(TenancyService) as unknown as { orgId?: string }).orgId = undefined;
    f = await seedFixture(ctx.prisma);
    owner = await staffSession(ctx.app, ctx.prisma, f, "OWNER");
  });

  const otherOrg = async () => {
    const org = await ctx.prisma.organization.create({ data: { name: "Other", slug: "other", defaultLocale: "en" } });
    const rt = await ctx.prisma.resourceType.create({ data: { organizationId: org.id, name: { en: "X", es: "X" } } });
    const cat = await ctx.prisma.serviceCategory.create({ data: { organizationId: org.id, name: { en: "X", es: "X" } } });
    return { org, rt, cat };
  };

  describe("categories", () => {
    it("creates, lists sorted, updates, deletes and audits", async () => {
      const b = await api("post", "/staff/categories").send({ name: { en: "Beta", es: "Beta" } });
      expect(b.status).toBe(201);
      expect(b.body).toMatchObject({ name: { en: "Beta", es: "Beta" }, sort: 0 });
      expect(typeof b.body.id).toBe("string");
      const a = await api("post", "/staff/categories").send({ name: { en: "Alpha", es: "Alfa" } });
      const c = await api("post", "/staff/categories").send({ name: { en: "Early", es: "Temprano" }, sort: 1 });

      const list = await api("get", "/staff/categories");
      expect(list.status).toBe(200);
      expect(list.body.map((x: { name: { en: string } }) => x.name.en)).toEqual(["Alpha", "Beta", "Early"]);

      const patched = await api("patch", `/staff/categories/${a.body.id}`).send({ sort: 5 });
      expect(patched.status).toBe(200);
      expect(patched.body.sort).toBe(5);
      expect(c.status).toBe(201);

      const del = await api("delete", `/staff/categories/${b.body.id}`);
      expect(del.status).toBe(204);
      expect((await api("get", `/staff/categories/${b.body.id}`)).status).toBe(404);

      const created = await ctx.prisma.auditLog.findFirst({ where: { action: "service_category.create", entityId: b.body.id } });
      expect((created?.after as { name: { en: string } }).name.en).toBe("Beta");
      expect(created).toMatchObject({ actorType: "STAFF", actorId: owner.id, entity: "service_category", organizationId: f.orgId });
      const deleted = await ctx.prisma.auditLog.findFirst({ where: { action: "service_category.delete", entityId: b.body.id } });
      expect(deleted?.before).toMatchObject({ id: b.body.id });
      const updated = await ctx.prisma.auditLog.findFirst({ where: { action: "service_category.update", entityId: a.body.id } });
      expect(updated?.before).toMatchObject({ sort: 0 });
      expect(updated?.after).toMatchObject({ sort: 5 });
    });

    it("deleting a category clears categoryId on its services", async () => {
      const cat = await ctx.prisma.serviceCategory.create({ data: { organizationId: f.orgId, name: { en: "C", es: "C" } } });
      await ctx.prisma.service.update({ where: { id: f.serviceId }, data: { categoryId: cat.id } });
      expect((await api("delete", `/staff/categories/${cat.id}`)).status).toBe(204);
      expect((await ctx.prisma.service.findUniqueOrThrow({ where: { id: f.serviceId } })).categoryId).toBeNull();
    });

    it("answers 404 for another org's id and 400 for a malformed id", async () => {
      const o = await otherOrg();
      expect((await api("get", `/staff/categories/${o.cat.id}`)).status).toBe(404);
      expect((await api("patch", `/staff/categories/${o.cat.id}`).send({ sort: 1 })).status).toBe(404);
      expect((await api("delete", `/staff/categories/${o.cat.id}`)).status).toBe(404);
      expect((await api("get", "/staff/categories/not-a-uuid")).status).toBe(400);
    });

    it("rejects an empty update with 400", async () => {
      const a = await api("post", "/staff/categories").send({ name: { en: "A", es: "A" } });
      expect((await api("patch", `/staff/categories/${a.body.id}`).send({})).status).toBe(400);
    });
  });

  describe("levels", () => {
    it("round trips and sorts by rank", async () => {
      const senior = await api("post", "/staff/levels").send({ name: { en: "Senior", es: "Senior" }, rank: 2 });
      expect(senior.status).toBe(201);
      await api("post", "/staff/levels").send({ name: { en: "Junior", es: "Junior" }, rank: 1 });
      const list = await api("get", "/staff/levels");
      expect(list.body.map((x: { rank: number }) => x.rank)).toEqual([1, 2]);
      const patched = await api("patch", `/staff/levels/${senior.body.id}`).send({ rank: 3 });
      expect(patched.body.rank).toBe(3);
      expect((await api("delete", `/staff/levels/${senior.body.id}`)).status).toBe(204);
      expect((await api("get", `/staff/levels/${senior.body.id}`)).status).toBe(404);
      expect(await ctx.prisma.auditLog.count({ where: { entity: "level" } })).toBe(4);
    });

    it("deleting a level removes its prices and clears employee levels", async () => {
      const level = await ctx.prisma.level.create({ data: { organizationId: f.orgId, name: { en: "L", es: "L" }, rank: 1 } });
      await ctx.prisma.serviceLevelPrice.create({ data: { serviceId: f.serviceId, levelId: level.id, durationMin: 30, priceCents: 100 } });
      await ctx.prisma.employeeProfile.create({ data: { staffUserId: f.staffA, levelId: level.id, displayName: "A" } });
      expect((await api("delete", `/staff/levels/${level.id}`)).status).toBe(204);
      expect(await ctx.prisma.serviceLevelPrice.count({ where: { levelId: level.id } })).toBe(0);
      expect((await ctx.prisma.employeeProfile.findUniqueOrThrow({ where: { staffUserId: f.staffA } })).levelId).toBeNull();
    });
  });

  describe("resource types", () => {
    it("round trips and sorts by English name", async () => {
      const b = await api("post", "/staff/resource-types").send({ name: { en: "Zeta", es: "Zeta" } });
      expect(b.status).toBe(201);
      const list = await api("get", "/staff/resource-types");
      expect(list.body.map((x: { name: { en: string } }) => x.name.en)).toEqual(["Pedicure chair", "Zeta"]);
      const patched = await api("patch", `/staff/resource-types/${b.body.id}`).send({ name: { en: "Eta", es: "Eta" } });
      expect(patched.body.name.en).toBe("Eta");
      expect((await api("delete", `/staff/resource-types/${b.body.id}`)).status).toBe(204);
      expect((await api("get", `/staff/resource-types/${b.body.id}`)).status).toBe(404);
    });

    it("answers 409 CONFLICT when a service or resource still uses it (real FK RESTRICT)", async () => {
      const res = await api("delete", `/staff/resource-types/${f.resourceTypeId}`);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("CONFLICT");
      expect(await ctx.prisma.resourceType.count({ where: { id: f.resourceTypeId } })).toBe(1);
      expect(await ctx.prisma.auditLog.count({ where: { action: "resource_type.delete" } })).toBe(0);

      // Only a resource references it (service removed): still blocked.
      await ctx.prisma.service.delete({ where: { id: f.serviceId } });
      expect((await api("delete", `/staff/resource-types/${f.resourceTypeId}`)).status).toBe(409);
    });
  });

  describe("resources", () => {
    it("creates on the only location, updates and has no DELETE route", async () => {
      const created = await api("post", "/staff/resources").send({ resourceTypeId: f.resourceTypeId, name: "Chair 3" });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ locationId: f.locationId, resourceTypeId: f.resourceTypeId, name: "Chair 3", active: true });

      const patched = await api("patch", `/staff/resources/${created.body.id}`).send({ active: false });
      expect(patched.status).toBe(200);
      expect(patched.body.active).toBe(false);

      const list = await api("get", `/staff/resources?locationId=${f.locationId}`);
      expect(list.body.map((x: { name: string }) => x.name)).toEqual(["Chair 1", "Chair 2", "Chair 3"]);
      expect((await api("get", `/staff/resources/${created.body.id}`)).status).toBe(200);

      expect((await api("delete", `/staff/resources/${created.body.id}`)).status).toBe(404);
      const audit = await ctx.prisma.auditLog.findMany({ where: { entity: "resource" }, orderBy: { at: "asc" } });
      expect(audit.map((a) => a.action)).toEqual(["resource.create", "resource.update"]);
    });

    it("rejects another org's resourceTypeId with 400 on resourceTypeId", async () => {
      const o = await otherOrg();
      const res = await api("post", "/staff/resources").send({ resourceTypeId: o.rt.id, name: "X" });
      expect(res.status).toBe(400);
      expect(res.body.errors[0].path).toBe("resourceTypeId");
      const patch = await api("patch", `/staff/resources/${f.resource1}`).send({ resourceTypeId: o.rt.id });
      expect(patch.status).toBe(400);
    });

    it("answers 404 for another org's location and 400 for a malformed locationId", async () => {
      const o = await otherOrg();
      const loc = await ctx.prisma.location.create({
        data: { organizationId: o.org.id, name: "Elsewhere", timezone: "Europe/Madrid", settings: {} },
      });
      const res = await api("post", "/staff/resources").send({ resourceTypeId: f.resourceTypeId, name: "X", locationId: loc.id });
      expect(res.status).toBe(404);
      expect((await api("get", "/staff/resources?locationId=nope")).status).toBe(400);
    });
  });

  describe("access", () => {
    it("answers 403 for RECEPTION and EMPLOYEE, 401 without a token", async () => {
      for (const role of ["RECEPTION", "EMPLOYEE"] as const) {
        const s = await staffSession(ctx.app, ctx.prisma, f, role);
        expect((await api("get", "/staff/categories", s.token)).status).toBe(403);
        expect(
          (await api("post", "/staff/resources", s.token).send({ resourceTypeId: f.resourceTypeId, name: "X" })).status,
        ).toBe(403);
      }
      expect((await request(ctx.app.getHttpServer()).get("/v1/staff/categories")).status).toBe(401);
    });
  });
});
