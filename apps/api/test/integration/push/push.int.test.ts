import { createECDH } from "node:crypto";
import type { Queue } from "bullmq";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CLOCK } from "../../../src/common/clock.js";
import { NOTIFICATIONS_QUEUE_TOKEN } from "../../../src/queue/queue.module.js";
import { sendJobId } from "../../../src/queue/queue-names.js";
import { createIntegrationApp, resetState, resetTenancyCache } from "../app.js";
import {
  BOOKING_NOW,
  bookSegment,
  customerSession,
  fixedClock,
  seedBookingFixture,
  type BookingFixture,
} from "../helpers.js";

const ENDPOINT = "https://push.example/sub/1";
const KEYS = { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA", auth: "tBHItJI5svbpez7KI4CCXg" };

describe("push subscriptions API", () => {
  const clock = fixedClock(BOOKING_NOW);
  let ctx: Awaited<ReturnType<typeof createIntegrationApp>>;
  let queue: Queue;
  let f: BookingFixture;
  let token: string;

  const http = () => request(ctx.app.getHttpServer());
  const auth = (bearer: string) => ({ Authorization: `Bearer ${bearer}` });
  const subscribe = (body: Record<string, unknown> = { endpoint: ENDPOINT, keys: KEYS }, bearer = token) =>
    http().post("/v1/me/push-subscriptions").set(auth(bearer)).send(body);
  const unsubscribe = (endpoint = ENDPOINT, bearer = token) =>
    http().delete("/v1/me/push-subscriptions").set(auth(bearer)).send({ endpoint });
  const subs = () => ctx.prisma.pushSubscription.findMany({ orderBy: { createdAt: "asc" } });
  const pushConsents = (customerId = f.customerId) =>
    ctx.prisma.notificationConsent.findMany({
      where: { customerId, channel: "PUSH" },
      orderBy: [{ changedAt: "asc" }, { id: "asc" }],
    });
  const audits = () =>
    ctx.prisma.auditLog.findMany({
      where: { organizationId: f.orgId, action: "customer.update" },
      orderBy: { at: "asc" },
    });
  const otherCustomer = async () => {
    const c = await ctx.prisma.customer.create({
      data: { organizationId: f.orgId, phoneE164: "+13055550111", name: "Bea", locale: "en", createdVia: "ONLINE" },
    });
    return { id: c.id, token: (await customerSession(ctx.app, f, c.id)).token };
  };

  beforeAll(async () => {
    ctx = await createIntegrationApp({ override: (b) => b.overrideProvider(CLOCK).useValue(clock) });
    queue = ctx.app.get<Queue>(NOTIFICATIONS_QUEUE_TOKEN);
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await resetState(ctx.prisma, ctx.redis);
    resetTenancyCache(ctx.app);
    clock.set(BOOKING_NOW);
    f = await seedBookingFixture(ctx.prisma);
    token = (await customerSession(ctx.app, f)).token;
  });

  it("subscribe stores row and grants PUSH once", async () => {
    const res = await subscribe({ endpoint: ENDPOINT, keys: KEYS, consentSource: "BOOKING_FORM" });
    expect(res.status).toBe(204);

    const rows = await subs();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organizationId: f.orgId,
      customerId: f.customerId,
      endpoint: ENDPOINT,
      p256dh: KEYS.p256dh,
      auth: KEYS.auth,
      lastSuccessAt: null,
    });
    const consents = await pushConsents();
    expect(consents.map((c) => ({ granted: c.granted, source: c.source }))).toEqual([
      { granted: true, source: "BOOKING_FORM" },
    ]);
    const a = await audits();
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ actorType: "CUSTOMER", actorId: f.customerId, after: { fields: ["consents.PUSH"] } });
    expect((await http().get("/v1/me").set(auth(token))).body.consents.PUSH).toBe(true);
  });

  it("subscribe twice same endpoint keeps one row, one consent row", async () => {
    expect((await subscribe()).status).toBe(204);
    const newKeys = { p256dh: "BNewKey", auth: "newAuth" };
    expect((await subscribe({ endpoint: ENDPOINT, keys: newKeys })).status).toBe(204);

    const rows = await subs();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ p256dh: newKeys.p256dh, auth: newKeys.auth });
    expect(await pushConsents()).toHaveLength(1);
    expect((await pushConsents())[0]!.source).toBe("PROFILE");
    expect(await audits()).toHaveLength(1);
  });

  it("endpoint of another customer moves to caller", async () => {
    const bea = await otherCustomer();
    expect((await subscribe(undefined, bea.token)).status).toBe(204);
    expect((await subscribe()).status).toBe(204);

    const rows = await subs();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.customerId).toBe(f.customerId);
    // Bea keeps her consent row; only the device moved.
    expect(await pushConsents(bea.id)).toHaveLength(1);
    expect(await pushConsents()).toHaveLength(1);
  });

  it("unsubscribe last row revokes PUSH", async () => {
    await subscribe();
    await subscribe({ endpoint: "https://push.example/sub/2", keys: KEYS });

    expect((await unsubscribe()).status).toBe(204);
    expect(await subs()).toHaveLength(1);
    expect((await pushConsents()).map((c) => c.granted)).toEqual([true]);

    expect((await unsubscribe("https://push.example/sub/2")).status).toBe(204);
    expect(await subs()).toHaveLength(0);
    const consents = await pushConsents();
    expect(consents.map((c) => ({ granted: c.granted, source: c.source }))).toEqual([
      { granted: true, source: "PROFILE" },
      { granted: false, source: "PROFILE" },
    ]);
    expect((await audits()).map((a) => a.after)).toEqual([
      { fields: ["consents.PUSH"] },
      { fields: ["consents.PUSH"] },
    ]);
  });

  it("unsubscribe someone else's endpoint is a no-op", async () => {
    const bea = await otherCustomer();
    await subscribe(undefined, bea.token);

    expect((await unsubscribe()).status).toBe(204);

    expect(await subs()).toHaveLength(1);
    expect((await pushConsents(bea.id)).map((c) => c.granted)).toEqual([true]);
    // The caller had no subscription and no PUSH consent: nothing is written for them.
    expect(await pushConsents()).toHaveLength(0);
  });

  it("non-https endpoint is 400", async () => {
    const res = await subscribe({ endpoint: "http://push.example/sub/1", keys: KEYS });
    expect(res.status).toBe(400);
    expect(await subs()).toHaveLength(0);
    expect(await pushConsents()).toHaveLength(0);
  });

  it("needs a customer token", async () => {
    expect((await http().post("/v1/me/push-subscriptions").send({ endpoint: ENDPOINT, keys: KEYS })).status).toBe(401);
    expect((await http().delete("/v1/me/push-subscriptions").send({ endpoint: ENDPOINT })).status).toBe(401);
  });

  it("rate limits each customer to 20 calls per hour", async () => {
    for (let i = 0; i < 20; i++) expect((await subscribe()).status).toBe(204);
    const res = await unsubscribe();
    expect(res.status).toBe(429);
    expect(res.body.code).toBe("RATE_LIMITED");
  });

  it("subscribe grants trigger the catch-up for future bookings", async () => {
    const appt = await bookSegment(ctx.prisma, f, { staffUserId: f.staffA, startsAt: "14:00", endsAt: "15:00" });
    await subscribe();

    const [consent] = await pushConsents();
    const job = await queue.getJob(
      sendJobId(
        { appointmentId: appt.id, templateKey: "appointment.confirmed", manageVersion: 0 },
        `grant|PUSH|${consent!.id}`,
      ),
    );
    expect(job?.data).toEqual({
      appointmentId: appt.id,
      templateKey: "appointment.confirmed",
      manageVersion: 0,
      channels: ["PUSH"],
    });

    // A repeat subscribe does not change consent, so no new catch-up.
    await subscribe();
    expect(await queue.count()).toBe(1);
  });

  it("DELETE /me removes subscriptions", async () => {
    const bea = await otherCustomer();
    await ctx.prisma.pushSubscription.createMany({
      data: [
        { organizationId: f.orgId, customerId: f.customerId, endpoint: ENDPOINT, ...KEYS },
        { organizationId: f.orgId, customerId: f.customerId, endpoint: "https://push.example/sub/2", ...KEYS },
        { organizationId: f.orgId, customerId: bea.id, endpoint: "https://push.example/sub/bea", ...KEYS },
      ],
    });

    expect((await http().delete("/v1/me").set(auth(token))).status).toBe(204);

    expect((await subs()).map((s) => s.customerId)).toEqual([bea.id]);
  });

  it("GET /push/public-key is 404 NOT_FOUND when VAPID_PUBLIC_KEY is unset", async () => {
    const res = await http().get("/v1/push/public-key");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });
});

describe("GET /push/public-key with a VAPID key", () => {
  const pair = createECDH("prime256v1");
  pair.generateKeys();
  const publicKey = pair.getPublicKey().toString("base64url");
  let ctx: Awaited<ReturnType<typeof createIntegrationApp>>;

  beforeAll(async () => {
    ctx = await createIntegrationApp({ env: { VAPID_PUBLIC_KEY: publicKey } });
  });
  afterAll(async () => {
    await ctx.close();
  });

  it("returns the public key without auth", async () => {
    const res = await request(ctx.app.getHttpServer()).get("/v1/push/public-key");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ publicKey });
  });
});
