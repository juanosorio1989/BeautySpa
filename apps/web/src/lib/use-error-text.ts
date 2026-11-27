"use client";

import { useTranslations } from "next-intl";
import { errorMessageKey, fieldErrors } from "@/lib/errors";

/** Localized copy for an error; unknown codes fall back to the generic message. */
export function useErrorText(): (err: unknown) => string {
  const t = useTranslations();
  return (err) => {
    const key = errorMessageKey(err);
    return t.has(key as never) ? t(key as never) : t("errors.generic");
  };
}

export type FormField = "name" | "email" | "phone" | "notes";

/**
 * Localized field errors for the `allowed` fields that are on screen; API messages are never shown.
 * Empty when none of them matched, so the caller falls back to `useErrorText`.
 */
export function useFieldErrorText(): (
  err: unknown,
  allowed: readonly FormField[],
) => Partial<Record<FormField, string>> {
  const t = useTranslations("errors.field");
  return (err, allowed) => {
    const byPath = fieldErrors(err);
    const out: Partial<Record<FormField, string>> = {};
    for (const field of allowed) if (field in byPath) out[field] = t(field);
    return out;
  };
}

/**
 * Like `useErrorText`, but a `VALIDATION_FAILED` with no matching on-screen field reads as the generic message
 * ("check the highlighted fields" would point at nothing).
 */
export function useFallbackErrorText(): (err: unknown) => string {
  const t = useTranslations();
  const errorText = useErrorText();
  return (err) => (errorMessageKey(err) === "errors.VALIDATION_FAILED" ? t("errors.generic") : errorText(err));
}
