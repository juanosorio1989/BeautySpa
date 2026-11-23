import { randomUUID } from "node:crypto";
import type { Queue } from "bullmq";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ManageView } from "@beautyspa/contracts";
import { CLOCK } from "../../../src/common/clock.js";
import { ENV, type Env } from "../../../src/config/env.js";
import { signManageToken } from "../../../src/notifications/manage-token.js";
import { NOTIFICATIONS_QUEUE_TOKEN } from "../../../src/queue/queue.module.js";
import { sendJobId, type SendJob } from "../../../src/queue/queue-names.js";
import { createIntegrationApp, resetState, resetTenancyCache } from "../app.js";
import { BOOKING_NOW, bookSegment, fixedClock, seedBookingFixture, type BookingFixture } from "../helpers.js";

const HOUR = 3_600_000;
/** `bookSegment` 14:00-15:00Z on 2026-12-01: 26 h after `BOOKING_NOW`, inside the default 24 h window. */
const START = Date.parse("2026-12-01T14:00:00.000Z");

describe("manage link: GET /manage/:token, confirm, cancel, calendar.ics", () => {
  const clock = fixedClock(BOOKING_NOW);
  let ctx: Awaited<ReturnType<typeof createIntegrationApp>>;
  let env: Env;
  let queue: Queue;
  let f: BookingFixture;

  const http = () => request(ctx.app.getHttpServer());
  const tokenFor = (appointmentId: string, manageVersion = 0, exp = Math.floor(START / 1000)) =>
    signManageToken(env.MANAGE_LINK_SECRET, { appointmentId, manageVersion, exp });
  const seed = async () =>
    (await bookSegment(ctx.prisma, f, { staffUserId: f.staffA, startsAt: "14:00", endsAt: "15:00" })).id;
  const auditCount = (action: string, entityId: string) => ctx.prisma.auditLog.count({ where: { action, entityId } });

  beforeAll(async () => {
    ctx = await createIntegrationApp({ override: (b) => b.overrideProvider(CLOCK).useValue(clock) });
    env = ctx.app.get<Env>(ENV);
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
    await ctx.prisma.location.update({
      where: { id: f.locationId },
      data: { address: "1 Main St\nMiami, FL 33101", phone: "+13055550000" },
    });
  });

  it("view returns appointment, location and flags", async () => {
    const id = await seed();
    const res = await http().get(`/v1/manage/${tokenFor(id)}`);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    const view = res.body as ManageView;
    expect(view.appointment).toMatchObject({ id, status: "BOOKED", startsAt: new Date(START).toISOString() });
    expect(view.location).toEqual({
      name: "Main",
      addressLine: "1 Main St, Miami, FL 33101",
      phone: "+13055550000",
      timezone: "America/New_York",
    });
    expect(view.canCancel).toBe(true);
    expect(view.canConfirm).toBe(true);
  });

  it("stale, tampered and expired tokens are indistinguishable", async () => {
    const id = await seed();
    await ctx.prisma.appointment.update({ where: { id }, data: { manageVersion: 1 } });
    const valid = tokenFor(id, 1);
    const [payload, sig] = valid.split(".") as [string, string];
    const tampered = `${payload}.${sig.startsWith("A") ? "B" : "A"}${sig.slice(1)}`;

    // An appointment of another organization, signed with the same secret.
    const org2 = await ctx.prisma.organization.create({ data: { name: "Other", slug: "other", defaultLocale: "en" } });
    const loc2 = await ctx.prisma.location.create({
      data: { organizationId: org2.id, name: "Other", timezone: "America/New_York", settings: {} },
    });
    const other = await ctx.prisma.appointment.create({
      data: {
        organizationId: org2.id,
        locationId: loc2.id,
        status: "BOOKED",
        source: "RECEPTION",
        timesSetAt: new Date(BOOKING_NOW),
        segments: {
          create: {
            organizationId: org2.id,
            serviceId: f.serviceId,
            staffUserId: f.staffA,
            startsAt: new Date(START),
            endsAt: new Date(START + HOUR),
            blockEndsAt: new Date(START + HOUR),
            durationMin: 60,
            priceCents: 4000,
            occupies: false,
          },
        },
      },
    });
    const held = await bookSegment(ctx.prisma, f, { staffUserId: f.staffB, startsAt: "16:00", endsAt: "17:00" });
    await ctx.prisma.appointment.update({ where: { id: held.id }, data: { status: "HELD" } });

    const bad = [
      tokenFor(id, 0), // stale version
      tampered,
      "not-a-token",
      tokenFor(randomUUID(), 0), // unknown id
      tokenFor(other.id, 0), // other organization
      tokenFor(held.id, 0), // HELD
    ];
    clock.set(START); // and the valid one is now expired
    bad.push(valid);

    const answers = await Promise.all(bad.map((t) => http().get(`/v1/manage/${t}`)));
    for (const res of answers) {
      expect(res.status).toBe(404);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.body).toEqual(answers[0]!.body);
    }
    expect(answers[0]!.body).toMatchObject({ code: "NOT_FOUND" });
  });

  it("confirm sets confirmedByCustomerAt once and audits once", async () => {
    const id = await seed();
    const token = tokenFor(id);
    const first = await http().post(`/v1/manage/${token}/confirm`).send({});
    expect(first.status).toBe(200);
    expect(first.headers["cache-control"]).toBe("no-store");
    expect((first.body as ManageView).appointment.confirmedByCustomerAt).toBe(new Date(BOOKING_NOW).toISOString());
    expect((first.body as ManageView).canConfirm).toBe(false);

    clock.set(BOOKING_NOW + HOUR);
    const second = await http().post(`/v1/manage/${token}/confirm`).send({});
    expect(second.status).toBe(200);
    expect((second.body as ManageView).appointment.confirmedByCustomerAt).toBe(new Date(BOOKING_NOW).toISOString());

    const row = await ctx.prisma.appointment.findUniqueOrThrow({ where: { id } });
    expect(row.manageVersion).toBe(0);
    expect(await auditCount("appointment.confirm", id)).toBe(1);
    const audit = await ctx.prisma.auditLog.findFirstOrThrow({ where: { action: "appointment.confirm" } });
    expect(audit).toMatchObject({ actorType: "CUSTOMER", actorId: f.customerId, entity: "appointment" });
    expect(await queue.count()).toBe(0);
  });

  it("confirm on cancelled is 409", async () => {
    const id = await seed();
    await ctx.prisma.appointment.update({
      where: { id },
      data: { status: "CANCELLED", cancelledAt: new Date(BOOKING_NOW), cancelledBy: "SYSTEM" },
    });
    const res = await http()
      .post(`/v1/manage/${tokenFor(id)}/confirm`)
      .send({});
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "CONFLICT" });
    expect(await auditCount("appointment.confirm", id)).toBe(0);
  });

  it("cancel inside window cancels, bumps manageVersion and enqueues appointment.cancelled", async () => {
    const id = await seed();
    const res = await http()
      .post(`/v1/manage/${tokenFor(id)}/cancel`)
      .send({ reason: "Sick" });
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const view = res.body as ManageView;
    expect(view.appointment).toMatchObject({ id, status: "CANCELLED", cancelReason: "Sick" });
    expect(view.canCancel).toBe(false);
    expect(view.canConfirm).toBe(false);

    const row = await ctx.prisma.appointment.findUniqueOrThrow({ where: { id }, include: { segments: true } });
    expect(row).toMatchObject({ status: "CANCELLED", cancelledBy: "CUSTOMER", manageVersion: 1 });
    expect(row.segments.every((s) => !s.occupies)).toBe(true);
    const audit = await ctx.prisma.auditLog.findFirstOrThrow({ where: { action: "appointment.cancel", entityId: id } });
    expect(audit).toMatchObject({ actorType: "CUSTOMER", actorId: f.customerId });

    const expected: SendJob = { appointmentId: id, templateKey: "appointment.cancelled", manageVersion: 1 };
    const job = await queue.getJob(sendJobId(expected));
    expect(job?.data).toEqual(expected);
  });

  it("old token 404 after cancel", async () => {
    const id = await seed();
    const token = tokenFor(id);
    expect((await http().post(`/v1/manage/${token}/cancel`).send({})).status).toBe(200);
    const res = await http().get(`/v1/manage/${token}`);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: "NOT_FOUND" });
    expect((await http().post(`/v1/manage/${token}/cancel`).send({})).status).toBe(404);
  });

  it("cancel outside window is 409 OUTSIDE_CANCEL_WINDOW", async () => {
    const id = await seed();
    clock.set(START - 2 * HOUR);
    const view = await http().get(`/v1/manage/${tokenFor(id)}`);
    expect((view.body as ManageView).canCancel).toBe(false);
    expect((view.body as ManageView).canConfirm).toBe(true);

    const res = await http()
      .post(`/v1/manage/${tokenFor(id)}/cancel`)
      .send({});
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "OUTSIDE_CANCEL_WINDOW" });
    const row = await ctx.prisma.appointment.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: "BOOKED", manageVersion: 0 });
    expect(await queue.count()).toBe(0);
  });

  it("calendar.ics is PUBLISH with no-store", async () => {
    const id = await seed();
    const res = await http().get(`/v1/manage/${tokenFor(id)}/calendar.ics`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("text/calendar; charset=utf-8");
    expect(res.headers["content-disposition"]).toBe('attachment; filename="appointment.ics"');
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    const ics = res.text;
    expect(ics).toContain("METHOD:PUBLISH\r\n");
    expect(ics).toContain(`UID:appointment-${id}@beautyspa\r\n`);
    expect(ics).toContain("SEQUENCE:0\r\n");
    expect(ics).toContain("DTSTART:20261201T140000Z\r\n");
    expect(ics).toContain("STATUS:CONFIRMED\r\n");
    expect(ics).not.toContain("ORGANIZER");
    expect(ics).not.toContain("ATTENDEE");
    // The customer's locale is `es`.
    expect(ics).toContain("SUMMARY:Pedicura — Test Salon\r\n");
  });

  it("deleted customer token is 404", async () => {
    const id = await seed();
    await ctx.prisma.customer.update({ where: { id: f.customerId }, data: { deletedAt: new Date(BOOKING_NOW) } });
    for (const res of [
      await http().get(`/v1/manage/${tokenFor(id)}`),
      await http()
        .post(`/v1/manage/${tokenFor(id)}/confirm`)
        .send({}),
      await http()
        .post(`/v1/manage/${tokenFor(id)}/cancel`)
        .send({}),
      await http().get(`/v1/manage/${tokenFor(id)}/calendar.ics`),
    ]) {
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ code: "NOT_FOUND" });
    }
    expect((await ctx.prisma.appointment.findUniqueOrThrow({ where: { id } })).status).toBe("BOOKED");
  });

  it("rate limit 31st request is 429", async () => {
    const id = await seed();
    for (let i = 0; i < 30; i++) {
      // Invalid tokens count too.
      const res = await http().get(`/v1/manage/${i % 2 === 0 ? "bad" : tokenFor(id)}`);
      expect(res.status).not.toBe(429);
    }
    const res = await http().get(`/v1/manage/${tokenFor(id)}`);
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ code: "RATE_LIMITED" });
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("staff cancelReason is null in the view", async () => {
    const id = await seed();
    await ctx.prisma.appointment.update({
      where: { id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(BOOKING_NOW),
        cancelledBy: "STAFF",
        cancelReason: "Internal remark",
        manageVersion: 1,
      },
    });
    const res = await http().get(`/v1/manage/${tokenFor(id, 1)}`);
    expect(res.status).toBe(200);
    const view = res.body as ManageView;
    expect(view.appointment).toMatchObject({ status: "CANCELLED", cancelReason: null });
    expect(view.canCancel).toBe(false);
    expect(view.canConfirm).toBe(false);
  });
});
