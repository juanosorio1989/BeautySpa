import type { Locale } from "@beautyspa/contracts";
import type { Env } from "../../config/env.js";
import type { OtpChannel, OtpProvider } from "./otp-provider.js";

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

const BASE_URL = "https://verify.twilio.com/v2/Services";

/**
 * Twilio Verify over its REST API (no SDK). Twilio generates, delivers and
 * checks the code; this class never sees it on `start`. Error messages carry
 * only the HTTP status: never the response body, the code or the auth token.
 */
export class TwilioVerifyProvider implements OtpProvider {
  private readonly serviceUrl: string;
  private readonly authorization: string;

  constructor(
    env: Pick<Env, "TWILIO_ACCOUNT_SID" | "TWILIO_AUTH_TOKEN" | "TWILIO_VERIFY_SERVICE_SID">,
    private readonly fetchFn: FetchFn = fetch,
  ) {
    const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token, TWILIO_VERIFY_SERVICE_SID: service } = env;
    if (!sid || !token || !service) throw new Error("Twilio Verify is not configured");
    this.serviceUrl = `${BASE_URL}/${encodeURIComponent(service)}`;
    this.authorization = `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`;
  }

  async start(phone: string, channel: OtpChannel, locale: Locale): Promise<void> {
    const res = await this.post("Verifications", { To: phone, Channel: channel, Locale: locale });
    if (!res.ok) throw new Error(`Twilio Verify start failed: ${res.status}`);
  }

  async check(phone: string, code: string): Promise<boolean> {
    const res = await this.post("VerificationCheck", { To: phone, Code: code });
    // 404: no pending verification (expired, already approved, or too many attempts).
    if (res.status === 404) return false;
    if (!res.ok) throw new Error(`Twilio Verify check failed: ${res.status}`);
    const json = (await res.json()) as { status?: unknown };
    return json.status === "approved";
  }

  private post(path: string, form: Record<string, string>): Promise<Response> {
    return this.fetchFn(`${this.serviceUrl}/${path}`, {
      method: "POST",
      headers: { Authorization: this.authorization, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
    });
  }
}
