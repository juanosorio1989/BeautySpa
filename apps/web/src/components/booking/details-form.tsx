"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import type { Me } from "@beautyspa/contracts";
import { Field, INPUT_CLASS } from "./field";

export interface DetailsValues {
  name: string;
  email: string;
  emailConsent: boolean;
  notes: string;
}

/**
 * Step 3 form for a signed-in customer. First time (no name): name, email and the email consent checkbox
 * (enabled only with an email). Returning: "Booking as <name>" with "Not you?". Both: an optional note.
 */
export function DetailsForm({
  me,
  busy,
  error,
  fieldErrors,
  onSubmit,
  onNotYou,
}: {
  me: Me;
  busy: boolean;
  error?: string | undefined;
  fieldErrors: Record<string, string>;
  onSubmit: (values: DetailsValues) => void;
  onNotYou: () => void;
}) {
  const t = useTranslations("booking.details");
  const firstTime = me.name === null;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [emailConsent, setEmailConsent] = useState(false);
  const [notes, setNotes] = useState("");
  const [nameMissing, setNameMissing] = useState(false);
  const hasEmail = email.trim() !== "";

  return (
    <form
      noValidate
      className="flex flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        if (firstTime && name.trim() === "") {
          setNameMissing(true);
          return;
        }
        onSubmit({
          name: name.trim(),
          email: email.trim(),
          emailConsent: hasEmail && emailConsent,
          notes: notes.trim(),
        });
      }}
    >
      <div className="flex flex-1 flex-col gap-[18px] px-5 pt-5">
        {firstTime ? (
          <>
            <Field id="name" label={t("name")} error={nameMissing ? t("nameRequired") : fieldErrors.name}>
              <input
                id="name"
                type="text"
                autoComplete="name"
                maxLength={80}
                value={name}
                aria-invalid={nameMissing || Boolean(fieldErrors.name)}
                onChange={(e) => {
                  setNameMissing(false);
                  setName(e.target.value);
                }}
                className={INPUT_CLASS}
              />
            </Field>
            <Field id="email" label={t("email")} error={fieldErrors.email}>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                aria-invalid={Boolean(fieldErrors.email)}
                onChange={(e) => setEmail(e.target.value)}
                className={INPUT_CLASS}
              />
            </Field>
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-base font-semibold">{t("bookingAs", { name: me.name ?? "" })}</p>
            <button type="button" onClick={onNotYou} className="min-h-11 text-sm font-semibold text-plum">
              {t("notYou")}
            </button>
          </div>
        )}
        <Field id="notes" label={t("notes")} error={fieldErrors.notes}>
          <textarea
            id="notes"
            maxLength={500}
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={`${INPUT_CLASS} py-3`}
          />
        </Field>
      </div>
      <footer className="sticky bottom-0 mt-6 flex flex-col gap-3 border-t border-line bg-card px-5 pb-7 pt-3.5">
        {firstTime ? (
          <label className="flex min-h-11 items-start gap-3 text-sm leading-snug">
            <input
              type="checkbox"
              checked={hasEmail && emailConsent}
              disabled={!hasEmail}
              onChange={(e) => setEmailConsent(e.target.checked)}
              className="mt-0.5 size-[22px] accent-plum"
            />
            <span className={hasEmail ? "" : "text-muted"}>{t("emailConsent")}</span>
          </label>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-warn">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={busy}
          className="flex min-h-[52px] items-center justify-center rounded-[14px] bg-plum px-4 text-base font-semibold text-white hover:bg-plum-hover disabled:cursor-not-allowed disabled:bg-muted"
        >
          {busy ? t("confirming") : t("confirm")}
        </button>
      </footer>
    </form>
  );
}
