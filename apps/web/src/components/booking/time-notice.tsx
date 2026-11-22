"use client";

import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Link, useRouter } from "@/i18n/navigation";

/**
 * Why the customer is back on the time step: `?notice=expired` or `?notice=conflict`.
 * The notice is kept in state and dropped from the URL so a reload does not show it again.
 */
export function TimeNotice() {
  const t = useTranslations();
  const router = useRouter();
  const param = useSearchParams().get("notice");
  const [notice] = useState(() => (param === "expired" || param === "conflict" ? param : null));
  useEffect(() => {
    if (param !== null) router.replace("/book/time");
  }, [param, router]);
  if (!notice) return null;
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
