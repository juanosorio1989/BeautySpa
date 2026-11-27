import type { Locale } from "@beautyspa/i18n";

const INTL_LOCALE: Record<Locale, string> = { en: "en-US", es: "es-US" };

export function formatPrice(cents: number, locale: Locale): string {
  return new Intl.NumberFormat(INTL_LOCALE[locale], { style: "currency", currency: "USD" }).format(cents / 100);
}

export function formatDate(iso: string, tz: string, locale: Locale, style: "long" | "short" | "medium"): string {
  const opts: Intl.DateTimeFormatOptions =
    style === "long"
      ? { weekday: "long", month: "long", day: "numeric", year: "numeric" }
      : style === "medium"
        ? { month: "short", day: "numeric", year: "numeric" }
        : { weekday: "short", month: "short", day: "numeric" };
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { ...opts, timeZone: tz }).format(new Date(iso));
}

export function formatTime(iso: string, tz: string, locale: Locale): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { hour: "numeric", minute: "2-digit", timeZone: tz }).format(
    new Date(iso),
  );
}

export function formatTimeRange(startIso: string, endIso: string, tz: string, locale: Locale): string {
  return `${formatTime(startIso, tz, locale)} – ${formatTime(endIso, tz, locale)}`;
}
