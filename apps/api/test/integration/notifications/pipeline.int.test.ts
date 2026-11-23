import { Test, type TestingModule } from "@nestjs/testing";
import type { Queue } from "bullmq";
import type { Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CLOCK } from "../../../src/common/clock.js";
import { ENV, type Env } from "../../../src/config/env.js";
import { MAILER, type MailMessage, type Mailer } from "../../../src/mail/mailer.js";
import { verifyManageToken } from "../../../src/notifications/manage-token.js";
import { MessageContextService } from "../../../src/notifications/message-context.service.js";
import { channelProvidersFactory } from "../../../src/notifications/notifications.module.js";
import { NotificationsProcessor, organizerEmail } from "../../../src/notifications/notifications.processor.js";
import { CHANNEL_PROVIDERS, type ChannelProvider } from "../../../src/notifications/providers/channel-provider.js";
import type { FakePushProvider } from "../../../src/notifications/providers/fake-push.provider.js";
import type { TemplateKey } from "../../../src/notifications/templates/types.js";
import { PrismaService } from "../../../src/prisma/prisma.service.js";
import { NOTIFICATIONS_QUEUE_TOKEN } from "../../../src/queue/queue.module.js";
import { REDIS } from "../../../src/redis/redis.module.js";
import { WorkerModule } from "../../../src/worker/worker.module.js";
import { testEnv } from "../../support/test-env.js";
import { resetState } from "../app.js";
import { BOOKING_NOW, bookSegment, fixedClock, seedBookingFixture, type BookingFixture } from "../helpers.js";
import { testDatabaseUrl, testRedisUrl } from "../setup.js";
import { sendJobId, SEND_JOB_OPTIONS, type SendJob } from "../../../src/queue/queue-names.js";

/** Captures every message; `failWith` makes the next sends reject with that error. */
class CapturingMailer implements Mailer {
  sent: MailMessage[] = [];
  failWith: Error | null = null;
  async send(msg: MailMessage): Promise<{ id?: string }> {
    if (this.failWith) throw this.failWith;
    this.sent.push(msg);
    return { id: `msg-${this.sent.length}` };
  }
}

const EMAIL = "ana@example.test";
const START = new Date("2026-12-01T14:00:00.000Z");

