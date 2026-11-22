"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { getBrowserApi } from "@/lib/api/browser";
import { fieldErrors } from "@/lib/errors";
import { useErrorText } from "@/lib/use-error-text";
import { Field, INPUT_CLASS } from "./field";

/** "Want your confirmation and reminders by email?" Shown only to customers without EMAIL consent. */
export function EmailOffer({ email, onSaved }: { email: string | null; onSaved: () => void }) {
  const t = useTranslations("booking.done");
  const errorText = useErrorText();
  const [value, setValue] = useState(email ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);

  if (saved) return null;

  async function submit() {
    setBusy(true);
    setError(undefined);
    setFieldError(undefined);
    try {
      await getBrowserApi().me.patch({
        email: value.trim(),
        consents: { EMAIL: true },
        consentSource: "BOOKING_FORM",
      });
      setSaved(true);
      onSaved();
    } catch (err) {
      const field = fieldErrors(err).email;
      if (field) setFieldError(field);
      else setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-2.5 rounded-[18px] bg-plum-tint px-[18px] py-4">
      <h2 className="text-[15px] font-semibold text-plum-hover">{t("emailTitle")}</h2>
      <form
        className="flex flex-col gap-2.5"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) void submit();
        }}
      >
        <Field id="offer-email" label={t("emailLabel")} error={fieldError}>
          <input
            id="offer-email"
            type="email"
            autoComplete="email"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className={INPUT_CLASS}
          />
        </Field>
        {error ? (
          <p role="alert" className="text-sm text-warn">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={busy || !value.trim()}
          className="min-h-11 self-start rounded-xl bg-plum px-[18px] text-[15px] font-semibold text-white hover:bg-plum-hover disabled:cursor-not-allowed disabled:bg-muted"
        >
          {busy ? t("emailSaving") : t("emailYes")}
        </button>
      </form>
    </section>
  );
}
