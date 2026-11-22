import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import type { Locale } from "@beautyspa/i18n";
import { DeletedNotice } from "@/components/me/deleted-notice";
import { ServicePicker } from "@/components/booking/service-picker";
import { getServerApi } from "@/lib/api/server";
import { routing } from "@/i18n/routing";
import { pageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  return pageMetadata(locale, "", "home.title", "home.description");
}

export default async function HomePage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("booking.services");
  const data = await getServerApi().public.services();

  return (
    <main>
      <Suspense>
        <div className="px-5">
          <DeletedNotice />
        </div>
      </Suspense>
      <div className="mx-auto max-w-[480px] px-5 pb-4 pt-1">
        <h1 className="font-heading text-[28px] leading-[1.15]">{t("title")}</h1>
        <p className="mt-1.5 text-[15px] text-muted">{t("subtitle")}</p>
      </div>
      <Suspense>
        <ServicePicker data={data} locale={locale} />
      </Suspense>
    </main>
  );
}
