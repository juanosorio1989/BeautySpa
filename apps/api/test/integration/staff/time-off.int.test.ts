import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createIntegrationApp, resetState, resetTenancyCache } from "../app.js";
import { seedFixture, staffSession, type Fixture } from "../helpers.js";

describe("time off", () => {
  let ctx: Awaited<ReturnType<typeof createIntegrationApp>>;
  let f: Fixture;
  let reception: { id: string; token: string };

  const api = (method: "get" | "post" | "patch" | "delete", path: string, token = reception.token) =>
    request(ctx.app.getHttpServer())[method](`/v1${path}`).set("Authorization", `Bearer ${token}`);
  const body = (over: Record<string, unknown> = {}) => ({
    employeeId: f.staffA,
    startsAt: "2027-03-01T09:00:00.000Z",
    endsAt: "2027-03-05T09:00:00.000Z",
    kind: "VACATION",
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
    await ctx.prisma.staffLocation.create({ data: { staffUserId: f.staffA, locationId: f.locationId } });
    reception = await staffSession(ctx.app, ctx.prisma, f, "RECEPTION");
  });

  it("creates VACATION and lists by half-open window overlap", async () => {
    const res = await api("post", "/staff/time-off").send(body());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ employeeId: f.staffA, locationId: null, kind: "VACATION", note: null });

    const touching = await api("get", "/staff/time-off?from=2027-03-05T09:00:00.000Z&to=2027-03-06T09:00:00.000Z");
    expect(touching.status).toBe(200);
    expect(touching.body).toEqual([]);
    const overlap = await api("get", "/staff/time-off?from=2027-03-04T09:00:00.000Z&to=2027-03-06T09:00:00.000Z");
    expect(overlap.body).toHaveLength(1);
    expect(overlap.body[0].id).toBe(res.body.id);
  });

  it("limits an EMPLOYEE to their own rows", async () => {
    const emp = await staffSession(ctx.app, ctx.prisma, f, "EMPLOYEE");
    await api("post", "/staff/time-off").send(body());
    await api("post", "/staff/time-off").send(body({ employeeId: emp.id }));
    const win = "from=2027-03-01T00:00:00.000Z&to=2027-03-10T00:00:00.000Z";
    const own = await api("get", `/staff/time-off?${win}`, emp.token);
    expect(own.status).toBe(200);
    expect(own.body.map((r: { employeeId: string }) => r.employeeId)).toEqual([emp.id]);
    expect((await api("get", `/staff/time-off?${win}&employeeId=${f.staffA}`, emp.token)).status).toBe(403);
    expect((await api("post", "/staff/time-off", emp.token).send(body())).status).toBe(403);
  });

  it("patches with a merged range check, then deletes with audit", async () => {
    const created = await api("post", "/staff/time-off").send(body());
    const bad = await api("patch", `/staff/time-off/${created.body.id}`).send({ endsAt: "2027-03-01T09:00:00.000Z" });
    expect(bad.status).toBe(400);
    expect(bad.body.errors[0].path).toBe("endsAt");
    const ok = await api("patch", `/staff/time-off/${created.body.id}`).send({ kind: "BLOCK", note: "Course" });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ kind: "BLOCK", note: "Course" });
    expect((await api("delete", `/staff/time-off/${created.body.id}`)).status).toBe(204);
    expect(await ctx.prisma.timeOff.count()).toBe(0);
    const audit = await ctx.prisma.auditLog.findFirst({
      where: { action: "time_off.delete", entityId: created.body.id },
    });
    expect(audit?.before).toMatchObject({ kind: "BLOCK" });
    expect((await api("delete", `/staff/time-off/${created.body.id}`)).status).toBe(404);
    expect((await api("delete", "/staff/time-off/nope")).status).toBe(400);
  });

  it("rejects another org's employee and a location the member is not assigned to", async () => {
    const other = await ctx.prisma.organization.create({ data: { name: "Other", slug: "other", defaultLocale: "en" } });
    const foreign = await ctx.prisma.staffUser.create({
      data: { organizationId: other.id, email: "x@other.dev", role: "EMPLOYEE", locale: "en" },
    });
    const res = await api("post", "/staff/time-off").send(body({ employeeId: foreign.id }));
    expect(res.status).toBe(400);
    expect(res.body.errors[0].path).toBe("employeeId");

    const loc = await ctx.prisma.location.create({
      data: { organizationId: f.orgId, name: "Second", timezone: "America/New_York", settings: {} },
    });
    const unassigned = await api("post", "/staff/time-off").send(body({ locationId: loc.id }));
    expect(unassigned.status).toBe(400);
    expect(unassigned.body.errors[0].path).toBe("locationId");
    expect((await api("post", "/staff/time-off").send(body({ locationId: f.locationId }))).status).toBe(201);
  });
  it("?locationId=L returns rows at L and rows for all locations, not other locations", async () => {
    const loc2 = await ctx.prisma.location.create({
      data: { organizationId: f.orgId, name: "Second", timezone: "America/New_York", settings: {} },
    });
    await ctx.prisma.staffLocation.create({ data: { staffUserId: f.staffA, locationId: loc2.id } });
    const atL = await api("post", "/staff/time-off").send(body({ locationId: f.locationId }));
    const all = await api("post", "/staff/time-off").send(body());
    await api("post", "/staff/time-off").send(body({ locationId: loc2.id }));
    const res = await api(
      "get",
      `/staff/time-off?from=2027-03-01T00:00:00.000Z&to=2027-03-10T00:00:00.000Z&locationId=${f.locationId}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.map((r: { id: string }) => r.id).sort()).toEqual([atL.body.id, all.body.id].sort());
  });

  it("never touches or lists another organization's time off", async () => {
    const other = await ctx.prisma.organization.create({ data: { name: "Other", slug: "other", defaultLocale: "en" } });
    const loc = await ctx.prisma.location.create({
      data: { organizationId: other.id, name: "O", timezone: "America/New_York", settings: {} },
    });
    const foreign = await ctx.prisma.staffUser.create({
      data: { organizationId: other.id, email: "x@other.dev", role: "EMPLOYEE", locale: "en" },
    });
    await ctx.prisma.staffLocation.create({ data: { staffUserId: foreign.id, locationId: loc.id } });
    const row = await ctx.prisma.timeOff.create({
      data: {
        organizationId: other.id,
        staffUserId: foreign.id,
        startsAt: new Date("2027-03-01T09:00:00.000Z"),
        endsAt: new Date("2027-03-05T09:00:00.000Z"),
        kind: "VACATION",
      },
    });
    expect((await api("patch", `/staff/time-off/${row.id}`).send({ note: "x" })).status).toBe(404);
    expect((await api("delete", `/staff/time-off/${row.id}`)).status).toBe(404);
    expect(await ctx.prisma.timeOff.count({ where: { id: row.id } })).toBe(1);
    const list = await api("get", "/staff/time-off?from=2027-03-01T00:00:00.000Z&to=2027-03-10T00:00:00.000Z");
    expect(list.body).toEqual([]);
  });
});
