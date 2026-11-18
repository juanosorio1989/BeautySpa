import { describe, expect, it, vi } from "vitest";
import { testEnv } from "../../../test/support/test-env.js";
import { TwilioVerifyProvider } from "./twilio-verify.provider.js";

const SID = "ACtest0000000000000000000000000000";
const TOKEN = "test-auth-token-not-real";
const SERVICE = "VAtest0000000000000000000000000000";

const env = testEnv({
  OTP_PROVIDER: "twilio",
  TWILIO_ACCOUNT_SID: SID,
  TWILIO_AUTH_TOKEN: TOKEN,
  TWILIO_VERIFY_SERVICE_SID: SERVICE,
});

function fakeFetch(status: number, body: unknown) {
  return vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );
}

describe("TwilioVerifyProvider", () => {
  it("start posts To/Channel/Locale as a form to Verifications with Basic auth", async () => {
    const fetchFn = fakeFetch(201, { status: "pending" });
    await new TwilioVerifyProvider(env, fetchFn).start("+13055550100", "whatsapp", "es");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toBe(`https://verify.twilio.com/v2/Services/${SERVICE}/Verifications`);
    expect(init?.method).toBe("POST");
    expect(String(init?.body)).toBe("To=%2B13055550100&Channel=whatsapp&Locale=es");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe(`Basic ${Buffer.from(`${SID}:${TOKEN}`).toString("base64")}`);
    expect(headers.get("content-type")).toBe("application/x-www-form-urlencoded");
  });

  it("start throws on non-2xx without the response body", async () => {
    const fetchFn = fakeFetch(400, { message: "body-secret-detail" });
    const err = await new TwilioVerifyProvider(env, fetchFn).start("+13055550100", "sms", "en").catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("Twilio Verify start failed: 400");
  });

  it("check posts To/Code to VerificationCheck and returns true when approved", async () => {
    const fetchFn = fakeFetch(200, { status: "approved" });
    await expect(new TwilioVerifyProvider(env, fetchFn).check("+13055550100", "123456")).resolves.toBe(true);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toBe(`https://verify.twilio.com/v2/Services/${SERVICE}/VerificationCheck`);
    expect(String(init?.body)).toBe("To=%2B13055550100&Code=123456");
  });

  it("check returns false for pending", async () => {
    await expect(
      new TwilioVerifyProvider(env, fakeFetch(200, { status: "pending" })).check("+13055550100", "123456"),
    ).resolves.toBe(false);
  });

  it("check returns false on 404 (no pending verification)", async () => {
    await expect(
      new TwilioVerifyProvider(env, fakeFetch(404, { code: 20404 })).check("+13055550100", "123456"),
    ).resolves.toBe(false);
  });

  it("check throws on 500 without the response body or the token", async () => {
    const fetchFn = fakeFetch(500, { message: "body-secret-detail" });
    const err = (await new TwilioVerifyProvider(env, fetchFn).check("+13055550100", "123456").catch((e: Error) => e)) as Error;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).not.toContain("body-secret-detail");
    expect(err.message).not.toContain(TOKEN);
    expect(err.message).not.toContain("123456");
  });
});
