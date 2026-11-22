import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@beautyspa/i18n";
import { LocationHours } from "@/components/public/location-hours";
import { getServerApi } from "@/lib/api/server";
import { routing } from "@/i18n/routing";
import { pageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  return pageMetadata(locale, "/location", "location.title", "location.description");
}

export default async function LocationPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("location");
  const [location] = await getServerApi().public.locations();

  return (
    <main className="mx-auto max-w-3xl px-5 pb-12">
      <h1 className="font-heading text-[28px] leading-tight">{location?.name ?? t("title")}</h1>
      {location ? (
        <div className="mt-6">
          <LocationHours location={location} locale={locale} />
        </div>
      ) : null}
    </main>
  );
}
