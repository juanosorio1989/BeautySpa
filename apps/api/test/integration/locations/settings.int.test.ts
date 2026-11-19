import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_LOCATION_SETTINGS } from "@beautyspa/contracts";
import { readLocationSettings } from "../../../src/locations/settings.service.js";
import { createIntegrationApp, resetState, resetTenancyCache } from "../app.js";
import { seedFixture, staffSession, type Fixture } from "../helpers.js";

describe("location settings", () => {
  let ctx: Awaited<ReturnType<typeof createIntegrationApp>>;
  let f: Fixture;
  let owner: { id: string; token: string };

  const api = (method: "get" | "patch", path: string, token = owner.token) =>
    request(ctx.app.getHttpServer())[method](`/v1${path}`).set("Authorization", `Bearer ${token}`);

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

  it("returns defaults and no hours for a fresh location", async () => {
    const res = await api("get", "/staff/settings");
    expect(res.status).toBe(200);
    expect(res.body.settings).toEqual(DEFAULT_LOCATION_SETTINGS);
    expect(res.body.hours).toEqual([]);
    expect(res.body.location).toMatchObject({ id: f.locationId, name: "Main", timezone: "America/New_York" });
  });

  it("merges settings keys and replaces hours, mapping 24:00 to 00:00", async () => {
    const a = await api("patch", `/staff/settings?locationId=${f.locationId}`).send({ settings: { holdMinutes: 10 } });
    expect(a.status).toBe(200);
    expect(a.body.settings).toEqual({ ...DEFAULT_LOCATION_SETTINGS, holdMinutes: 10 });
    const b = await api("patch", "/staff/settings").send({ hours: [{ weekday: 0, start: "10:00", end: "24:00" }] });
    expect(b.status).toBe(200);
    expect(b.body.hours).toEqual([{ weekday: 0, start: "10:00", end: "24:00" }]);
    expect(b.body.settings.holdMinutes).toBe(10);
    const rows = await ctx.prisma.locationHours.findMany({ where: { locationId: f.locationId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.closes.getUTCHours()).toBe(0);
    const c = await api("patch", "/staff/settings").send({ hours: [{ weekday: 1, start: "09:00", end: "17:00" }], name: "Renamed" });
    expect(c.body.hours).toEqual([{ weekday: 1, start: "09:00", end: "17:00" }]);
    expect(c.body.location.name).toBe("Renamed");
    expect(await ctx.prisma.locationHours.count()).toBe(1);
    const audits = await ctx.prisma.auditLog.findMany({ where: { action: "location.update", entityId: f.locationId } });
    expect(audits).toHaveLength(3);
    const last = audits.find((x) => (x.before as { location: { name: string } }).location.name === "Main" && (x.after as { location: { name: string } }).location.name === "Renamed");
    expect(last).toBeDefined();
  });

  it("rejects invalid bodies and a missing role", async () => {
    const tz = await api("patch", "/staff/settings").send({ timezone: "Mars/Base" });
    expect(tz.status).toBe(400);
    expect(tz.body.errors.map((e: { path: string }) => e.path)).toContain("timezone");
    expect((await api("patch", "/staff/settings").send({})).status).toBe(400);
    expect((await api("patch", "/staff/settings").send({ settings: { slotIntervalMin: 7 } })).status).toBe(400);
    expect((await api("get", "/staff/settings?locationId=nope")).status).toBe(400);
    const reception = await staffSession(ctx.app, ctx.prisma, f, "RECEPTION");
    expect((await api("get", "/staff/settings", reception.token)).status).toBe(403);
    expect((await api("patch", "/staff/settings", reception.token).send({ name: "X" })).status).toBe(403);
  });

  it("404s for another org's location", async () => {
    const other = await ctx.prisma.organization.create({ data: { name: "O", slug: "o", defaultLocale: "en" } });
    const loc = await ctx.prisma.location.create({
      data: { organizationId: other.id, name: "Foreign", timezone: "UTC", settings: {} },
    });
    expect((await api("get", `/staff/settings?locationId=${loc.id}`)).status).toBe(404);
    expect((await api("patch", `/staff/settings?locationId=${loc.id}`).send({ name: "X" })).status).toBe(404);
  });

  it("readLocationSettings falls back per invalid key", () => {
    expect(readLocationSettings({})).toEqual(DEFAULT_LOCATION_SETTINGS);
    expect(readLocationSettings({ holdMinutes: 10, slotIntervalMin: 7, bogus: 1 })).toEqual({
      ...DEFAULT_LOCATION_SETTINGS,
      holdMinutes: 10,
    });
    expect(readLocationSettings(null)).toEqual(DEFAULT_LOCATION_SETTINGS);
  });
});
