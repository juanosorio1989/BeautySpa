import type { MetadataRoute } from "next";
import { LOCALES } from "@beautyspa/i18n";
import { PUBLIC_PATHS, siteUrl } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  return PUBLIC_PATHS.flatMap((path) => LOCALES.map((locale) => ({ url: `${base}/${locale}${path}` })));
}
