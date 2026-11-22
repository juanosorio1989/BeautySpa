import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@beautyspa/i18n";
import { ServicesList } from "@/components/public/services-list";
import { getServerApi } from "@/lib/api/server";
import { pageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  return pageMetadata(locale, "/services", "seo.services.title", "seo.services.description");
}

export default async function ServicesPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("services");
  const data = await getServerApi().public.services();

  return (
    <main className="mx-auto max-w-3xl px-5 pb-12">
      <h1 className="font-heading text-[28px] leading-tight">{t("title")}</h1>
      <div className="mt-6">
        <ServicesList data={data} locale={locale} />
      </div>
    </main>
  );
}
