import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LOCALES, type Locale } from "@beautyspa/i18n";

export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

/** Message keys under the `seo` catalog namespace (typed: a typo fails typecheck). */
type SeoKey = Parameters<Awaited<ReturnType<typeof getTranslations<"seo">>>>[0];

/** Public pages in sitemap order; `path` is relative to `/<locale>`. */
export const PUBLIC_PATHS = ["", "/services", "/team", "/location"] as const;

export async function pageMetadata(
  locale: Locale,
  path: string,
  titleKey: SeoKey,
  descriptionKey: SeoKey,
): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: "seo" });
  const base = siteUrl();
  const languages: Record<string, string> = Object.fromEntries(LOCALES.map((l) => [l, `${base}/${l}${path}`]));
  languages["x-default"] = `${base}/en${path}`;
  return {
    title: t(titleKey),
    description: t(descriptionKey),
    alternates: { canonical: `${base}/${locale}${path}`, languages },
  };
}
