import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@beautyspa/i18n";
import { TeamList } from "@/components/public/team-list";
import { getServerApi } from "@/lib/api/server";
import { routing } from "@/i18n/routing";
import { pageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  return pageMetadata(locale, "/team", "team.title", "team.description");
}

export default async function TeamPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("team");
  const api = getServerApi();
  const [employees, catalog] = await Promise.all([api.public.employees(), api.public.services()]);

  return (
    <main className="mx-auto max-w-3xl px-5 pb-12">
      <h1 className="font-heading text-[28px] leading-tight">{t("title")}</h1>
      <div className="mt-6">
        <TeamList employees={employees} services={catalog.services} locale={locale} />
      </div>
    </main>
  );
}
