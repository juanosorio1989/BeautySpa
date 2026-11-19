import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createIntegrationApp, resetState, resetTenancyCache } from "../app.js";
import { seedFixture, staffSession, type Fixture } from "../helpers.js";

describe("working hours", () => {
  let ctx: Awaited<ReturnType<typeof createIntegrationApp>>;
  let f: Fixture;
  let owner: { id: string; token: string };

  const api = (method: "get" | "put", path: string, token = owner.token) =>
    request(ctx.app.getHttpServer())[method](`/v1${path}`).set("Authorization", `Bearer ${token}`);
  const url = (staffId: string, q = "") => `/staff/employees/${staffId}/working-hours${q}`;
  const week = { days: [{ weekday: 2, start: "09:00", end: "13:00" }, { weekday: 2, start: "14:00", end: "24:00" }] };

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
    owner = await staffSession(ctx.app, ctx.prisma, f, "OWNER");
  });

  it("stores 24:00 as 00:00 and reads it back as 24:00", async () => {
    const put = await api("put", url(f.staffA)).send(week);
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ employeeId: f.staffA, locationId: f.locationId, ...week });
    const rows = await ctx.prisma.$queryRaw<{ end_time: string }[]>`
      SELECT end_time::text FROM working_hours WHERE staff_user_id = ${f.staffA}::uuid ORDER BY start_time DESC`;
    expect(rows[0]?.end_time).toBe("00:00:00");
    const got = await api("get", url(f.staffA, `?locationId=${f.locationId}`));
    expect(got.status).toBe(200);
    expect(got.body.days[1]).toEqual({ weekday: 2, start: "14:00", end: "24:00" });
  });

  it("replaces on a second PUT and audits the first set as before", async () => {
    await api("put", url(f.staffA)).send(week);
    const second = { days: [{ weekday: 4, start: "10:00", end: "12:00" }] };
    expect((await api("put", url(f.staffA)).send(second)).status).toBe(200);
    expect(await ctx.prisma.workingHours.count({ where: { staffUserId: f.staffA } })).toBe(1);
    const audits = await ctx.prisma.auditLog.findMany({
      where: { action: "working_hours.update", entityId: `${f.staffA}:${f.locationId}` },
    });
    expect(audits).toHaveLength(2);
    const withFirstBefore = audits.find((a) => (a.before as { days: unknown[] }).days.length === 2);
    expect(withFirstBefore?.before).toEqual({ days: week.days });
    expect(withFirstBefore?.after).toEqual(second);
  });

  it("rejects overlapping ranges, unassigned locations and malformed ids", async () => {
    const overlap = await api("put", url(f.staffA)).send({
      days: [{ weekday: 1, start: "09:00", end: "12:00" }, { weekday: 1, start: "11:00", end: "13:00" }],
    });
    expect(overlap.status).toBe(400);
    expect(overlap.body.errors[0].path).toBe("days.1");

    const other = await ctx.prisma.location.create({
      data: { organizationId: f.orgId, name: "Second", timezone: "America/New_York", settings: {} },
    });
    const unassigned = await api("put", url(f.staffA, `?locationId=${other.id}`)).send(week);
    expect(unassigned.status).toBe(400);
    expect(unassigned.body.errors[0].path).toBe("locationId");

    expect((await api("get", url("not-a-uuid"))).status).toBe(400);
    expect((await api("get", url(f.staffA, "?locationId=nope"))).status).toBe(400);
  });

  it("lets an EMPLOYEE read only their own hours and never write", async () => {
    const emp = await staffSession(ctx.app, ctx.prisma, f, "EMPLOYEE");
    expect((await api("get", url(emp.id), emp.token)).status).toBe(200);
    expect((await api("get", url(f.staffA), emp.token)).status).toBe(403);
    expect((await api("put", url(emp.id), emp.token).send(week)).status).toBe(403);
    const reception = await staffSession(ctx.app, ctx.prisma, f, "RECEPTION");
    expect((await api("get", url(f.staffA), reception.token)).status).toBe(200);
    expect((await api("put", url(f.staffA), reception.token).send(week)).status).toBe(403);
  });
});
