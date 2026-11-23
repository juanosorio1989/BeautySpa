import type { Consents } from "@beautyspa/contracts";

/** Channels this plan delivers on. `SMS` and `WHATSAPP` stay in the enums and are never selected. */
export type SendChannel = "EMAIL" | "PUSH";

const SEND_CHANNELS: readonly SendChannel[] = ["EMAIL", "PUSH"];

/**
 * Every channel the customer consented to and can receive on (`EMAIL` needs an email, `PUSH` at least one
 * push subscription), in the order `EMAIL`, `PUSH`. All of them, not a fallback chain. `only` (consent
 * catch-up) further limits the result. Pure.
 */
export function selectChannels(
  consents: Consents,
  reach: { email: boolean; push: boolean },
  only?: SendChannel[],
): SendChannel[] {
  const reachable: Record<SendChannel, boolean> = { EMAIL: reach.email, PUSH: reach.push };
  return SEND_CHANNELS.filter((c) => consents[c] && reachable[c] && (only === undefined || only.includes(c)));
}
