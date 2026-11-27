"use client";

import type { StaffMe } from "@beautyspa/contracts";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { useStaff } from "@/lib/staff/use-staff";

/** Shows `children` only to the allowed roles (a hint; the API still decides). */
export function RoleGuard({ allow, children }: { allow: StaffMe["role"][]; children: ReactNode }) {
  const t = useTranslations("staff.roleGuard");
  const staff = useStaff();
  if (allow.includes(staff.role)) return <>{children}</>;
  return (
    <div className="px-5 py-8">
      <h1 className="font-heading text-xl font-bold">{t("title")}</h1>
      <p className="mt-2">{t("body")}</p>
      <Link href="/staff" className="mt-4 inline-flex min-h-11 items-center font-medium">
        {t("backToAgenda")}
      </Link>
    </div>
  );
}
