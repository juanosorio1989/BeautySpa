"use client";

import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Link } from "@/i18n/navigation";

/** Why the customer is back on the time step: `?notice=expired` or `?notice=conflict`. */
export function TimeNotice() {
  const t = useTranslations();
  const notice = useSearchParams().get("notice");
  if (notice !== "expired" && notice !== "conflict") return null;
  return (
    <div role="status" className="mx-5 mb-2 rounded-xl bg-warn-bg px-3.5 py-3 text-sm text-warn">
      {notice === "expired" ? (
        <p>{t("errors.HOLD_EXPIRED")}</p>
      ) : (
        <p>
          {t("booking.details.conflict")}{" "}
          <Link href="/me" className="font-semibold underline">
            {t("booking.details.conflictLink")}
          </Link>
        </p>
      )}
    </div>
  );
}
