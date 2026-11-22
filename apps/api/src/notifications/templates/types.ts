export type TemplateKey =
  | "appointment.confirmed"
  | "appointment.reminder_24h"
  | "appointment.reminder_2h"
  | "appointment.changed"
  | "appointment.cancelled";

export interface MessageContext {
  locale: "en" | "es";
  customerName: string | null;
  salonName: string;
  salonPhone: string | null;
  locationName: string;
  address: string;
  timezone: string;
  start: Date;
  end: Date;
  services: { name: string; employeeName: string }[];
  manageUrl: string;
  bookUrl: string;
  confirmed: boolean;
}

export interface RenderedMessage {
  subject: string;
  text: string;
  html: string;
  push: { title: string; body: string; url: string };
}

/** Per-key copy in one locale. `when` is the already formatted local date and time. */
export interface KeyCopy {
  subject: (ctx: MessageContext, when: string) => string;
  headline: (ctx: MessageContext, when: string) => string;
  pushTitle: (ctx: MessageContext) => string;
  /** Extra line shown before the link; only the 2h reminder uses it, and only when unconfirmed. */
  confirmLine?: string;
  linkLabel: string;
}

export interface LocaleCopy {
  greeting: (name: string | null) => string;
  labels: { when: string; services: string; where: string; phone: string; with: string };
  keys: Record<TemplateKey, KeyCopy>;
}
