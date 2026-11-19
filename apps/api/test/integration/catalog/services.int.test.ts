import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createIntegrationApp, resetState, resetTenancyCache } from "../app.js";
import { seedFixture, staffSession, type Fixture } from "../helpers.js";

describe("services with level prices", () => {
  let ctx: Awaited<ReturnType<typeof createIntegrationApp>>;
  let f: Fixture;
  let owner: { id: string; token: string };
  let junior: string;
  let senior: string;

  const api = (method: "get" | "post" | "patch" | "delete", path: string, token = owner.token) =>
    request(ctx.app.getHttpServer())[method](`/v1${path}`).set("Authorization", `Bearer ${token}`);

  const body = (over: Record<string, unknown> = {}) => ({
    categoryId: null,
    name: { en: "Manicure", es: "Manicura" },
    durationMin: 45,
    priceCents: 3500,
    ...over,
  });

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
    owner = await staffSession(ctx.app, ctx.prisma, f, "OWNER");
    // Created in reverse rank order so sorting by rank is observable.
    senior = (await ctx.prisma.level.create({ data: { organizationId: f.orgId, name: { en: "Senior", es: "Senior" }, rank: 2 } })).id;
    junior = (await ctx.prisma.level.create({ data: { organizationId: f.orgId, name: { en: "Junior", es: "Junior" }, rank: 1 } })).id;
  });

  it("creates with two level prices and returns them sorted by level rank", async () => {
    const res = await api("post", "/staff/services").send(
      body({
        levelPrices: [
          { levelId: senior, durationMin: 40, priceCents: 5000 },
          { levelId: junior, durationMin: 50, priceCents: 3000 },
        ],
      }),
    );
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: { en: "Manicure", es: "Manicura" },
      description: null,
      bufferAfterMin: 0,
      parallelizable: false,
      onlineBookable: true,
      active: true,
    });
    const got = await api("get", `/staff/services/${res.body.id}`);
    expect(got.status).toBe(200);
    expect(got.body.levelPrices).toEqual([
      { levelId: junior, durationMin: 50, priceCents: 3000 },
      { levelId: senior, durationMin: 40, priceCents: 5000 },
    ]);
    const audit = await ctx.prisma.auditLog.findFirst({ where: { action: "service.create", entityId: res.body.id } });
    expect(audit).toMatchObject({ entity: "service", actorId: owner.id, organizationId: f.orgId });
    expect((audit?.after as { levelPrices: unknown[] }).levelPrices).toHaveLength(2);
  });

  it("PATCH levelPrices replaces all rows; an empty array removes them; other fields keep them", async () => {
    const created = await api("post", "/staff/services").send(
      body({ levelPrices: [{ levelId: junior, durationMin: 50, priceCents: 3000 }] }),
    );
    const id = created.body.id;

    const described = await api("patch", `/staff/services/${id}`).send({ description: { en: "Nice", es: "Bonito" } });
    expect(described.body.description).toEqual({ en: "Nice", es: "Bonito" });
    const undescribed = await api("patch", `/staff/services/${id}`).send({ description: null });
    expect(undescribed.body.description).toBeNull();

    const priced = await api("patch", `/staff/services/${id}`).send({ priceCents: 4500 });
    expect(priced.status).toBe(200);
    expect(priced.body.priceCents).toBe(4500);
    expect(priced.body.levelPrices).toHaveLength(1);
    const audit = await ctx.prisma.auditLog.findFirst({ where: { action: "service.update", entityId: id }, orderBy: { at: "desc" } });
    expect((audit?.before as { priceCents: number }).priceCents).toBe(3500);
    expect((audit?.after as { priceCents: number }).priceCents).toBe(4500);

    const replaced = await api("patch", `/staff/services/${id}`).send({
      levelPrices: [{ levelId: senior, durationMin: 40, priceCents: 5000 }],
    });
    expect(replaced.body.levelPrices).toEqual([{ levelId: senior, durationMin: 40, priceCents: 5000 }]);

    const cleared = await api("patch", `/staff/services/${id}`).send({ levelPrices: [] });
    expect(cleared.status).toBe(200);
    expect(cleared.body.levelPrices).toEqual([]);
    expect(await ctx.prisma.serviceLevelPrice.count({ where: { serviceId: id } })).toBe(0);
  });

  it("rejects unknown or other-org references with 400 on the field path", async () => {
    const other = await ctx.prisma.organization.create({ data: { name: "Other", slug: "other", defaultLocale: "en" } });
    const cat = await ctx.prisma.serviceCategory.create({ data: { organizationId: other.id, name: { en: "X", es: "X" } } });
    const rt = await ctx.prisma.resourceType.create({ data: { organizationId: other.id, name: { en: "X", es: "X" } } });
    const lvl = await ctx.prisma.level.create({ data: { organizationId: other.id, name: { en: "X", es: "X" }, rank: 1 } });

    const a = await api("post", "/staff/services").send(body({ categoryId: cat.id }));
    expect(a.status).toBe(400);
    expect(a.body.errors[0].path).toBe("categoryId");
    const b = await api("post", "/staff/services").send(body({ resourceTypeId: rt.id }));
    expect(b.status).toBe(400);
    expect(b.body.errors[0].path).toBe("resourceTypeId");
    const c = await api("post", "/staff/services").send(
      body({ levelPrices: [{ levelId: lvl.id, durationMin: 30, priceCents: 1000 }] }),
    );
    expect(c.status).toBe(400);
    expect(c.body.errors[0].path).toBe("levelPrices.0.levelId");

    const ok = await api("post", "/staff/services").send(body());
    const d = await api("patch", `/staff/services/${ok.body.id}`).send({ categoryId: cat.id });
    expect(d.status).toBe(400);
    expect(d.body.errors[0].path).toBe("categoryId");
    expect(await ctx.prisma.service.count({ where: { organizationId: f.orgId } })).toBe(2);
  });

  it("rejects durationMin 0 with 400", async () => {
    const res = await api("post", "/staff/services").send(body({ durationMin: 0 }));
    expect(res.status).toBe(400);
  });

  it("lists by category sort (uncategorized last) then name.en, and filters by active and categoryId", async () => {
    const c1 = await ctx.prisma.serviceCategory.create({ data: { organizationId: f.orgId, name: { en: "Hands", es: "Manos" }, sort: 2 } });
    const c0 = await ctx.prisma.serviceCategory.create({ data: { organizationId: f.orgId, name: { en: "Face", es: "Cara" }, sort: 1 } });
    const mk = (en: string, categoryId: string | null, active = true) =>
      api("post", "/staff/services").send(body({ name: { en, es: en }, categoryId, active }));
    await mk("Zed", c0.id);
    await mk("Alpha", c1.id);
    await mk("Beta", c1.id, false);
    await mk("Aaa", c0.id);

    const all = await api("get", "/staff/services");
    expect(all.body.map((s: { name: { en: string } }) => s.name.en)).toEqual([
      "Aaa",
      "Zed",
      "Alpha",
      "Beta",
      "Pedicure",
    ]);
    const inactive = await api("get", "/staff/services?active=false");
    expect(inactive.body.map((s: { name: { en: string } }) => s.name.en)).toEqual(["Beta"]);
    const active = await api("get", "/staff/services?active=true");
    expect(active.body).toHaveLength(4);
    const byCat = await api("get", `/staff/services?categoryId=${c1.id}`);
    expect(byCat.body.map((s: { name: { en: string } }) => s.name.en)).toEqual(["Alpha", "Beta"]);
    expect((await api("get", "/staff/services?active=maybe")).status).toBe(400);
  });

  it("answers 404 for an unknown or other-org id, 400 for a non-UUID and has no DELETE", async () => {
    expect((await api("get", "/staff/services/00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await api("patch", "/staff/services/00000000-0000-4000-8000-000000000000").send({ priceCents: 1 })).status).toBe(404);
    expect((await api("get", "/staff/services/nope")).status).toBe(400);
    expect((await api("delete", `/staff/services/${f.serviceId}`)).status).toBe(404);
  });

  it("answers 403 for RECEPTION and EMPLOYEE", async () => {
    for (const role of ["RECEPTION", "EMPLOYEE"] as const) {
      const s = await staffSession(ctx.app, ctx.prisma, f, role);
      expect((await api("get", "/staff/services", s.token)).status).toBe(403);
      expect((await api("post", "/staff/services", s.token).send(body())).status).toBe(403);
    }
  });
});