describe("notification pipeline: send and deliver", () => {
  const clock = fixedClock(BOOKING_NOW);
  const mailer = new CapturingMailer();
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let processor: NotificationsProcessor;
  let queue: Queue;
  let push: FakePushProvider;
  let env: Env;
  let f: BookingFixture;
  let apptId: string;

  const send = (templateKey: TemplateKey, manageVersion = 0, channels?: ("EMAIL" | "PUSH")[]) =>
    processor.handleSend({ appointmentId: apptId, templateKey, manageVersion, ...(channels ? { channels } : {}) });
  const rows = () => prisma.notificationLog.findMany({ orderBy: [{ createdAt: "asc" }, { channel: "asc" }] });
  const grant = (channel: "EMAIL" | "PUSH", granted = true) =>
    prisma.notificationConsent.create({
      data: { organizationId: f.orgId, customerId: f.customerId, channel, granted, source: "PROFILE" },
    });

  beforeAll(async () => {
    env = testEnv({ DATABASE_URL: testDatabaseUrl(), REDIS_URL: testRedisUrl() });
    // Not `init()`: no BullMQ Worker consumes, so the tests drive the handlers directly.
    moduleRef = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(ENV)
      .useValue(env)
      .overrideProvider(CLOCK)
      .useValue(clock)
      .overrideProvider(MAILER)
      .useValue(mailer)
      .compile();
    prisma = moduleRef.get(PrismaService);
    processor = moduleRef.get(NotificationsProcessor);
    queue = moduleRef.get<Queue>(NOTIFICATIONS_QUEUE_TOKEN);
    push = moduleRef.get<ChannelProvider[]>(CHANNEL_PROVIDERS).find((p) => p.channel === "PUSH") as FakePushProvider;
  });
  afterAll(async () => {
    await moduleRef.close();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  beforeEach(async () => {
    await resetState(prisma, moduleRef.get<Redis>(REDIS));
    clock.set(BOOKING_NOW);
    mailer.sent = [];
    mailer.failWith = null;
    push.calls.length = 0;
    f = await seedBookingFixture(prisma);
    await prisma.customer.update({ where: { id: f.customerId }, data: { email: EMAIL } });
    await prisma.location.update({
      where: { id: f.locationId },
      data: { address: "1 Main St\nMiami, FL", phone: "+1 305 555 0199" },
    });
    apptId = (await bookSegment(prisma, f, { staffUserId: f.staffA, startsAt: "14:00", endsAt: "15:00" })).id;
  });

  it("confirmed email carries REQUEST ics and manage link", async () => {
    await grant("EMAIL");
    await send("appointment.confirmed");

    const [row] = await rows();
    expect(await rows()).toHaveLength(1);
    expect(row).toMatchObject({
      organizationId: f.orgId,
      appointmentId: apptId,
      customerId: f.customerId,
      templateKey: "appointment.confirmed",
      manageVersion: 0,
      channel: "EMAIL",
      provider: "console",
      locale: "es",
      status: "QUEUED",
      attempts: 0,
    });
    const job = await queue.getJob(`deliver|${row!.id}`);
    expect(job?.name).toBe("deliver");
    expect(job?.data).toEqual({ logId: row!.id });
    expect(job?.opts).toMatchObject({ attempts: 5, backoff: { type: "exponential", delay: 30_000 } });

    await processor.handleDeliver({ logId: row!.id }, 0, 5);

    expect(mailer.sent).toHaveLength(1);
    const mail = mailer.sent[0]!;
    expect(mail.to).toBe(EMAIL);
    expect(mail.html).toBeDefined();
    expect(mail.attachments).toHaveLength(1);
    const ics = mail.attachments![0]!;
    expect(ics.filename).toBe("appointment.ics");
    expect(ics.contentType).toBe("text/calendar; method=REQUEST");
    const unfolded = ics.content.replace(/\r\n /g, "");
    expect(unfolded).toContain("METHOD:REQUEST\r\n");
    expect(unfolded).toContain(`UID:appointment-${apptId}@beautyspa\r\n`);
    expect(unfolded).toContain("SEQUENCE:0\r\n");
    expect(unfolded).toContain("DTSTART:20261201T140000Z\r\n");
    expect(unfolded).toContain("DTEND:20261201T150000Z\r\n");
    expect(unfolded).toContain("SUMMARY:Pedicura — Test Salon\r\n");
    expect(unfolded).toContain("LOCATION:1 Main St\\, Miami\\, FL\r\n");
    expect(unfolded).toContain("Alex");
    expect(unfolded).toContain("+1 305 555 0199");
    expect(unfolded).toContain("ORGANIZER:mailto:no-reply@localhost\r\n");
    expect(unfolded).toContain(`ATTENDEE;RSVP=FALSE:mailto:${EMAIL}\r\n`);
    expect(unfolded).toContain("STATUS:CONFIRMED\r\n");

    const link = /http:\/\/localhost:3000\/es\/manage\/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/.exec(mail.text);
    expect(link).not.toBeNull();
    expect(unfolded).toContain(link![0]);
    expect(verifyManageToken(env.MANAGE_LINK_SECRET, link![1]!, BOOKING_NOW)).toEqual({
      appointmentId: apptId,
      manageVersion: 0,
      exp: START.getTime() / 1000,
    });

    const sent = await prisma.notificationLog.findUniqueOrThrow({ where: { id: row!.id } });
    expect(sent).toMatchObject({ status: "SENT", providerMessageId: "msg-1", attempts: 1, error: null });
    expect(sent.sentAt?.getTime()).toBe(BOOKING_NOW);
  });

  it("same send twice writes one row and one email", async () => {
    await grant("EMAIL");
    await send("appointment.confirmed");
    await send("appointment.confirmed");
    const all = await rows();
    expect(all).toHaveLength(1);
    await processor.handleDeliver({ logId: all[0]!.id }, 0, 5);
    await processor.handleDeliver({ logId: all[0]!.id }, 0, 5);
    expect(mailer.sent).toHaveLength(1);
    expect(await queue.count()).toBe(1);
  });

  it("stale manageVersion sends nothing", async () => {
    await grant("EMAIL");
    await prisma.appointment.update({ where: { id: apptId }, data: { manageVersion: 2 } });
    await send("appointment.changed", 1);
    expect(await rows()).toHaveLength(0);

    // A row written at version 2, then a newer reschedule before delivery: skipped as stale.
    await send("appointment.changed", 2);
    const [row] = await rows();
    await prisma.appointment.update({ where: { id: apptId }, data: { manageVersion: 3 } });
    await processor.handleDeliver({ logId: row!.id }, 0, 5);
    expect(mailer.sent).toHaveLength(0);
    expect(await prisma.notificationLog.findUniqueOrThrow({ where: { id: row!.id } })).toMatchObject({
      status: "SKIPPED",
      error: "stale",
    });
  });

  it("cancelled email carries CANCEL ics with higher SEQUENCE", async () => {
    await grant("EMAIL");
    await send("appointment.confirmed");
    await processor.handleDeliver({ logId: (await rows())[0]!.id }, 0, 5);

    await prisma.appointment.update({
      where: { id: apptId },
      data: { status: "CANCELLED", manageVersion: 1, cancelledAt: new Date(BOOKING_NOW), cancelledBy: "CUSTOMER" },
    });
    // A late `confirmed` job for the old version does nothing.
    await send("appointment.confirmed", 0);
    await send("appointment.cancelled", 1);
    const cancelRow = (await rows()).find((r) => r.templateKey === "appointment.cancelled");
    expect(cancelRow).toBeDefined();
    await processor.handleDeliver({ logId: cancelRow!.id }, 0, 5);

    expect(mailer.sent).toHaveLength(2);
    const mail = mailer.sent[1]!;
    const ics = mail.attachments![0]!;
    expect(ics.contentType).toBe("text/calendar; method=CANCEL");
    expect(ics.content).toContain("METHOD:CANCEL\r\n");
    expect(ics.content).toContain("STATUS:CANCELLED\r\n");
    expect(ics.content).toContain("SEQUENCE:1\r\n");
    expect(ics.content).toContain(`UID:appointment-${apptId}@beautyspa\r\n`);
    expect(ics.content).toContain("ORGANIZER:mailto:no-reply@localhost\r\n");
    expect(mail.text).toContain("http://localhost:3000/es/book");
    expect(mail.text).not.toContain("/manage/");
  });

  it("no consent writes no row", async () => {
    await send("appointment.confirmed");
    await grant("EMAIL");
    await grant("EMAIL", false);
    await send("appointment.changed");
    expect(await rows()).toHaveLength(0);
    expect(await queue.count()).toBe(0);
  });

  it("consent revoked between send and deliver marks SKIPPED", async () => {
    await grant("EMAIL");
    await send("appointment.confirmed");
    const [row] = await rows();
    await grant("EMAIL", false);
    await processor.handleDeliver({ logId: row!.id }, 0, 5);
    expect(mailer.sent).toHaveLength(0);
    expect(await prisma.notificationLog.findUniqueOrThrow({ where: { id: row!.id } })).toMatchObject({
      status: "SKIPPED",
      attempts: 0,
    });
  });

  it("provider error retries then FAILED with resend_500", async () => {
    await grant("EMAIL");
    await send("appointment.confirmed");
    const [row] = await rows();
    mailer.failWith = new Error("Resend send failed: 500");

    await expect(processor.handleDeliver({ logId: row!.id }, 0, 5)).rejects.toThrow("Resend send failed: 500");
    expect(await prisma.notificationLog.findUniqueOrThrow({ where: { id: row!.id } })).toMatchObject({
      status: "QUEUED",
      attempts: 1,
      error: "resend_500",
    });

    await expect(processor.handleDeliver({ logId: row!.id }, 4, 5)).rejects.toThrow();
    const failed = await prisma.notificationLog.findUniqueOrThrow({ where: { id: row!.id } });
    expect(failed).toMatchObject({ status: "FAILED", attempts: 2, error: "resend_500", sentAt: null });

    // A FAILED row is final: a stray retry sends nothing.
    mailer.failWith = null;
    await processor.handleDeliver({ logId: row!.id }, 4, 5);
    expect(mailer.sent).toHaveLength(0);
  });

  it("push consented with subscription delivers on PUSH too", async () => {
    await grant("EMAIL");
    await grant("PUSH");
    // PUSH consent without a subscription: EMAIL only.
    await send("appointment.reminder_24h");
    expect((await rows()).map((r) => r.channel)).toEqual(["EMAIL"]);

    await prisma.pushSubscription.create({
      data: {
        organizationId: f.orgId,
        customerId: f.customerId,
        endpoint: "https://push.example.test/abc",
        p256dh: "key",
        auth: "auth",
      },
    });
    await send("appointment.reminder_2h");
    const reminder = (await rows()).filter((r) => r.templateKey === "appointment.reminder_2h");
    expect(reminder.map((r) => r.channel).sort()).toEqual(["EMAIL", "PUSH"]);
    const pushRow = reminder.find((r) => r.channel === "PUSH")!;
    expect(pushRow.provider).toBe("fake");

    for (const r of reminder) await processor.handleDeliver({ logId: r.id }, 0, 5);
    expect(push.calls).toHaveLength(1);
    expect(push.calls[0]!.target).toMatchObject({ customerId: f.customerId, templateKey: "appointment.reminder_2h" });
    expect(push.calls[0]!.target.ics).toBeUndefined();
    expect(push.calls[0]!.msg.push.url).toContain("http://localhost:3000/es/manage/");
    // Reminders carry no calendar attachment.
    expect(mailer.sent.at(-1)!.attachments).toBeUndefined();
    expect(await prisma.notificationLog.findUniqueOrThrow({ where: { id: pushRow.id } })).toMatchObject({
      status: "SENT",
      attempts: 1,
    });
  });

  it("deleted customer gets nothing", async () => {
    await grant("EMAIL");
    await prisma.customer.update({ where: { id: f.customerId }, data: { deletedAt: new Date(BOOKING_NOW) } });
    await send("appointment.confirmed");
    expect(await rows()).toHaveLength(0);

    // Deleted after the row was written: delivery is skipped.
    await prisma.customer.update({ where: { id: f.customerId }, data: { deletedAt: null } });
    await send("appointment.confirmed");
    const [row] = await rows();
    await prisma.customer.update({ where: { id: f.customerId }, data: { deletedAt: new Date(BOOKING_NOW) } });
    await processor.handleDeliver({ logId: row!.id }, 0, 5);
    expect(mailer.sent).toHaveLength(0);
    expect((await prisma.notificationLog.findUniqueOrThrow({ where: { id: row!.id } })).status).toBe("SKIPPED");
  });

  it("a failure before the send marks the row FAILED on the last attempt", async () => {
    await grant("EMAIL");
    await send("appointment.confirmed");
    const [row] = await rows();
    const load = vi.spyOn(moduleRef.get(MessageContextService), "load").mockRejectedValue(new Error("db down"));

    await expect(processor.handleDeliver({ logId: row!.id }, 0, 5)).rejects.toThrow("db down");
    expect(await prisma.notificationLog.findUniqueOrThrow({ where: { id: row!.id } })).toMatchObject({
      status: "QUEUED",
      attempts: 0,
      error: null,
    });

    await expect(processor.handleDeliver({ logId: row!.id }, 4, 5)).rejects.toThrow("db down");
    expect(await prisma.notificationLog.findUniqueOrThrow({ where: { id: row!.id } })).toMatchObject({
      status: "FAILED",
      attempts: 1,
      error: "unknown",
    });
    expect(load).toHaveBeenCalledTimes(2);
    expect(mailer.sent).toHaveLength(0);
  });

  it("a failed SENT update after the provider accepted is not recorded as a provider error", async () => {
    await grant("EMAIL");
    // A reminder carries no .ics, so the first clock read in deliver is the SENT update's `sentAt`:
    // throwing there simulates the SENT write failing after the provider accepted the message.
    await send("appointment.reminder_24h");
    const [row] = await rows();
    const now = vi.spyOn(clock, "now").mockImplementationOnce(() => {
      throw new Error("db down");
    });

    await expect(processor.handleDeliver({ logId: row!.id }, 4, 5)).rejects.toThrow("db down");
    expect(now).toHaveBeenCalledTimes(1);
    expect(mailer.sent).toHaveLength(1);
    expect(await prisma.notificationLog.findUniqueOrThrow({ where: { id: row!.id } })).toMatchObject({
      status: "QUEUED",
      attempts: 0,
      error: null,
    });
  });

  it("render failure is FAILED render_failed without retry", async () => {
    await grant("EMAIL");
    // A line break in the attendee address makes the .ics builder refuse it.
    await prisma.customer.update({ where: { id: f.customerId }, data: { email: "ana@example.test\nX" } });
    await send("appointment.confirmed");
    const [row] = await rows();
    await processor.handleDeliver({ logId: row!.id }, 0, 5);
    expect(mailer.sent).toHaveLength(0);
    expect(await prisma.notificationLog.findUniqueOrThrow({ where: { id: row!.id } })).toMatchObject({
      status: "FAILED",
      attempts: 1,
      error: "render_failed",
    });
  });

  it("email removed before delivery is skipped as no_email", async () => {
    await grant("EMAIL");
    await send("appointment.confirmed");
    const [row] = await rows();
    await prisma.customer.update({ where: { id: f.customerId }, data: { email: null } });
    await processor.handleDeliver({ logId: row!.id }, 0, 5);
    expect(mailer.sent).toHaveLength(0);
    expect(await prisma.notificationLog.findUniqueOrThrow({ where: { id: row!.id } })).toMatchObject({
      status: "SKIPPED",
      error: "no_email",
      attempts: 0,
    });
  });

  it("a retried send re-adds a missing deliver job for a still QUEUED row", async () => {
    await grant("EMAIL");
    await send("appointment.confirmed");
    const [row] = await rows();
    await (await queue.getJob(`deliver|${row!.id}`))!.remove();
    expect(await queue.getJob(`deliver|${row!.id}`)).toBeUndefined();

    await send("appointment.confirmed");
    expect(await rows()).toHaveLength(1);
    expect((await queue.getJob(`deliver|${row!.id}`))?.data).toEqual({ logId: row!.id });

    // Once SENT, a later send adds nothing.
    await processor.handleDeliver({ logId: row!.id }, 0, 5);
    await (await queue.getJob(`deliver|${row!.id}`))!.remove();
    await send("appointment.confirmed");
    expect(await queue.getJob(`deliver|${row!.id}`)).toBeUndefined();
  });

  it("renders in the row locale even if the customer locale changed", async () => {
    await grant("EMAIL");
    await send("appointment.confirmed");
    const [row] = await rows();
    expect(row!.locale).toBe("es");
    await prisma.customer.update({ where: { id: f.customerId }, data: { locale: "en" } });
    await processor.handleDeliver({ logId: row!.id }, 0, 5);
    expect(mailer.sent[0]!.text).toContain("http://localhost:3000/es/manage/");
    expect(mailer.sent[0]!.text).toContain("Pedicura");
  });

  it("staff cancelReason never appears in the email", async () => {
    await grant("EMAIL");
    await prisma.appointment.update({
      where: { id: apptId },
      data: {
        status: "CANCELLED",
        manageVersion: 1,
        cancelledAt: new Date(BOOKING_NOW),
        cancelledBy: "STAFF",
        cancelReason: "SECRET-STAFF-REASON",
        notes: "SECRET-NOTE",
      },
    });
    await send("appointment.cancelled", 1);
    await processor.handleDeliver({ logId: (await rows())[0]!.id }, 0, 5);
    expect(mailer.sent).toHaveLength(1);
    const mail = mailer.sent[0]!;
    const all = [mail.subject, mail.text, mail.html ?? "", ...(mail.attachments ?? []).map((a) => a.content)].join(
      "\n",
    );
    expect(all).not.toContain("SECRET-STAFF-REASON");
    expect(all).not.toContain("SECRET-NOTE");
  });
});

describe("notification pipeline: through a real BullMQ worker", () => {
  it("a send job is routed and delivered by the worker", async () => {
    const mailer = new CapturingMailer();
    const env = testEnv({ DATABASE_URL: testDatabaseUrl(), REDIS_URL: testRedisUrl() });
    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(ENV)
      .useValue(env)
      .overrideProvider(CLOCK)
      .useValue(fixedClock(BOOKING_NOW))
      .overrideProvider(MAILER)
      .useValue(mailer)
      .compile();
    try {
      const prisma = moduleRef.get(PrismaService);
      await resetState(prisma, moduleRef.get<Redis>(REDIS));
      await moduleRef.init();
      const f = await seedBookingFixture(prisma);
      await prisma.customer.update({ where: { id: f.customerId }, data: { email: EMAIL } });
      await prisma.notificationConsent.create({
        data: { organizationId: f.orgId, customerId: f.customerId, channel: "EMAIL", granted: true, source: "PROFILE" },
      });
      const { id } = await bookSegment(prisma, f, { staffUserId: f.staffA, startsAt: "14:00", endsAt: "15:00" });
      const job: SendJob = { appointmentId: id, templateKey: "appointment.confirmed", manageVersion: 0 };
      await moduleRef
        .get<Queue>(NOTIFICATIONS_QUEUE_TOKEN)
        .add("send", job, { ...SEND_JOB_OPTIONS, jobId: sendJobId(job) });

      const deadline = Date.now() + 10_000;
      let status: string | undefined;
      while (Date.now() < deadline) {
        status = (await prisma.notificationLog.findFirst({ where: { appointmentId: id } }))?.status;
        if (status === "SENT") break;
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(status).toBe("SENT");
      expect(mailer.sent).toHaveLength(1);
      expect(mailer.sent[0]!.attachments?.[0]?.contentType).toBe("text/calendar; method=REQUEST");
    } finally {
      await moduleRef.close();
    }
  });
});

describe("notification providers and organizer", () => {
  it("organizer is the address part of EMAIL_FROM, else no-reply at the web host", () => {
    expect(organizerEmail({ EMAIL_FROM: "Glow Spa <hi@glow.test>", WEB_ORIGIN: "https://x.test" })).toBe(
      "hi@glow.test",
    );
    expect(organizerEmail({ EMAIL_FROM: "hi@glow.test", WEB_ORIGIN: "https://x.test" })).toBe("hi@glow.test");
    expect(organizerEmail({ EMAIL_FROM: undefined, WEB_ORIGIN: "https://book.glow.test:8443" })).toBe(
      "no-reply@book.glow.test",
    );
  });

  it("PUSH_PROVIDER binds fake or console and refuses webpush until it exists", () => {
    const mailer = new CapturingMailer();
    const names = (e: Env) => channelProvidersFactory(e, mailer).map((p) => `${p.channel}:${p.name}`);
    expect(names(testEnv({ PUSH_PROVIDER: "fake" }))).toEqual(["EMAIL:console", "PUSH:fake"]);
    expect(names(testEnv({ PUSH_PROVIDER: "console" }))).toEqual(["EMAIL:console", "PUSH:console"]);
    const webpush = testEnv({
      PUSH_PROVIDER: "webpush",
      VAPID_PUBLIC_KEY: "pub",
      VAPID_PRIVATE_KEY: "priv",
      VAPID_SUBJECT: "mailto:ops@x.test",
    });
    expect(() => channelProvidersFactory(webpush, mailer)).toThrow(/webpush is not implemented/);
  });
});
