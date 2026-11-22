import { defineRouting } from "next-intl/routing";
import { DEFAULT_LOCALE, LOCALES } from "@beautyspa/i18n";

export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
});
