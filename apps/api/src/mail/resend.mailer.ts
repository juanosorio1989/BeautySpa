import type { Env } from "../config/env.js";
import type { MailMessage, Mailer } from "./mailer.js";

const RESEND_URL = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Sends email (text, optional HTML and attachments) through the Resend HTTP API. Each request is aborted
 * after 10 s (`Resend send failed: timeout`). Errors carry only the status,
 * never the response body.
 */
export class ResendMailer implements Mailer {
  constructor(
    private readonly env: Env,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  async send(msg: MailMessage): Promise<{ id?: string }> {
    let res: Response;
    try {
      res = await this.fetchFn(RESEND_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${this.env.RESEND_API_KEY ?? ""}`, "content-type": "application/json" },
        body: JSON.stringify({
          from: this.env.EMAIL_FROM,
          to: [msg.to],
          subject: msg.subject,
          text: msg.text,
          ...(msg.html !== undefined ? { html: msg.html } : {}),
          ...(msg.attachments?.length
            ? {
                attachments: msg.attachments.map((a) => ({
                  filename: a.filename,
                  content: Buffer.from(a.content, "utf8").toString("base64"),
                  content_type: a.contentType,
                })),
              }
            : {}),
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
        throw new Error("Resend send failed: timeout");
      }
      throw err;
    }
    if (!res.ok) throw new Error(`Resend send failed: ${res.status}`);
    try {
      const json = (await res.json()) as { id?: unknown } | null;
      return typeof json?.id === "string" ? { id: json.id } : {};
    } catch {
      return {};
    }
  }
}
