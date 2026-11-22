import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { LocaleSwitch } from "./locale-switch";

const NAV = [
  { href: "/services", key: "services" },
  { href: "/team", key: "team" },
  { href: "/location", key: "location" },
  { href: "/me", key: "myAppointments" },
] as const;

export function SiteHeader({ locationName }: { locationName: string }) {
  const t = useTranslations("nav");

  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 pb-3 pt-5">
      <Link
        href="/"
        className="inline-flex min-h-11 items-center font-heading text-xl font-bold text-ink hover:text-ink"
      >
        {locationName}
      </Link>
      <LocaleSwitch />
      <nav aria-label={t("label")} className="flex w-full flex-wrap gap-x-4 text-sm font-medium">
        {NAV.map(({ href, key }) => (
          <Link key={key} href={href} className="flex min-h-11 items-center">
            {t(key)}
          </Link>
        ))}
      </nav>
    </header>
  );
}
