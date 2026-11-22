"use client";

import { useTranslations } from "next-intl";
import { useErrorText } from "@/lib/use-error-text";

/** Localized error with a retry button (session `error`, network, 5xx). */
export function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const t = useTranslations("common");
  const errorText = useErrorText();
  return (
    <div role="alert" className="text-warn">
      <p>{errorText(error)}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 min-h-11 rounded-full border border-plum px-5 font-medium"
      >
        {t("retry")}
      </button>
    </div>
  );
}
