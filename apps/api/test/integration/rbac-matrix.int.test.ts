import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIntegrationApp, resetState, resetTenancyCache } from "./app.js";
import { customerSession, seedFixture, staffSession } from "./helpers.js";

type StaffRole = "OWNER" | "RECEPTION" | "EMPLOYEE";
type Role = StaffRole | "CUSTOMER";
type Method = "get" | "post" | "put" | "patch" | "delete";
const ALL: Role[] = ["OWNER", "RECEPTION", "EMPLOYEE"];
const CUSTOMER_ONLY: Role[] = ["CUSTOMER"];
/** Every caller kind: all staff roles are denied on CUSTOMER_ONLY routes and CUSTOMER on every staff route. */
const EVERY_ROLE: Role[] = [...ALL, "CUSTOMER"];

/**
 * Every route added by plan 03 (catalog, staff, schedules, public, audit):
 * [method, path, allowed roles, selfScoped roles]. A selfScoped role is let in by the guard but
 * may still get 403 from the service (EMPLOYEE: own data only), so it is not asserted
 * against the placeholder id; a separate test calls with its own id.
 */
const ID = randomUUID();
const OWNER_ONLY: Role[] = ["OWNER"];
const OWNER_RECEPTION: Role[] = ["OWNER", "RECEPTION"];
const crud = (base: string, opts: { del: boolean }): [Method, string, Role[], Role[]?][] => [
  ["get", base, OWNER_ONLY],
  ["post", base, OWNER_ONLY],
  ["get", `${base}/${ID}`, OWNER_ONLY],
  ["patch", `${base}/${ID}`, OWNER_ONLY],
  ...(opts.del ? ([["delete", `${base}/${ID}`, OWNER_ONLY]] as [Method, string, Role[]][]) : []),
];

const MATRIX: [Method, string, Role[], Role[]?][] = [
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
  ["get", `/staff/employees/${ID}/working-hours`, ALL, ["EMPLOYEE"]],
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
  // Plan 04: booking and customers.
  ["post", "/appointments", CUSTOMER_ONLY],
  ["get", "/me", CUSTOMER_ONLY],
  ["patch", "/me", CUSTOMER_ONLY],
  ["get", "/me/export", CUSTOMER_ONLY],
  ["get", "/me/appointments", CUSTOMER_ONLY],
  ["post", `/me/appointments/${ID}/cancel`, CUSTOMER_ONLY],
  ["post", `/me/appointments/${ID}/reschedule`, CUSTOMER_ONLY],
  ["post", `/me/appointments/${ID}/repeat`, CUSTOMER_ONLY],
  ["get", "/staff/agenda", ALL],
  ["get", "/staff/customers", ALL],
  ["post", "/staff/customers", OWNER_RECEPTION],
  ["post", "/staff/appointments", OWNER_RECEPTION],
  ["patch", `/staff/appointments/${ID}`, OWNER_RECEPTION],
  ["post", `/staff/appointments/${ID}/status`, ALL],
  ["post", "/staff/walk-in", OWNER_RECEPTION],
  // Last on purpose: a CUSTOMER that passes the guard here is erased, so later CUSTOMER rows would fail.
  ["delete", "/me", CUSTOMER_ONLY],
];

const PUBLIC: [Method, string][] = [
  ["get", "/public/locations"],
  ["get", "/public/services"],
  ["get", "/public/employees"],
];

describe("RBAC matrix (plan 03 and 04 routes)", () => {
  let ctx: Awaited<ReturnType<typeof createIntegrationApp>>;
  const tokens = {} as Record<Role, string>;
  const ids = {} as Record<Role, string>;

  beforeAll(async () => {
    ctx = await createIntegrationApp();
    await resetState(ctx.prisma, ctx.redis);
    resetTenancyCache(ctx.app);
    const f = await seedFixture(ctx.prisma);
    for (const role of ALL) {
      const session = await staffSession(ctx.app, ctx.prisma, f, role as StaffRole);
      tokens[role] = session.token;
      ids[role] = session.id;
    }
    tokens.CUSTOMER = (await customerSession(ctx.app, f)).token;
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
    for (const role of EVERY_ROLE) {
      if (!allowed.includes(role)) {
        it(`answers 403 to ${role}`, async () => {
          expect((await call(method, path, tokens[role])).status).toBe(403);
        });
      } else if (!selfScoped?.includes(role)) {
        it(`lets ${role} past the guard`, async () => {
          const status = (await call(method, path, tokens[role])).status;
          expect([401, 403]).not.toContain(status);
        });
      }
    }
  });

  it("lets an EMPLOYEE read their own working hours", async () => {
    const res = await call("get", `/staff/employees/${ids.EMPLOYEE}/working-hours`, tokens.EMPLOYEE);
    expect([401, 403]).not.toContain(res.status);
  });

  describe("GET /availability (optional auth)", () => {
    it("does not require a token", async () => {
      expect([401, 403]).not.toContain((await call("get", "/availability")).status);
    });
    it("answers 401 to an invalid token", async () => {
      expect((await call("get", "/availability", "not-a-token")).status).toBe(401);
    });
  });

  describe("POST /holds (public)", () => {
    it("needs no token", async () => {
      expect([401, 403]).not.toContain((await call("post", "/holds")).status);
    });
  });

  it.each(PUBLIC)("%s %s needs no token", async (method, path) => {
    expect((await call(method, path)).status).toBe(200);
  });
});
