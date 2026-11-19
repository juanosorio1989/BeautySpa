import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIntegrationApp, resetState, resetTenancyCache } from "./app.js";
import { seedFixture, staffSession } from "./helpers.js";

type Role = "OWNER" | "RECEPTION" | "EMPLOYEE";
type Method = "get" | "post" | "put" | "patch" | "delete";
const ALL: Role[] = ["OWNER", "RECEPTION", "EMPLOYEE"];

/**
 * Every route added by plan 03 (catalog, staff, schedules, public, audit):
 * [method, path, allowed roles, selfScoped]. `selfScoped` routes let an allowed role in at
 * the guard but may still answer 403 from the service (EMPLOYEE: own data only), so only
 * the denied roles and the missing token are asserted for them.
 */
const ID = randomUUID();
const OWNER_ONLY: Role[] = ["OWNER"];
const OWNER_RECEPTION: Role[] = ["OWNER", "RECEPTION"];
const crud = (base: string, opts: { del: boolean }): [Method, string, Role[], boolean?][] => [
  ["get", base, OWNER_ONLY],
  ["post", base, OWNER_ONLY],
  ["get", `${base}/${ID}`, OWNER_ONLY],
  ["patch", `${base}/${ID}`, OWNER_ONLY],
  ...(opts.del ? ([["delete", `${base}/${ID}`, OWNER_ONLY]] as [Method, string, Role[]][]) : []),
];

const MATRIX: [Method, string, Role[], boolean?][] = [
  ...crud("/staff/categories", { del: true }),
  ...crud("/staff/levels", { del: true }),
  ...crud("/staff/resource-types", { del: true }),
  ...crud("/staff/resources", { del: false }),
  ...crud("/staff/services", { del: false }),
  ["get", "/staff/employees", OWNER_RECEPTION],
  ["post", "/staff/employees", OWNER_ONLY],
  ["get", `/staff/employees/${ID}`, OWNER_RECEPTION],
  ["patch", `/staff/employees/${ID}`, OWNER_ONLY],
  ["post", `/staff/employees/${ID}/invite`, OWNER_ONLY],
  ["post", `/staff/employees/${ID}/reset-2fa`, OWNER_ONLY],
  ["get", `/staff/employees/${ID}/working-hours`, ALL, true],
  ["put", `/staff/employees/${ID}/working-hours`, OWNER_ONLY],
  ["get", "/staff/time-off", ALL],
  ["post", "/staff/time-off", OWNER_RECEPTION],
  ["patch", `/staff/time-off/${ID}`, OWNER_RECEPTION],
  ["delete", `/staff/time-off/${ID}`, OWNER_RECEPTION],
  ["get", "/staff/settings", OWNER_ONLY],
  ["patch", "/staff/settings", OWNER_ONLY],
  ["get", "/staff/closures", ALL],
  ["post", "/staff/closures", OWNER_ONLY],
  ["patch", `/staff/closures/${ID}`, OWNER_ONLY],
  ["delete", `/staff/closures/${ID}`, OWNER_ONLY],
  ["get", "/staff/audit", OWNER_ONLY],
];

const PUBLIC: [Method, string][] = [
  ["get", "/public/locations"],
  ["get", "/public/services"],
  ["get", "/public/employees"],
];

describe("RBAC matrix (plan 03 routes)", () => {
  let ctx: Awaited<ReturnType<typeof createIntegrationApp>>;
  const tokens = {} as Record<Role, string>;

  beforeAll(async () => {
    ctx = await createIntegrationApp();
    await resetState(ctx.prisma, ctx.redis);
    resetTenancyCache(ctx.app);
    const f = await seedFixture(ctx.prisma);
    for (const role of ALL) tokens[role] = (await staffSession(ctx.app, ctx.prisma, f, role)).token;
  });
  afterAll(async () => {
    await ctx.close();
  });

  const call = (method: Method, path: string, token?: string) => {
    const req = request(ctx.app.getHttpServer())[method](`/v1${path}`);
    if (token) req.set("Authorization", `Bearer ${token}`);
    // An empty JSON body is enough: denied callers never reach validation.
    return method === "get" || method === "delete" ? req : req.send({});
  };

  describe.each(MATRIX)("%s %s", (method, path, allowed, selfScoped) => {
    it("answers 401 without a token", async () => {
      expect((await call(method, path)).status).toBe(401);
    });
    for (const role of ALL) {
      if (!allowed.includes(role)) {
        it(`answers 403 to ${role}`, async () => {
          expect((await call(method, path, tokens[role])).status).toBe(403);
        });
      } else if (!selfScoped) {
        it(`lets ${role} past the guard`, async () => {
          const status = (await call(method, path, tokens[role])).status;
          expect([401, 403]).not.toContain(status);
        });
      }
    }
    if (selfScoped) {
      it("lets OWNER past the guard", async () => {
        expect([401, 403]).not.toContain((await call(method, path, tokens.OWNER)).status);
      });
    }
  });

  it.each(PUBLIC)("%s %s needs no token", async (method, path) => {
    expect((await call(method, path)).status).toBe(200);
  });
});
