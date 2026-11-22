import type { Locale } from "@beautyspa/i18n";

export function localized(text: { en: string; es: string } | null, locale: Locale): string {
  if (!text) return "";
  const other = locale === "en" ? "es" : "en";
  return text[locale].trim() ? text[locale] : text[other];
}
