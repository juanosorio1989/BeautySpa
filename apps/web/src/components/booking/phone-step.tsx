"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { formatUsPhone, toE164 } from "@/lib/phone";
import { Field, INPUT_CLASS } from "./field";

/** `+1` fixed prefix and a US number formatted as typed; submits E.164. */
export function PhoneStep({
  onSubmit,
  busy,
  error,
}: {
  onSubmit: (phone: string) => void;
  busy: boolean;
  error?: string | undefined;
}) {
  const t = useTranslations("login");
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const phone = toE164(value);
        setInvalid(phone === null);
        if (phone) onSubmit(phone);
      }}
    >
      <Field id="phone" label={t("phoneLabel")} error={invalid ? t("phoneInvalid") : error}>
        <div className="flex gap-2">
          <div className="flex min-h-[52px] items-center rounded-xl border border-line-strong bg-card px-3.5 text-base">
            +1
          </div>
          <input
            id="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            value={value}
            aria-invalid={invalid || Boolean(error)}
            aria-describedby={invalid || error ? "phone-error" : undefined}
            onChange={(e) => {
              setInvalid(false);
              setValue(formatUsPhone(e.target.value));
            }}
            className={INPUT_CLASS}
          />
        </div>
      </Field>
      <button
        type="submit"
        disabled={busy}
        className="flex min-h-[52px] items-center justify-center rounded-[14px] bg-plum px-4 text-base font-semibold text-white hover:bg-plum-hover disabled:cursor-not-allowed disabled:bg-muted"
      >
        {busy ? t("sending") : t("sendCode")}
      </button>
    </form>
  );
}
