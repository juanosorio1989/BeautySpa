import { en } from "./en.js";
import { es } from "./es.js";
import type { LocaleCopy, MessageContext, RenderedMessage, TemplateKey } from "./types.js";

const COPY: Record<MessageContext["locale"], LocaleCopy> = { en, es };

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Local date and time in the location timezone; ICU's narrow no-break spaces become plain spaces. */
function formatWhen(ctx: MessageContext): string {
  return new Intl.DateTimeFormat(ctx.locale === "es" ? "es-US" : "en-US", {
    timeZone: ctx.timezone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
    .format(ctx.start)
    .replace(/[\u202f\u00a0]/g, " ");
}

function formatShort(ctx: MessageContext): string {
  return new Intl.DateTimeFormat(ctx.locale === "es" ? "es-US" : "en-US", {
    timeZone: ctx.timezone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
    .format(ctx.start)
    .replace(/[\u202f\u00a0]/g, " ");
}

/** The single HTML shell: one table, inline styles, plum button, no images. */
function htmlShell(p: {
  greeting: string;
  headline: string;
  rows: { label: string; value: string }[];
  confirmLine: string | null;
  linkLabel: string;
  url: string;
  phoneLine: string | null;
}): string {
  const rows = p.rows
    .map(
      (r) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#6b5b66;vertical-align:top">${escapeHtml(r.label)}</td>` +
        `<td style="padding:4px 0">${escapeHtml(r.value).replace(/\n/g, "<br>")}</td></tr>`,
    )
    .join("");
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:Arial,Helvetica,sans-serif;color:#2b2128;font-size:16px;line-height:1.5">` +
    `<tr><td align="center" style="padding:24px"><table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px">` +
    `<tr><td style="padding-bottom:12px">${escapeHtml(p.greeting)}</td></tr>` +
    `<tr><td style="padding-bottom:16px">${escapeHtml(p.headline)}</td></tr>` +
    `<tr><td><table role="presentation" cellpadding="0" cellspacing="0">${rows}</table></td></tr>` +
    (p.confirmLine ? `<tr><td style="padding-top:16px">${escapeHtml(p.confirmLine)}</td></tr>` : "") +
    `<tr><td style="padding:20px 0"><a href="${escapeHtml(p.url)}" style="background:#7A2E5A;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;display:inline-block">${escapeHtml(p.linkLabel)}</a></td></tr>` +
    (p.phoneLine ? `<tr><td style="color:#6b5b66">${escapeHtml(p.phoneLine)}</td></tr>` : "") +
    `</table></td></tr></table>`
  );
}

export function renderMessage(key: TemplateKey, ctx: MessageContext): RenderedMessage {
  const copy = COPY[ctx.locale];
  const k = copy.keys[key];
  const when = formatWhen(ctx);
  const greeting = copy.greeting(ctx.customerName);
  const headline = k.headline(ctx, when);
  const servicesText = ctx.services.map((s) => `${s.name} ${copy.labels.with} ${s.employeeName}`).join("\n");
  const where = [ctx.locationName, ctx.address].filter((s) => s.length > 0).join(", ");
  const url = key === "appointment.cancelled" ? ctx.bookUrl : ctx.manageUrl;
  const confirmLine = key === "appointment.reminder_2h" && !ctx.confirmed ? (k.confirmLine ?? null) : null;
  const phoneLine = ctx.salonPhone ? `${copy.labels.phone} ${ctx.salonPhone}` : null;
  const rows = [
    { label: copy.labels.when, value: when },
    { label: copy.labels.services, value: servicesText },
    { label: copy.labels.where, value: where },
  ];

  const text =
    [
      greeting,
      "",
      headline,
      "",
      ...rows.map((r) => `${r.label}: ${r.value.replace(/\n/g, "; ")}`),
      ...(confirmLine ? ["", confirmLine] : []),
      "",
      `${k.linkLabel}: ${url}`,
      ...(phoneLine ? ["", phoneLine] : []),
    ].join("\n") + "\n";

  const html = htmlShell({ greeting, headline, rows, confirmLine, linkLabel: k.linkLabel, url, phoneLine });

  const body = `${formatShort(ctx)} · ${ctx.services.map((s) => s.name).join(", ")}`;
  const pushBody = body.length < 120 ? body : `${body.slice(0, 116)}...`;

  return { subject: k.subject(ctx, when), text, html, push: { title: k.pushTitle(ctx), body: pushBody, url } };
}
