"use client";

import { useLocale, useTranslations } from "next-intl";
import { LOCALES } from "@beautyspa/i18n";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

export function LocaleSwitch() {
  const current = useLocale();
  const pathname = usePathname();
  const t = useTranslations("common");

  return (
    <div role="group" aria-label={t("language")} className="flex gap-1 rounded-full bg-chip p-1">
      {LOCALES.map((locale) => (
        <Link
          key={locale}
          href={pathname}
          locale={locale}
          hrefLang={locale}
          aria-label={t(locale === "en" ? "english" : "spanish")}
          aria-current={locale === current ? "true" : undefined}
          className={cn(
            "flex min-h-11 min-w-11 items-center justify-center rounded-full px-3 text-[13px] font-semibold",
            locale === current ? "bg-ink text-white hover:text-white" : "text-ink hover:text-ink",
          )}
        >
          {locale.toUpperCase()}
        </Link>
      ))}
    </div>
  );
}
