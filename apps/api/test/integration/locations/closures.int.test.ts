import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createIntegrationApp, resetState, resetTenancyCache } from "../app.js";
import { seedFixture, staffSession, type Fixture } from "../helpers.js";

describe("location closures", () => {
  let ctx: Awaited<ReturnType<typeof createIntegrationApp>>;
  let f: Fixture;
  let owner: { id: string; token: string };

  const api = (method: "get" | "post" | "patch" | "delete", path: string, token = owner.token) =>
    request(ctx.app.getHttpServer())[method](`/v1${path}`).set("Authorization", `Bearer ${token}`);
  const win = "from=2027-03-01T00:00:00.000Z&to=2027-03-31T00:00:00.000Z";
  const body = (over: Record<string, unknown> = {}) => ({
    startsAt: "2027-03-10T09:00:00.000Z",
    endsAt: "2027-03-11T09:00:00.000Z",
    reason: "Holiday",
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
  });

  it("OWNER creates, EMPLOYEE lists but cannot write", async () => {
    const res = await api("post", "/staff/closures").send(body());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ locationId: f.locationId, reason: "Holiday" });
    const emp = await staffSession(ctx.app, ctx.prisma, f, "EMPLOYEE");
    const list = await api("get", `/staff/closures?${win}`, emp.token);
    expect(list.status).toBe(200);
    expect(list.body.map((c: { id: string }) => c.id)).toEqual([res.body.id]);
    expect((await api("post", "/staff/closures", emp.token).send(body())).status).toBe(403);
    expect((await api("delete", `/staff/closures/${res.body.id}`, emp.token)).status).toBe(403);
    const touching = await api("get", "/staff/closures?from=2027-03-11T09:00:00.000Z&to=2027-03-12T09:00:00.000Z");
    expect(touching.body).toEqual([]);
  });

  it("patches with a merged range check and deletes with audit", async () => {
    const created = await api("post", "/staff/closures").send(body());
    const bad = await api("patch", `/staff/closures/${created.body.id}`).send({ endsAt: "2027-03-10T09:00:00.000Z" });
    expect(bad.status).toBe(400);
    expect(bad.body.errors[0].path).toBe("endsAt");
    const ok = await api("patch", `/staff/closures/${created.body.id}`).send({ reason: null });
    expect(ok.status).toBe(200);
    expect(ok.body.reason).toBeNull();
    expect((await api("delete", `/staff/closures/${created.body.id}`)).status).toBe(204);
    expect(await ctx.prisma.locationClosure.count()).toBe(0);
    const actions = (await ctx.prisma.auditLog.findMany({ where: { entityId: created.body.id } })).map((a) => a.action).sort();
    expect(actions).toEqual(["location_closure.create", "location_closure.delete", "location_closure.update"]);
    expect((await api("delete", `/staff/closures/${created.body.id}`)).status).toBe(404);
    expect((await api("delete", "/staff/closures/nope")).status).toBe(400);
    expect((await api("post", "/staff/closures").send(body({ endsAt: "2027-03-10T09:00:00.000Z" }))).status).toBe(400);
  });

  it("isolates organizations", async () => {
    const other = await ctx.prisma.organization.create({ data: { name: "O", slug: "o", defaultLocale: "en" } });
    const loc = await ctx.prisma.location.create({
      data: { organizationId: other.id, name: "Foreign", timezone: "UTC", settings: {} },
    });
    const foreign = await ctx.prisma.locationClosure.create({
      data: { locationId: loc.id, startsAt: new Date("2027-03-10T09:00:00Z"), endsAt: new Date("2027-03-11T09:00:00Z") },
    });
    expect((await api("get", `/staff/closures?${win}`)).body).toEqual([]);
    expect((await api("get", `/staff/closures?${win}&locationId=${loc.id}`)).status).toBe(404);
    expect((await api("patch", `/staff/closures/${foreign.id}`).send({ reason: "x" })).status).toBe(404);
    expect((await api("delete", `/staff/closures/${foreign.id}`)).status).toBe(404);
    expect((await api("post", "/staff/closures").send(body({ locationId: loc.id }))).status).toBe(404);
    expect(await ctx.prisma.locationClosure.count()).toBe(1);
  });
});
