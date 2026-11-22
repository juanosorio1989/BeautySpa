import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { use } from "react";

export default function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);
  const t = useTranslations("home");

  return (
    <main className="px-5 pb-8">
      <h1 className="font-heading text-[28px] leading-tight">{t("title")}</h1>
    </main>
  );
}
