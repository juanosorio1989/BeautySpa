import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createIntegrationApp, resetState, resetTenancyCache } from "../app.js";
import { customerSession, seedFixture, staffSession, type Fixture } from "../helpers.js";

describe("GET /staff/me", () => {
  let ctx: Awaited<ReturnType<typeof createIntegrationApp>>;
  let f: Fixture;

  const get = (token?: string) => {
    const req = request(ctx.app.getHttpServer()).get("/v1/staff/me");
    return token ? req.set("Authorization", `Bearer ${token}`) : req;
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
  });

  it("names a user with a profile by the display name", async () => {
    const owner = await staffSession(ctx.app, ctx.prisma, f, "OWNER", "owner@test.dev");
    await ctx.prisma.employeeProfile.create({ data: { staffUserId: owner.id, displayName: "Olivia" } });
    const res = await get(owner.token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: owner.id, name: "Olivia", email: "owner@test.dev", role: "OWNER" });
  });

  it("falls back to the email without a profile", async () => {
    const rec = await staffSession(ctx.app, ctx.prisma, f, "RECEPTION", "rec@test.dev");
    const res = await get(rec.token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: rec.id, name: "rec@test.dev", email: "rec@test.dev", role: "RECEPTION" });
  });

  it("answers 403 to a customer token and 401 without a token", async () => {
    expect((await get((await customerSession(ctx.app, f)).token)).status).toBe(403);
    expect((await get()).status).toBe(401);
  });
});
