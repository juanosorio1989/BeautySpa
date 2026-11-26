import { describe, expect, it } from "vitest";
import { PushPublicKeySchema, PushSubscriptionInputSchema, PushUnsubscribeInputSchema } from "./push";

const valid = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
  keys: {
    p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
    auth: "tBHItJI5svbpez7KI4CCXg",
  },
};

describe("push contracts", () => {
  it("accepts a browser subscription with an optional consent source", () => {
    expect(PushSubscriptionInputSchema.parse(valid)).toEqual(valid);
    expect(PushSubscriptionInputSchema.parse({ ...valid, consentSource: "BOOKING_FORM" }).consentSource).toBe(
      "BOOKING_FORM",
    );
  });

  it("rejects non-https, over-long or keyless subscriptions", () => {
    expect(PushSubscriptionInputSchema.safeParse({ ...valid, endpoint: "http://push.example/x" }).success).toBe(false);
    expect(PushSubscriptionInputSchema.safeParse({ ...valid, endpoint: "not a url" }).success).toBe(false);
    expect(
      PushSubscriptionInputSchema.safeParse({ ...valid, endpoint: `https://fcm.googleapis.com/${"a".repeat(2048)}` })
        .success,
    ).toBe(false);
    expect(PushSubscriptionInputSchema.safeParse({ ...valid, keys: { p256dh: "", auth: "x" } }).success).toBe(false);
    expect(
      PushSubscriptionInputSchema.safeParse({ ...valid, keys: { p256dh: "x", auth: "a".repeat(101) } }).success,
    ).toBe(false);
    expect(
      PushSubscriptionInputSchema.safeParse({ ...valid, keys: { p256dh: "a".repeat(201), auth: "x" } }).success,
    ).toBe(false);
    expect(PushSubscriptionInputSchema.safeParse({ ...valid, consentSource: "RECEPTION" }).success).toBe(false);
  });

  it("accepts only known push service hosts", () => {
    const ok = (endpoint: string) => PushSubscriptionInputSchema.safeParse({ ...valid, endpoint }).success;
    expect(ok("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(ok("https://updates.push.services.mozilla.com/wpush/v2/abc")).toBe(true);
    expect(ok("https://web.push.apple.com/QGx")).toBe(true);
    expect(ok("https://wns2-par02p.notify.windows.com/w/?token=abc")).toBe(true);
    expect(ok("https://FCM.googleapis.com/fcm/send/abc")).toBe(true);

    expect(ok("https://push.example/sub/1")).toBe(false);
    expect(ok("https://push.apple.com/x")).toBe(false);
    expect(ok("https://notify.windows.com/x")).toBe(false);
    expect(ok("https://evilpush.apple.com/x")).toBe(false);
    expect(ok("https://fcm.googleapis.com.evil.com/x")).toBe(false);
    expect(ok("https://fcm.googleapis.com./x")).toBe(false);
    expect(ok("https://fcm.googleapis.com:8443/fcm/send/abc")).toBe(false);
    expect(ok("https://fcm.googleapis.com:443/fcm/send/abc")).toBe(false);
    expect(ok("https://user@fcm.googleapis.com/x")).toBe(false);
    expect(ok("https://evil.com\\@fcm.googleapis.com/x")).toBe(false);
    expect(ok("https://evil.com\\.push.apple.com/x")).toBe(false);
    expect(ok("https://127.0.0.1/x")).toBe(false);
    expect(ok("https://[::1]/x")).toBe(false);
    expect(ok("https://169.254.169.254/latest/meta-data")).toBe(false);
    expect(ok("http://fcm.googleapis.com/fcm/send/abc")).toBe(false);
  });

  it("unsubscribe endpoint is at most 2048 chars", () => {
    const long = `https://fcm.googleapis.com/fcm/send/${"a".repeat(2048)}`;
    expect(PushUnsubscribeInputSchema.safeParse({ endpoint: long }).success).toBe(false);
  });

  it("unsubscribe takes an endpoint URL; public key is a string", () => {
    expect(PushUnsubscribeInputSchema.parse({ endpoint: valid.endpoint })).toEqual({ endpoint: valid.endpoint });
    expect(PushUnsubscribeInputSchema.safeParse({ endpoint: "nope" }).success).toBe(false);
    expect(PushPublicKeySchema.parse({ publicKey: "BPub" })).toEqual({ publicKey: "BPub" });
  });
});
