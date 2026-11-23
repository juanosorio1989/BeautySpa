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
      PushSubscriptionInputSchema.safeParse({ ...valid, endpoint: `https://push.example/${"a".repeat(2048)}` }).success,
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

  it("unsubscribe takes an endpoint URL; public key is a string", () => {
    expect(PushUnsubscribeInputSchema.parse({ endpoint: valid.endpoint })).toEqual({ endpoint: valid.endpoint });
    expect(PushUnsubscribeInputSchema.safeParse({ endpoint: "nope" }).success).toBe(false);
    expect(PushPublicKeySchema.parse({ publicKey: "BPub" })).toEqual({ publicKey: "BPub" });
  });
});
