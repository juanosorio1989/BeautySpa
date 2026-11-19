import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createIntegrationApp, resetState, resetTenancyCache } from "./app.js";
import { seedFixture, staffSession, type Fixture } from "./helpers.js";

describe("GET /staff/audit", () => {
  let ctx: Awaited<ReturnType<typeof createIntegrationApp>>;
  let f: Fixture;
  let owner: { id: string; token: string };
  let categoryIds: string[];

  const audit = (qs: string, token = owner.token) =>
    request(ctx.app.getHttpServer()).get(`/v1/staff/audit${qs}`).set("Authorization", `Bearer ${token}`);

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
    categoryIds = [];
    for (const n of [1, 2, 3]) {
      const res = await request(ctx.app.getHttpServer())
        .post("/v1/staff/categories")
        .set("Authorization", `Bearer ${owner.token}`)
        .send({ name: { en: `Cat ${n}`, es: `Cat ${n}` }, sort: n });
      expect(res.status).toBe(201);
      categoryIds.push(res.body.id);
    }
  });

  it("pages newest first by id with a cursor", async () => {
    // Expected order comes from ids, not timestamps, which may tie.
    const expected = (await ctx.prisma.auditLog.findMany({ where: { organizationId: f.orgId }, select: { id: true } }))
      .map((r) => r.id)
      .sort()
      .reverse();
    expect(expected).toHaveLength(3);

    const p1 = await audit("?limit=2");
    expect(p1.status).toBe(200);
    expect(p1.body.items.map((i: { id: string }) => i.id)).toEqual(expected.slice(0, 2));
    expect(p1.body.nextCursor).toBe(expected[1]);
    expect(p1.body.items[0]).toMatchObject({
      action: "service_category.create",
      entity: "service_category",
      actorType: "STAFF",
      actorId: owner.id,
      before: null,
    });

    const p2 = await audit(`?limit=2&cursor=${p1.body.nextCursor}`);
    expect(p2.body.items.map((i: { id: string }) => i.id)).toEqual([expected[2]]);
    expect(p2.body.nextCursor).toBeNull();
  });

  it("filters by entity and id", async () => {
    const res = await audit(`?entity=service_category&id=${categoryIds[1]}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ entity: "service_category", entityId: categoryIds[1] });
    expect((await audit("?entity=service")).body.items).toEqual([]);
  });

  it("does not show another organization's entries", async () => {
    const other = await ctx.prisma.organization.create({ data: { name: "Other", slug: "other", defaultLocale: "en" } });
    await ctx.prisma.auditLog.create({
      data: { organizationId: other.id, actorType: "SYSTEM", action: "x.create", entity: "x" },
    });
    expect((await audit("")).body.items).toHaveLength(3);
  });

  it("rejects an invalid limit with 400 and RECEPTION/EMPLOYEE with 403", async () => {
    expect((await audit("?limit=0")).status).toBe(400);
    expect((await audit("?cursor=not-a-uuid")).status).toBe(400);
    const reception = await staffSession(ctx.app, ctx.prisma, f, "RECEPTION");
    expect((await audit("", reception.token)).status).toBe(403);
    const employee = await staffSession(ctx.app, ctx.prisma, f, "EMPLOYEE");
    expect((await audit("", employee.token)).status).toBe(403);
  });
});
