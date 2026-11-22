import { Logger } from "@nestjs/common";
import type { MailMessage, Mailer } from "./mailer.js";

const KEEP = 50;

/**
 * DEV ONLY: logs the email (its text may hold a one-time link, so the body is NOT logged: only recipient, subject and attachment names)
 * instead of sending it. `loadEnv` refuses `EMAIL_PROVIDER=console` in production.
 * Keeps the last 50 messages in `sent` for tests.
 */
export class ConsoleMailer implements Mailer {
  private readonly logger = new Logger(ConsoleMailer.name);
  readonly sent: MailMessage[] = [];

  async send(msg: MailMessage): Promise<{ id?: string }> {
    this.sent.push(msg);
    if (this.sent.length > KEEP) this.sent.splice(0, this.sent.length - KEEP);
    const names = (msg.attachments ?? []).map((a) => a.filename).join(", ");
    this.logger.log(`Email to ${msg.to}: ${msg.subject}${names ? ` [attachments: ${names}]` : ""}`);
    return {};
  }
}
