import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { en, es, type Messages } from "@beautyspa/i18n";
import { routing } from "./routing";

const catalogs: Record<string, Messages> = { en, es };

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  return { locale, messages: catalogs[locale] };
});
