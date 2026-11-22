"use client";

import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";

/** "Your account was deleted." on the home page after `/me/profile` deletes the account (`?deleted=1`). */
export function DeletedNotice() {
  const t = useTranslations("home");
  if (useSearchParams().get("deleted") !== "1") return null;
  return (
    <p role="status" className="mx-auto mb-4 max-w-[480px] rounded-xl bg-ok-bg p-3 text-sm text-ok">
      {t("deleted")}
    </p>
  );
}
