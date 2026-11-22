import { describe, expect, it, vi } from "vitest";
import { testEnv } from "../../test/support/test-env.js";
import { ResendMailer } from "./resend.mailer.js";

const KEY = "re_test_key_not_real";
const FROM = "BeautySpa <no-reply@example.com>";
const env = testEnv({ EMAIL_PROVIDER: "resend", RESEND_API_KEY: KEY, EMAIL_FROM: FROM });

function fakeFetch(status: number, body: unknown) {
  return vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
    async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );
}

describe("ResendMailer", () => {
  it("posts JSON with a bearer token to the Resend emails endpoint", async () => {
    const fetchFn = fakeFetch(200, { id: "abc" });
    await new ResendMailer(env, fetchFn).send({ to: "ana@salon.com", subject: "Hi", text: "Body" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toBe("https://api.resend.com/emails");
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${KEY}`);
    expect(headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual({ from: FROM, to: ["ana@salon.com"], subject: "Hi", text: "Body" });
  });

  it("throws on non-2xx without echoing the response body", async () => {
    const fetchFn = fakeFetch(422, { message: "body-secret-detail" });
    const err = await new ResendMailer(env, fetchFn)
      .send({ to: "ana@salon.com", subject: "Hi", text: "Body" })
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("Resend send failed: 422");
    expect((err as Error).message).not.toContain("body-secret-detail");
  });

  it("passes a 10 s abort signal to fetch", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const fetchFn = fakeFetch(200, { id: "abc" });
    await new ResendMailer(env, fetchFn).send({ to: "ana@salon.com", subject: "Hi", text: "Body" });
    expect(timeout).toHaveBeenCalledWith(10_000);
    expect(fetchFn.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal);
    timeout.mockRestore();
  });

  it.each(["TimeoutError", "AbortError"])("a %s throws Resend send failed: timeout", async (name) => {
    const fetchFn = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => {
      throw new DOMException("aborted", name);
    });
    const err = await new ResendMailer(env, fetchFn)
      .send({ to: "ana@salon.com", subject: "Hi", text: "Body" })
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("Resend send failed: timeout");
  });

  it("sends html and base64 attachments", async () => {
    const fetchFn = fakeFetch(200, { id: "abc" });
    await new ResendMailer(env, fetchFn).send({
      to: "ana@salon.com",
      subject: "Hi",
      text: "Body",
      html: "<p>Body</p>",
      attachments: [{ filename: "a.ics", content: "BEGIN:VCALENDAR", contentType: "text/calendar" }],
    });
    const body = JSON.parse(String(fetchFn.mock.calls[0]![1].body)) as Record<string, unknown>;
    expect(body.html).toBe("<p>Body</p>");
    expect(body.attachments).toEqual([
      {
        filename: "a.ics",
        content: Buffer.from("BEGIN:VCALENDAR", "utf8").toString("base64"),
        content_type: "text/calendar",
      },
    ]);
  });

  it("returns the message id", async () => {
    const fetchFn = fakeFetch(200, { id: "msg_123" });
    const out = await new ResendMailer(env, fetchFn).send({ to: "ana@salon.com", subject: "Hi", text: "Body" });
    expect(out).toEqual({ id: "msg_123" });
  });

  it("missing id returns empty", async () => {
    const fetchFn = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
      async () => new Response("", { status: 200 }),
    );
    const out = await new ResendMailer(env, fetchFn).send({ to: "ana@salon.com", subject: "Hi", text: "Body" });
    expect(out).toEqual({});
    const out2 = await new ResendMailer(env, fakeFetch(200, {})).send({ to: "a@b.com", subject: "Hi", text: "Body" });
    expect(out2).toEqual({});
  });
});
