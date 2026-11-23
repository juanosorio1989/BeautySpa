import { z } from "zod";

/** `POST /me/push-subscriptions`: a browser `PushSubscription` (https endpoint) and where the consent was given. */
export const PushSubscriptionInputSchema = z.object({
  endpoint: z.string().url().max(2048).startsWith("https://"),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
  /** The API defaults to `PROFILE`. */
  consentSource: z.enum(["PROFILE", "BOOKING_FORM"]).optional(),
});
export type PushSubscriptionInput = z.infer<typeof PushSubscriptionInputSchema>;

/** `DELETE /me/push-subscriptions`. */
export const PushUnsubscribeInputSchema = z.object({ endpoint: z.string().url() });
export type PushUnsubscribeInput = z.infer<typeof PushUnsubscribeInputSchema>;

/** `GET /push/public-key`: the VAPID public key (base64url) for `pushManager.subscribe`. */
export const PushPublicKeySchema = z.object({ publicKey: z.string() });
export type PushPublicKey = z.infer<typeof PushPublicKeySchema>;
