import { describe, expect, it } from "vitest";
import { escapeHtml, renderMessage } from "./render.js";
import type { MessageContext, TemplateKey } from "./types.js";

const keys: TemplateKey[] = [
  "appointment.confirmed",
  "appointment.reminder_24h",
  "appointment.reminder_2h",
  "appointment.changed",
  "appointment.cancelled",
];

function ctx(over: Partial<MessageContext> = {}): MessageContext {
  return {
    locale: "en",
    customerName: "Maria",
    salonName: "Glow Spa",
    salonPhone: "+1 555 0100",
    locationName: "Downtown",
    address: "1 Main St",
    timezone: "America/New_York",
    start: new Date("2026-12-01T15:00:00Z"),
    end: new Date("2026-12-01T16:00:00Z"),
    services: [{ name: "Haircut", employeeName: "Ana" }],
    manageUrl: "https://x.test/manage/tok",
    bookUrl: "https://x.test/book",
    confirmed: false,
    ...over,
  };
}

describe("renderMessage", () => {
  for (const locale of ["en", "es"] as const) {
    for (const key of keys) {
      it(`${key} ${locale} has the essentials`, () => {
        const m = renderMessage(key, ctx({ locale }));
        expect(m.subject.length).toBeGreaterThan(0);
        expect(m.text).toContain(locale === "en" ? "10:00 AM" : "10:00");
        expect(m.text).toContain("Haircut");
        expect(m.text).toContain("Ana");
        expect(m.text).toContain(key === "appointment.cancelled" ? "https://x.test/book" : "https://x.test/manage/tok");
        expect(m.push.url.length).toBeGreaterThan(0);
      });
    }
  }

  it("formats the time in the location timezone (en)", () => {
    const m = renderMessage("appointment.confirmed", ctx());
    expect(m.text).toContain("10:00 AM");
    expect(m.text).toContain("December 1, 2026");
  });

  it("cancelled links to bookUrl, not manageUrl", () => {
    const m = renderMessage("appointment.cancelled", ctx());
    expect(m.text).toContain("https://x.test/book");
    expect(m.text).not.toContain("https://x.test/manage/tok");
    expect(m.html).not.toContain("https://x.test/manage/tok");
    expect(m.push.url).toBe("https://x.test/book");
  });

  it("reminder_2h asks to confirm only when not confirmed", () => {
    const ask = /confirm your/i;
    expect(renderMessage("appointment.reminder_2h", ctx({ confirmed: false })).text).toMatch(ask);
    expect(renderMessage("appointment.reminder_2h", ctx({ confirmed: true })).text).not.toMatch(ask);
    for (const key of keys.filter((k) => k !== "appointment.reminder_2h")) {
      expect(renderMessage(key, ctx({ confirmed: false })).text).not.toMatch(ask);
    }
    const es = /confirma tu/i;
    expect(renderMessage("appointment.reminder_2h", ctx({ locale: "es", confirmed: false })).text).toMatch(es);
    expect(renderMessage("appointment.reminder_2h", ctx({ locale: "es", confirmed: true })).text).not.toMatch(es);
  });

  it("html escapes customer strings", () => {
    const m = renderMessage("appointment.confirmed", ctx({ customerName: "<b>&" }));
    expect(m.html).toContain("&lt;b&gt;&amp;");
    expect(m.html).not.toContain("<b>");
    expect(escapeHtml(`<a href="x">'`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;");
  });

  it("formats the full date and time in the location timezone (es)", () => {
    const m = renderMessage("appointment.confirmed", ctx({ locale: "es" }));
    expect(m.text).toContain("martes, 1 de diciembre de 2026, 10:00 a.m.");
  });

  it("push body truncation never splits a code point", () => {
    const services = Array.from({ length: 40 }, () => ({ name: "a💅b", employeeName: "Ana" }));
    const m = renderMessage("appointment.confirmed", ctx({ services }));
    const points = Array.from(m.push.body);
    expect(points.length).toBeLessThan(120);
    expect(m.push.body.endsWith("...")).toBe(true);
    // no lone surrogate left behind by the cut
    expect(m.push.body).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  });

  it("push body under 120 chars", () => {
    for (const locale of ["en", "es"] as const) {
      for (const key of keys) {
        const m = renderMessage(key, ctx({ locale, services: [{ name: "Haircut", employeeName: "Ana" }] }));
        expect(m.push.body.length).toBeLessThan(120);
      }
    }
  });

  it("null customer name uses a neutral greeting", () => {
    expect(renderMessage("appointment.confirmed", ctx({ customerName: null })).text).toMatch(/^Hi there,/);
    expect(renderMessage("appointment.confirmed", ctx({ customerName: null, locale: "es" })).text).toMatch(/^Hola,/);
  });
});
