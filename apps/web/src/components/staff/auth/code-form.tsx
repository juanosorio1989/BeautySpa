"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { errorProps, Field, INPUT_CLASS } from "@/components/booking/field";

export const PRIMARY_BUTTON =
  "flex min-h-[52px] items-center justify-center rounded-[14px] bg-plum px-4 text-base font-semibold text-white hover:bg-plum-hover disabled:cursor-not-allowed disabled:bg-muted";
export const LINK_BUTTON = "min-h-11 text-sm font-semibold text-plum disabled:text-muted";

/** Six-digit authenticator code entry with a submit button. */
export function CodeForm({
  onSubmit,
  busy,
  error,
  submitLabel,
}: {
  onSubmit: (code: string) => void;
  busy: boolean;
  error?: string | undefined;
  submitLabel: string;
}) {
  const t = useTranslations("staff.auth");
  const [code, setCode] = useState("");
  return (
    <form
      className="flex flex-col gap-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (code.length === 6) onSubmit(code);
      }}
    >
      <Field id="staff-code" label={t("codeLabel")} error={error}>
        <input
          id="staff-code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          {...errorProps("staff-code", error)}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          className={`${INPUT_CLASS} text-center text-xl font-semibold tracking-[0.4em]`}
        />
      </Field>
      <p className="-mt-1 text-sm text-muted">{t("codeHint")}</p>
      <button type="submit" disabled={busy || code.length !== 6} className={PRIMARY_BUTTON}>
        {submitLabel}
      </button>
    </form>
  );
}
