import { Controller, Get, Module } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AccessClaims } from "@beautyspa/contracts";
import { OptionalAuth, Principal } from "../../../src/auth/decorators.js";
import { TokenService } from "../../../src/auth/token.service.js";
import { createIntegrationApp, resetState } from "../app.js";
import { seedFixture, type Fixture } from "../helpers.js";

/** Test-only route with the optional policy. */
@Controller("test/optional")
class OptionalTestController {
  @OptionalAuth()
  @Get()
  get(@Principal() principal: AccessClaims | undefined) {
    return { sub: principal?.sub ?? null };
  }
}

@Module({ controllers: [OptionalTestController] })
class OptionalTestModule {}

describe("@OptionalAuth()", () => {
  let ctx: Awaited<ReturnType<typeof createIntegrationApp>>;
  let f: Fixture;
  let tokens: TokenService;
  const get = (authorization?: string) => {
    const req = request(ctx.app.getHttpServer()).get("/v1/test/optional");
    return authorization === undefined ? req : req.set("Authorization", authorization);
  };

  beforeAll(async () => {
    ctx = await createIntegrationApp({ imports: [OptionalTestModule] });
    tokens = ctx.app.get(TokenService);
    // Seeded once: TenancyService caches the org id for the app's lifetime.
    await resetState(ctx.prisma, ctx.redis);
    f = await seedFixture(ctx.prisma);
  });
  afterAll(async () => {
    await ctx?.close();
  });

  it("no Authorization header: 200 without a principal", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sub: null });
  });

  it("a customer token sets the principal", async () => {
    const { token } = await tokens.issueAccess({ sub: f.customerId, typ: "customer", org: f.orgId, role: "CUSTOMER" });
    const res = await get(`Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sub: f.customerId });
  });

  it("a staff token sets the principal", async () => {
    const { token } = await tokens.issueAccess({ sub: f.staffA, typ: "staff", org: f.orgId, role: "EMPLOYEE" });
    const res = await get(`Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sub: f.staffA });
  });

  it("a present but invalid token is 401, never anonymous", async () => {
    const garbage = await get("Bearer garbage");
    expect(garbage.status).toBe(401);
    expect(garbage.body.code).toBe("UNAUTHORIZED");
    const { token } = await tokens.issueAccess({ sub: f.staffA, typ: "staff", org: f.orgId, role: "OWNER" });
    expect((await get(`Basic ${token}`)).status).toBe(401);
    expect((await get("")).status).toBe(401);
    const mfa = await tokens.issueMfa(f.staffA, f.orgId, "verify");
    expect((await get(`Bearer ${mfa.token}`)).status).toBe(401);
  });

  it("a token for another organization is 401", async () => {
    const { token } = await tokens.issueAccess({
      sub: f.staffA,
      typ: "staff",
      org: "0194b2a0-0000-7000-8000-0000000000ff",
      role: "OWNER",
    });
    const res = await get(`Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHORIZED");
  });
});
