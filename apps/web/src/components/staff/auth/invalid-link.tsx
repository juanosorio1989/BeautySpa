"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

/** Shown by invite and reset pages when the `token` query parameter is missing. */
export function InvalidLink() {
  const t = useTranslations("staff.auth");
  return (
    <>
      <h1 className="font-heading text-xl font-semibold">{t("linkInvalid")}</h1>
      <p className="text-sm text-muted">{t("linkInvalidBody")}</p>
      <Link href="/staff/login" className="flex min-h-11 items-center text-sm font-semibold text-plum">
        {t("backToLogin")}
      </Link>
    </>
  );
}
