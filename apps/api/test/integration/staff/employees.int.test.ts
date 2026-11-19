import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "../../../src/auth/crypto/tokens.js";
import { RefreshTokenService } from "../../../src/auth/refresh-token.service.js";
import { StaffLinksService } from "../../../src/auth/staff/staff-links.service.js";
import { ConsoleMailer } from "../../../src/mail/console.mailer.js";
import { MAILER } from "../../../src/mail/mailer.js";
import { createIntegrationApp, resetState, resetTenancyCache } from "../app.js";
import { seedFixture, staffSession, type Fixture } from "../helpers.js";

const BODY = { "x-token-transport": "body" };
const NEW_PASSWORD = "a-long-password-1";
/** The `token` query parameter of a link. */
const tokenOf = (link: string) => new URL(link).searchParams.get("token")!;

describe("employees CRUD", () => {
  let ctx: Awaited<ReturnType<typeof createIntegrationApp>>;
  let f: Fixture;
  let owner: { id: string; token: string };
  let service2: string;

  const api = (method: "get" | "post" | "patch", path: string, token = owner.token) =>
    request(ctx.app.getHttpServer())[method](`/v1${path}`).set("Authorization", `Bearer ${token}`);
  const mailer = () => ctx.app.get<ConsoleMailer>(MAILER);
  const refresh = (token: string) =>
    request(ctx.app.getHttpServer()).post("/v1/auth/refresh").set(BODY).send({ refreshToken: token });
  const tokenRow = (token: string) => ctx.prisma.refreshToken.findUnique({ where: { tokenHash: sha256Hex(token) } });
  /** Enables login for `staffId` and returns a live refresh token for them. */
  const liveRefreshToken = async (staffId: string) => {
    await ctx.prisma.staffUser.update({ where: { id: staffId }, data: { canLogin: true } });
    const { token } = await ctx.app.get(RefreshTokenService).create({ type: "STAFF", id: staffId }, { ip: null, userAgent: null });
    return token;
  };

  const stylist = (over: Record<string, unknown> = {}) => ({
    role: "EMPLOYEE",
    locale: "en",
    canLogin: false,
    profile: { displayName: "Maria" },
    serviceIds: [f.serviceId, service2],
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
    mailer().sent.length = 0;
    f = await seedFixture(ctx.prisma);
    owner = await staffSession(ctx.app, ctx.prisma, f, "OWNER");
    service2 = (
      await ctx.prisma.service.create({
        data: { organizationId: f.orgId, name: { en: "Manicure", es: "Manicura" }, durationMin: 30, priceCents: 2500 },
      })
    ).id;
  });

  it("creates an EMPLOYEE with a profile and two services at the default location, audited without secrets", async () => {
    const res = await api("post", "/staff/employees").send(stylist());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      role: "EMPLOYEE",
      email: null,
      canLogin: false,
      active: true,
      hasPassword: false,
      mfaEnrolled: false,
      locationIds: [f.locationId],
      profile: { displayName: "Maria", bio: null, photoUrl: null, levelId: null, bookableOnline: true },
    });
    expect([...res.body.serviceIds].sort()).toEqual([f.serviceId, service2].sort());

    const audit = await ctx.prisma.auditLog.findFirst({ where: { action: "staff_user.create", entityId: res.body.id } });
    expect(audit).toMatchObject({ entity: "staff_user", actorType: "STAFF", actorId: owner.id, organizationId: f.orgId });
    expect(audit?.after).toEqual(res.body);
    expect(Object.keys(audit?.after as object)).not.toContain("passwordHash");

    const got = await api("get", `/staff/employees/${res.body.id}`);
    expect(got.status).toBe(200);
    expect(got.body).toEqual(res.body);
  });

  it("creates a login-enabled member and emails an invite when sendInvite is set", async () => {
    const res = await api("post", "/staff/employees").send({
      role: "RECEPTION",
      locale: "es",
      canLogin: true,
      email: "Recep@Salon.com",
      sendInvite: true,
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email: "recep@salon.com", canLogin: true, profile: null, serviceIds: [] });
    expect(mailer().sent).toHaveLength(1);
    expect(mailer().sent[0]!.to).toBe("recep@salon.com");
    expect(await ctx.prisma.auditLog.count({ where: { action: "staff.invite", entityId: res.body.id } })).toBe(1);
  });

  it("rejects another org's service (400 on its path) and a duplicate email (409)", async () => {
    const other = await ctx.prisma.organization.create({ data: { name: "Other", slug: "other", defaultLocale: "en" } });
    const foreign = await ctx.prisma.service.create({
      data: { organizationId: other.id, name: { en: "X", es: "X" }, durationMin: 30, priceCents: 1000 },
    });
    const bad = await api("post", "/staff/employees").send(stylist({ serviceIds: [foreign.id] }));
    expect(bad.status).toBe(400);
    expect(bad.body.errors[0].path).toBe("serviceIds.0");

    const dup = await api("post", "/staff/employees").send(stylist({ email: "a@test.dev" }));
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe("CONFLICT");
    expect(await ctx.prisma.staffUser.count({ where: { organizationId: f.orgId } })).toBe(3);
  });

  it("PATCH profile: null removes the profile and its services", async () => {
    const created = await api("post", "/staff/employees").send(stylist());
    const res = await api("patch", `/staff/employees/${created.body.id}`).send({ profile: null });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ profile: null, serviceIds: [] });
    expect(await ctx.prisma.employeeService.count({ where: { staffUserId: created.body.id } })).toBe(0);
  });

  it("PATCH serviceIds without a profile, or canLogin without email, is 400 on that path", async () => {
    const created = await api("post", "/staff/employees").send({ role: "RECEPTION", locale: "en" });
    const a = await api("patch", `/staff/employees/${created.body.id}`).send({ serviceIds: [f.serviceId] });
    expect(a.status).toBe(400);
    expect(a.body.errors[0].path).toBe("serviceIds");
    const b = await api("patch", `/staff/employees/${created.body.id}`).send({ canLogin: true });
    expect(b.status).toBe(400);
    expect(b.body.errors[0].path).toBe("email");
  });

  it("PATCH active: false revokes the member's refresh tokens", async () => {
    const token = await liveRefreshToken(f.staffA);
    const res = await api("patch", `/staff/employees/${f.staffA}`).send({ active: false });
    expect(res.status).toBe(200);
    expect(res.body.active).toBe(false);
    expect((await tokenRow(token))!.revokedAt).not.toBeNull();
    expect((await refresh(token)).status).toBe(401);
    const audit = await ctx.prisma.auditLog.findFirst({ where: { action: "staff_user.update", entityId: f.staffA } });
    expect(audit?.before).toMatchObject({ active: true });
    expect(audit?.after).toMatchObject({ active: false });
  });

  it.each([{ role: "RECEPTION" }, { email: "new@x.dev" }, { canLogin: false }])(
    "PATCH %o revokes the member's refresh tokens",
    async (patch) => {
      const token = await liveRefreshToken(f.staffA);
      const res = await api("patch", `/staff/employees/${f.staffA}`).send(patch);
      expect(res.status).toBe(200);
      expect((await tokenRow(token))!.revokedAt).not.toBeNull();
    },
  );

  it("PATCH canLogin: false spends a pending invite, which then cannot turn login back on", async () => {
    const link = await ctx.app.get(StaffLinksService).issue(f.staffA, "INVITE");
    await ctx.prisma.staffUser.update({ where: { id: f.staffA }, data: { canLogin: true } });
    expect((await api("patch", `/staff/employees/${f.staffA}`).send({ canLogin: false })).status).toBe(200);
    const accept = await request(ctx.app.getHttpServer())
      .post("/v1/auth/staff/invite/accept")
      .set(BODY)
      .send({ token: tokenOf(link), password: NEW_PASSWORD });
    expect(accept.status).toBe(400);
    expect(accept.body.code).toBe("LINK_INVALID");
    const row = await ctx.prisma.staffUser.findUniqueOrThrow({ where: { id: f.staffA } });
    expect(row).toMatchObject({ canLogin: false, passwordHash: null });
  });

  it("PATCH email spends the invite and reset links sent to the old address", async () => {
    const links = ctx.app.get(StaffLinksService);
    const invite = await links.issue(f.staffA, "INVITE");
    const reset = await links.issue(f.staffA, "PASSWORD_RESET");
    expect((await api("patch", `/staff/employees/${f.staffA}`).send({ email: "moved@test.dev" })).status).toBe(200);
    const post = (path: string, token: string) =>
      request(ctx.app.getHttpServer())
        .post(`/v1/auth/staff/${path}`)
        .set(BODY)
        .send({ token: tokenOf(token), password: NEW_PASSWORD });
    const a = await post("invite/accept", invite);
    expect(a.status).toBe(400);
    expect(a.body.code).toBe("LINK_INVALID");
    const b = await post("password/reset", reset);
    expect(b.status).toBe(400);
    expect(b.body.code).toBe("LINK_INVALID");
    expect((await ctx.prisma.staffUser.findUniqueOrThrow({ where: { id: f.staffA } })).passwordHash).toBeNull();
  });

  it("PATCH email to one already in use is 409", async () => {
    const res = await api("patch", `/staff/employees/${f.staffA}`).send({ email: "b@test.dev" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CONFLICT");
  });

  it("rejects another org's profile.levelId with 400 on that path", async () => {
    const other = await ctx.prisma.organization.create({ data: { name: "Other", slug: "other", defaultLocale: "en" } });
    const lvl = await ctx.prisma.level.create({ data: { organizationId: other.id, name: { en: "X", es: "X" }, rank: 1 } });
    const res = await api("post", "/staff/employees").send(stylist({ profile: { displayName: "Maria", levelId: lvl.id } }));
    expect(res.status).toBe(400);
    expect(res.body.errors[0].path).toBe("profile.levelId");
  });

  it("POST without locationIds in an org with several locations is 400 on locationIds", async () => {
    await ctx.prisma.location.create({
      data: { organizationId: f.orgId, name: "Second", timezone: "America/New_York", settings: {} },
    });
    const res = await api("post", "/staff/employees").send(stylist());
    expect(res.status).toBe(400);
    expect(res.body.errors[0].path).toBe("locationIds");
  });

  it("PATCH locale only keeps the member's refresh tokens", async () => {
    const token = await liveRefreshToken(f.staffA);
    const res = await api("patch", `/staff/employees/${f.staffA}`).send({ locale: "es" });
    expect(res.status).toBe(200);
    expect((await tokenRow(token))!.revokedAt).toBeNull();
    expect((await refresh(token)).status).toBe(200);
  });

  it("PATCH locationIds replaces locations and deletes working hours and time off at the removed one", async () => {
    const second = await ctx.prisma.location.create({
      data: { organizationId: f.orgId, name: "Second", timezone: "America/New_York", settings: {} },
    });
    const created = await api("post", "/staff/employees").send(stylist({ locationIds: [f.locationId] }));
    const id = created.body.id as string;
    const t = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);
    await ctx.prisma.workingHours.createMany({
      data: [
        { organizationId: f.orgId, staffUserId: id, locationId: f.locationId, weekday: 1, startTime: t("09:00"), endTime: t("17:00") },
        { organizationId: f.orgId, staffUserId: id, locationId: second.id, weekday: 2, startTime: t("09:00"), endTime: t("17:00") },
      ],
    });
    const range = { startsAt: new Date("2026-12-01T00:00:00Z"), endsAt: new Date("2026-12-02T00:00:00Z"), kind: "VACATION" as const };
    await ctx.prisma.timeOff.createMany({
      data: [
        { organizationId: f.orgId, staffUserId: id, locationId: f.locationId, ...range },
        { organizationId: f.orgId, staffUserId: id, locationId: null, ...range },
      ],
    });

    const res = await api("patch", `/staff/employees/${id}`).send({ locationIds: [second.id] });
    expect(res.status).toBe(200);
    expect(res.body.locationIds).toEqual([second.id]);
    const hours = await ctx.prisma.workingHours.findMany({ where: { staffUserId: id } });
    expect(hours.map((h) => h.locationId)).toEqual([second.id]);
    const off = await ctx.prisma.timeOff.findMany({ where: { staffUserId: id } });
    expect(off.map((o) => o.locationId)).toEqual([null]);
  });

  it("an OWNER cannot change their own role or access, but can change their locale", async () => {
    const role = await api("patch", `/staff/employees/${owner.id}`).send({ role: "RECEPTION" });
    expect(role.status).toBe(403);
    expect(role.body.code).toBe("FORBIDDEN");
    const active = await api("patch", `/staff/employees/${owner.id}`).send({ active: false });
    expect(active.status).toBe(403);
    const canLogin = await api("patch", `/staff/employees/${owner.id}`).send({ canLogin: false });
    expect(canLogin.status).toBe(403);
    const locale = await api("patch", `/staff/employees/${owner.id}`).send({ locale: "es" });
    expect(locale.status).toBe(200);
    expect(locale.body).toMatchObject({ role: "OWNER", locale: "es", active: true });
  });

  it("lists active members first, filters by active and locationId; RECEPTION reads, EMPLOYEE does not", async () => {
    await api("patch", `/staff/employees/${f.staffA}`).send({ active: false });
    const all = await api("get", "/staff/employees");
    expect(all.status).toBe(200);
    expect(all.body).toHaveLength(3);
    expect(all.body.at(-1).id).toBe(f.staffA);

    const inactive = await api("get", "/staff/employees?active=false");
    expect(inactive.body.map((e: { id: string }) => e.id)).toEqual([f.staffA]);
    const created = await api("post", "/staff/employees").send(stylist());
    const atLoc = await api("get", `/staff/employees?locationId=${f.locationId}`);
    expect(atLoc.body.map((e: { id: string }) => e.id)).toEqual([created.body.id]);

    const reception = await staffSession(ctx.app, ctx.prisma, f, "RECEPTION");
    expect((await api("get", "/staff/employees", reception.token)).status).toBe(200);
    expect((await api("get", `/staff/employees/${f.staffA}`, reception.token)).status).toBe(200);
    expect((await api("post", "/staff/employees", reception.token).send(stylist())).status).toBe(403);
    expect((await api("patch", `/staff/employees/${f.staffA}`, reception.token).send({ locale: "es" })).status).toBe(403);
    const employee = await staffSession(ctx.app, ctx.prisma, f, "EMPLOYEE");
    expect((await api("get", "/staff/employees", employee.token)).status).toBe(403);
  });

  it("another org's member is 404; a non-UUID id is 400", async () => {
    const other = await ctx.prisma.organization.create({ data: { name: "Other", slug: "other", defaultLocale: "en" } });
    const stranger = await ctx.prisma.staffUser.create({
      data: { organizationId: other.id, email: "x@other.dev", role: "EMPLOYEE", locale: "en" },
    });
    expect((await api("get", `/staff/employees/${stranger.id}`)).status).toBe(404);
    expect((await api("patch", `/staff/employees/${stranger.id}`).send({ locale: "es" })).status).toBe(404);
    expect((await api("get", "/staff/employees/not-a-uuid")).status).toBe(400);
  });
});
