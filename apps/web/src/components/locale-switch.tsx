"use client";

import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Suspense } from "react";
import { LOCALES } from "@beautyspa/i18n";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

function Links({ query }: { query: Record<string, string> }) {
  const current = useLocale();
  const pathname = usePathname();
  const t = useTranslations("common");

  return (
    <div role="group" aria-label={t("language")} className="flex gap-1 rounded-full bg-chip p-1">
      {LOCALES.map((locale) => (
        <Link
          key={locale}
          href={{ pathname, query }}
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

/** Reads the query in its own Suspense boundary so the header still renders on the server. */
function LinksWithQuery() {
  return <Links query={Object.fromEntries(useSearchParams())} />;
}

/** Language links to the same path and query (e.g. the login `next`) in the other locale. */
export function LocaleSwitch() {
  return (
    <Suspense fallback={<Links query={{}} />}>
      <LinksWithQuery />
    </Suspense>
  );
}
