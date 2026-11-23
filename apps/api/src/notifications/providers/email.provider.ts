import type { Mailer, MailMessage } from "../../mail/mailer.js";
import type { RenderedMessage } from "../templates/types.js";
import type { ChannelProvider, DeliveryTarget } from "./channel-provider.js";

/**
 * `EMAIL` channel over the configured `Mailer`: subject, text and html; attaches `appointment.ics`
 * (`text/calendar; method=<METHOD>`) when `target.ics` is set. `name` is the `EMAIL_PROVIDER` value.
 */
export class EmailProvider implements ChannelProvider {
  readonly channel = "EMAIL" as const;

  constructor(
    private readonly mailer: Mailer,
    readonly name: string,
  ) {}

  async send(msg: RenderedMessage, target: DeliveryTarget): Promise<{ providerMessageId?: string }> {
    if (!target.email) throw new Error("email_missing");
    const mail: MailMessage = { to: target.email, subject: msg.subject, text: msg.text, html: msg.html };
    if (target.ics) {
      mail.attachments = [
        {
          filename: "appointment.ics",
          content: target.ics.content,
          contentType: `text/calendar; method=${target.ics.method}`,
        },
      ];
    }
    const { id } = await this.mailer.send(mail);
    return id === undefined ? {} : { providerMessageId: id };
  }
}
