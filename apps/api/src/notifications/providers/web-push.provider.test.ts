import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebPushError } from "web-push";
import { errorCode } from "../error-code.js";
import type { RenderedMessage, TemplateKey } from "../templates/types.js";
import { PushError, type DeliveryTarget } from "./channel-provider.js";
import { PUSH_TIMEOUT_MS, WebPushProvider } from "./web-push.provider.js";

const { sendNotification } = vi.hoisted(() => ({ sendNotification: vi.fn() }));
vi.mock("web-push", async () => {
  const actual = await vi.importActual<typeof import("web-push")>("web-push");
  return { default: { ...actual, sendNotification }, WebPushError: actual.WebPushError };
});

const NOW = Date.parse("2026-11-30T12:00:00.000Z");
const VAPID = { subject: "mailto:owner@example.com", publicKey: "BPub", privateKey: "priv" };
const msg = {
  subject: "s",
  html: "<p>h</p>",
  text: "t",
  push: { title: "Confirmed", body: "Tue 9:00", url: "https://salon.example/m/x" },
} as unknown as RenderedMessage;

const sub = (id: string) => ({ id, endpoint: `https://push.example/${id}`, p256dh: `p-${id}`, auth: `a-${id}` });
const pushError = (status: number) => new WebPushError("Received unexpected response code", status, {}, "body", "e");

function setup(subs: ReturnType<typeof sub>[]) {
  const db = {
    pushSubscription: {
      findMany: vi.fn().mockResolvedValue(subs),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const provider = new WebPushProvider(db as never, { now: () => NOW }, VAPID);
  return { db, provider };
}

const target = (templateKey: TemplateKey = "appointment.confirmed"): DeliveryTarget => ({
  organizationId: "org-1",
  customerId: "cust-1",
  email: null,
  templateKey,
});

describe("WebPushProvider", () => {
  beforeEach(() => {
    sendNotification.mockReset();
  });

  it("410 deletes the subscription and tries the next", async () => {
    const { db, provider } = setup([sub("a"), sub("b")]);
    sendNotification.mockRejectedValueOnce(pushError(410)).mockResolvedValueOnce({ statusCode: 201 });

    await expect(provider.send(msg, target())).resolves.toEqual({});

    expect(provider.channel).toBe("PUSH");
    expect(provider.name).toBe("webpush");
    expect(db.pushSubscription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org-1", customerId: "cust-1" } }),
    );
    expect(sendNotification).toHaveBeenCalledTimes(2);
    expect(sendNotification).toHaveBeenNthCalledWith(
      1,
      { endpoint: "https://push.example/a", keys: { p256dh: "p-a", auth: "a-a" } },
      JSON.stringify(msg.push),
      { TTL: 86_400, urgency: "normal", vapidDetails: VAPID, timeout: 10_000 },
    );
    expect(db.pushSubscription.deleteMany).toHaveBeenCalledWith({ where: { id: "a", organizationId: "org-1" } });
    expect(db.pushSubscription.updateMany).toHaveBeenCalledWith({
      where: { id: "b", organizationId: "org-1" },
      data: { lastSuccessAt: new Date(NOW) },
    });
  });

  it("404 also deletes; other errors keep the row", async () => {
    const { db, provider } = setup([sub("a"), sub("b"), sub("c")]);
    sendNotification
      .mockRejectedValueOnce(pushError(404))
      .mockRejectedValueOnce(pushError(500))
      .mockResolvedValueOnce({ statusCode: 201 });

    await provider.send(msg, target());

    expect(db.pushSubscription.deleteMany).toHaveBeenCalledTimes(1);
    expect(db.pushSubscription.deleteMany).toHaveBeenCalledWith({ where: { id: "a", organizationId: "org-1" } });
    expect(db.pushSubscription.updateMany).toHaveBeenCalledTimes(1);
  });

  it("all fail throws push_<status>", async () => {
    const { db, provider } = setup([sub("a"), sub("b")]);
    sendNotification.mockRejectedValueOnce(pushError(410)).mockRejectedValueOnce(pushError(503));

    const err = await provider.send(msg, target()).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PushError);
    expect(errorCode(err)).toBe("push_503");
    expect(db.pushSubscription.updateMany).not.toHaveBeenCalled();
  });

  it("a network error without a status counts as push_0", async () => {
    const { provider } = setup([sub("a")]);
    sendNotification.mockRejectedValueOnce(new Error("socket hang up https://push.example/a"));

    const err = await provider.send(msg, target()).catch((e: unknown) => e);

    expect(errorCode(err)).toBe("push_0");
    expect((err as Error).message).not.toContain("push.example");
  });

  it("no subscriptions throws push_none", async () => {
    const { provider } = setup([]);

    const err = await provider.send(msg, target()).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PushError);
    expect(errorCode(err)).toBe("push_none");
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("every send has a 10 s timeout", async () => {
    const { provider } = setup([sub("a"), sub("b")]);
    sendNotification.mockResolvedValue({ statusCode: 201 });

    await provider.send(msg, target());

    expect(PUSH_TIMEOUT_MS).toBe(10_000);
    for (const call of sendNotification.mock.calls) expect(call[2]).toMatchObject({ timeout: 10_000 });
  });

  it("2h reminder uses urgency high", async () => {
    const { provider } = setup([sub("a")]);
    sendNotification.mockResolvedValue({ statusCode: 201 });

    await provider.send(msg, target("appointment.reminder_2h"));
    await provider.send(msg, target("appointment.reminder_24h"));

    expect(sendNotification.mock.calls[0]![2]).toMatchObject({ TTL: 86_400, urgency: "high" });
    expect(sendNotification.mock.calls[1]![2]).toMatchObject({ urgency: "normal" });
  });
});

describe("WebPushProvider bookkeeping", () => {
  beforeEach(() => {
    sendNotification.mockReset();
  });

  it("a failed last_success_at update does not fail a delivered push", async () => {
    const { db, provider } = setup([sub("a")]);
    sendNotification.mockResolvedValue({ statusCode: 201 });
    db.pushSubscription.updateMany.mockRejectedValue(new Error("db down"));

    await expect(provider.send(msg, target())).resolves.toEqual({});
  });
});
