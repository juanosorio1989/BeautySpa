import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LOCALES, type Locale } from "@beautyspa/i18n";

export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

/** Public pages in sitemap order; `path` is relative to `/<locale>`. */
export const PUBLIC_PATHS = ["", "/services", "/team", "/location"] as const;

export async function pageMetadata(
  locale: Locale,
  path: string,
  titleKey: string,
  descriptionKey: string,
): Promise<Metadata> {
  const t = await getTranslations({ locale });
  const base = siteUrl();
  const languages: Record<string, string> = Object.fromEntries(LOCALES.map((l) => [l, `${base}/${l}${path}`]));
  languages["x-default"] = `${base}/en${path}`;
  // Keys are dotted catalog paths (e.g. "seo.services.title"), validated by callers' tests.
  const tr = t as unknown as (key: string) => string;
  return {
    title: tr(titleKey),
    description: tr(descriptionKey),
    alternates: { canonical: `${base}/${locale}${path}`, languages },
  };
}
