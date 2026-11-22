"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Field, INPUT_CLASS } from "./field";

export const RESEND_SECONDS = 30;

/** Six-digit code entry; the label names the channel the API reports. Resend is disabled for 30 s from mount (the parent remounts it with a new `key` on every send). */
export function CodeStep({
  channel,
  onVerify,
  onResend,
  onChangeNumber,
  busy,
  error,
}: {
  channel: "whatsapp" | "sms";
  onVerify: (code: string) => void;
  onResend: () => void;
  onChangeNumber: () => void;
  busy: boolean;
  error?: string | undefined;
}) {
  const t = useTranslations("login");
  const [code, setCode] = useState("");
  const [wait, setWait] = useState(RESEND_SECONDS);

  useEffect(() => {
    const endsAt = Date.now() + RESEND_SECONDS * 1000;
    const timer = setInterval(() => {
      const left = Math.ceil((endsAt - Date.now()) / 1000);
      setWait(Math.max(0, left));
      if (left <= 0) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <form
      className="flex flex-col gap-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (code.length === 6) onVerify(code);
      }}
    >
      <Field id="code" label={channel === "whatsapp" ? t("codeLabelWhatsapp") : t("codeLabelSms")} error={error}>
        <input
          id="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "code-hint code-error" : "code-hint"}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          className={`${INPUT_CLASS} text-center text-xl font-semibold tracking-[0.4em]`}
        />
      </Field>
      <p id="code-hint" className="-mt-1 text-sm text-muted">
        {t("codeAria")}
      </p>
      <button
        type="submit"
        disabled={busy || code.length !== 6}
        className="flex min-h-[52px] items-center justify-center rounded-[14px] bg-plum px-4 text-base font-semibold text-white hover:bg-plum-hover disabled:cursor-not-allowed disabled:bg-muted"
      >
        {busy ? t("verifying") : t("verify")}
      </button>
      <div className="flex flex-wrap items-center justify-between">
        <button
          type="button"
          disabled={wait > 0 || busy}
          onClick={onResend}
          className="min-h-11 text-sm font-semibold text-plum disabled:text-muted"
        >
          {wait > 0 ? t("resendIn", { seconds: wait }) : t("resend")}
        </button>
        <button type="button" onClick={onChangeNumber} className="min-h-11 text-sm font-semibold text-plum">
          {t("changeNumber")}
        </button>
      </div>
    </form>
  );
}
