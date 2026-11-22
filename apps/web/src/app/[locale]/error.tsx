"use client";

import { useTranslations } from "next-intl";
import { errorMessageKey } from "@/lib/errors";

export default function LocaleError({ error, reset }: { error: Error; reset: () => void }) {
  const t = useTranslations();
  const key = errorMessageKey(error) === "errors.network" ? "errors.network" : "errors.generic";

  return (
    <main className="mx-auto max-w-3xl px-5 pb-12">
      <p role="alert" className="text-muted">
        {t(key)}
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-4 inline-flex min-h-11 items-center rounded-full border border-plum px-5 font-medium"
      >
        {t("common.retry")}
      </button>
    </main>
  );
}
