import type { Locale } from "@beautyspa/contracts";

/** Nest injection token for the active `OtpProvider` (chosen by `env.OTP_PROVIDER` in `AuthModule`). */
export const OTP_PROVIDER = Symbol("OTP_PROVIDER");

export type OtpChannel = "whatsapp" | "sms";

/**
 * Sends and checks one-time codes for a phone. Implementations must never put
 * the code (or provider credentials) in logs or error messages, except the
 * dev-only console provider, which logs the code on purpose.
 */
export interface OtpProvider {
  /** Sends a code over `channel`; throws when the channel cannot deliver. */
  start(phone: string, channel: OtpChannel, locale: Locale): Promise<void>;
  /** True when `code` is the current code for `phone`. */
  check(phone: string, code: string): Promise<boolean>;
}
