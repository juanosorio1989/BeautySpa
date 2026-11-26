import { z } from "zod";

/** Push service hosts the API may send to (the worker POSTs to the endpoint: anything else would be blind SSRF). */
export const PUSH_SERVICE_HOSTS = ["fcm.googleapis.com", "updates.push.services.mozilla.com"] as const;
/** Push service host suffixes: any subdomain (not the bare domain) is allowed. */
export const PUSH_SERVICE_HOST_SUFFIXES = [".push.apple.com", ".notify.windows.com"] as const;

/**
 * True when `endpoint` is `https://<host>/…` with a known push service host: no port, no user info, no IP literal.
 * Parsed by hand (no `URL` type in platform packages): the authority must be plain DNS characters only, so `\`,
 * `@`, `:` and `[` (tricks a URL parser could resolve to another host) are rejected outright.
 */
export function isPushServiceEndpoint(endpoint: string): boolean {
  const match = /^https:\/\/([^/?#]*)/.exec(endpoint);
  const authority = match?.[1];
  if (authority === undefined || !/^[A-Za-z0-9.-]+$/.test(authority)) return false;
  const host = authority.toLowerCase();
  if (/^[0-9.]+$/.test(host)) return false;
  return (
    (PUSH_SERVICE_HOSTS as readonly string[]).includes(host) ||
    PUSH_SERVICE_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix) && host.length > suffix.length)
  );
}

/**
 * `POST /me/push-subscriptions`: a browser `PushSubscription` and where the consent was given. The endpoint must be
 * on a known push service (`isPushServiceEndpoint`).
 */
export const PushSubscriptionInputSchema = z.object({
  endpoint: z
    .string()
    .url()
    .max(2048)
    .refine(isPushServiceEndpoint, { message: "Endpoint is not a known push service" }),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
  /** The API defaults to `PROFILE`. */
  consentSource: z.enum(["PROFILE", "BOOKING_FORM"]).optional(),
});
export type PushSubscriptionInput = z.infer<typeof PushSubscriptionInputSchema>;

/** `DELETE /me/push-subscriptions`. */
export const PushUnsubscribeInputSchema = z.object({ endpoint: z.string().url().max(2048) });
export type PushUnsubscribeInput = z.infer<typeof PushUnsubscribeInputSchema>;

/** `GET /push/public-key`: the VAPID public key (base64url) for `pushManager.subscribe`. */
export const PushPublicKeySchema = z.object({ publicKey: z.string() });
export type PushPublicKey = z.infer<typeof PushPublicKeySchema>;
