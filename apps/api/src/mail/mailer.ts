/** Nest injection token for the configured `Mailer` (console in dev/test, Resend otherwise). */
export const MAILER = Symbol("MAILER");

export interface MailAttachment {
  filename: string;
  /** UTF-8 text content; the provider adapter encodes it as needed. */
  content: string;
  contentType: string;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: MailAttachment[];
}

export interface Mailer {
  /** Resolves with the provider message id when there is one. */
  send(msg: MailMessage): Promise<{ id?: string }>;
}
