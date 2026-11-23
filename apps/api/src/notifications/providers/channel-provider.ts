import type { RenderedMessage, TemplateKey } from "../templates/types.js";

/** Nest token: the array of configured `ChannelProvider`s, one per channel sent (`EMAIL`, `PUSH`). */
export const CHANNEL_PROVIDERS = Symbol("CHANNEL_PROVIDERS");

/** Who and what one delivery goes to. `ics` is set only for emails that carry an invite or cancellation. */
export interface DeliveryTarget {
  customerId: string;
  email: string | null;
  templateKey: TemplateKey;
  ics?: { content: string; method: "REQUEST" | "CANCEL" };
}

/** Sends one rendered message on one channel. Errors must carry no recipient data or provider body. */
export interface ChannelProvider {
  readonly channel: "EMAIL" | "PUSH";
  /** Stored in `notification_log.provider` (`resend`, `console`, `webpush`, `fake`). */
  readonly name: string;
  send(msg: RenderedMessage, target: DeliveryTarget): Promise<{ providerMessageId?: string }>;
}

/** A push delivery failure: the push service's HTTP status of the last attempt, or `none` (no subscription). */
export class PushError extends Error {
  constructor(readonly status: number | "none") {
    super(`Push send failed: ${status}`);
    this.name = "PushError";
  }
}
