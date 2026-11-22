"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import type { Me, MePatch } from "@beautyspa/contracts";
import { LOCALES, type Locale } from "@beautyspa/i18n";
import { errorProps, Field, INPUT_CLASS } from "@/components/booking/field";
import { usePathname, useRouter } from "@/i18n/navigation";
import { getBrowserApi } from "@/lib/api/browser";
import { useFallbackErrorText, useFieldErrorText } from "@/lib/use-error-text";

type Status = { kind: "saved" } | { kind: "unchanged" } | { kind: "error"; message: string };

/**
 * Name, email, language and the email consent switch. Sends only what changed; the consent has no
 * `consentSource` so the API records it as PROFILE. Only the EMAIL channel is offered.
 */
export function ProfileForm({ me, onSaved }: { me: Me; onSaved: (me: Me) => void }) {
  const t = useTranslations("profile");
  const tCommon = useTranslations("common");
  const tField = useTranslations("errors.field");
  const pageLocale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const errorText = useFallbackErrorText();
  const fieldText = useFieldErrorText();
  const [name, setName] = useState(me.name ?? "");
  const [email, setEmail] = useState(me.email ?? "");
  const [consent, setConsent] = useState(me.consents.EMAIL);
  const [locale, setLocale] = useState<Locale>(me.locale);
  // The page language follows the control only when it was used in this edit.
  const [languageTouched, setLanguageTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; email?: string }>({});

  const trimmedEmail = email.trim();
  // Consent without an email is not possible: an empty email switches it off (and sends EMAIL false if it was on).
  const emailConsent = consent && trimmedEmail !== "";

  async function submit() {
    setStatus(null);
    setFieldErrors({});
    const patch: MePatch = {};
    const trimmedName = name.trim();
    if (trimmedName !== (me.name ?? "")) {
      if (!trimmedName) {
        setFieldErrors({ name: tField("name") });
        return;
      }
      patch.name = trimmedName;
    }
    if (trimmedEmail !== (me.email ?? "")) patch.email = trimmedEmail || null;
    if (emailConsent !== me.consents.EMAIL) patch.consents = { EMAIL: emailConsent };
    if (locale !== me.locale) patch.locale = locale;
    const switchUrl = languageTouched && locale !== pageLocale;
    if (Object.keys(patch).length === 0) {
      if (switchUrl) router.replace(pathname, { locale });
      else setStatus({ kind: "unchanged" });
      return;
    }
    setBusy(true);
    try {
      const updated = await getBrowserApi().me.patch(patch);
      onSaved(updated);
      setStatus({ kind: "saved" });
      if (switchUrl) router.replace(pathname, { locale });
    } catch (err) {
      const fields = fieldText(err, ["name", "email"]);
      if (fields.name || fields.email) setFieldErrors(fields);
      else setStatus({ kind: "error", message: errorText(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="text-sm text-muted">{t("phone", { phone: me.phoneE164 })}</p>
      <Field id="profile-name" label={t("name")} error={fieldErrors.name}>
        <input
          id="profile-name"
          {...errorProps("profile-name", fieldErrors.name)}
          autoComplete="name"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          className={INPUT_CLASS}
        />
      </Field>
      <Field id="profile-email" label={t("email")} error={fieldErrors.email}>
        <input
          id="profile-email"
          {...errorProps("profile-email", fieldErrors.email)}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={INPUT_CLASS}
        />
      </Field>
      <div className="flex flex-col gap-1">
        <label className="flex min-h-11 items-center gap-3 text-[15px]">
          <input
            type="checkbox"
            role="switch"
            checked={emailConsent}
            disabled={trimmedEmail === ""}
            aria-describedby={trimmedEmail === "" ? "consent-help" : undefined}
            onChange={(e) => setConsent(e.target.checked)}
            className="size-6 shrink-0 accent-plum"
          />
          <span>{t("emailConsent")}</span>
        </label>
        {trimmedEmail === "" ? (
          <p id="consent-help" className="text-sm text-muted">
            {t("emailConsentNeedsEmail")}
          </p>
        ) : null}
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="pb-1 text-sm font-semibold">{t("language")}</legend>
        <div className="flex gap-2">
          {LOCALES.map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={l === locale}
              onClick={() => {
                setLocale(l);
                setLanguageTouched(true);
              }}
              className={`min-h-11 rounded-full px-4 text-sm ${
                l === locale
                  ? "bg-ink font-semibold text-white"
                  : "border border-line-strong bg-card font-medium text-ink"
              }`}
            >
              {tCommon(l === "en" ? "english" : "spanish")}
            </button>
          ))}
        </div>
      </fieldset>
      {status?.kind === "error" ? (
        <p role="alert" className="text-sm text-warn">
          {status.message}
        </p>
      ) : null}
      {status && status.kind !== "error" ? (
        <p role="status" className="text-sm text-ok">
          {status.kind === "saved" ? t("saved") : t("nothingChanged")}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={busy}
        className="min-h-[52px] rounded-[14px] bg-plum text-base font-semibold text-white hover:bg-plum-hover disabled:cursor-not-allowed disabled:bg-muted"
      >
        {busy ? t("saving") : t("save")}
      </button>
    </form>
  );
}
