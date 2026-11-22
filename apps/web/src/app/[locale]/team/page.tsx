import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@beautyspa/i18n";
import { TeamList } from "@/components/public/team-list";
import { getServerApi } from "@/lib/api/server";
import { pageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  return pageMetadata(locale, "/team", "seo.team.title", "seo.team.description");
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
