"use client";

import { useTranslations } from "next-intl";
import { errorMessageKey } from "@/lib/errors";

/** Localized copy for an error; unknown codes fall back to the generic message. */
export function useErrorText(): (err: unknown) => string {
  const t = useTranslations();
  return (err) => {
    const key = errorMessageKey(err);
    return t.has(key as never) ? t(key as never) : t("errors.generic");
  };
}
