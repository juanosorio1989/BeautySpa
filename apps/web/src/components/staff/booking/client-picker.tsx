"use client";

import type { BookingCatalog, StaffCustomerSearchResult } from "@beautyspa/contracts";
import type { Locale } from "@beautyspa/i18n";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { INPUT_CLASS, Field } from "@/components/booking/field";
import { getBrowserApi } from "@/lib/api/browser";
import { localized } from "@/lib/localized";
import { formatUsPhone, toE164 } from "@/lib/phone";
import { useCustomerSearch } from "@/lib/staff/use-customer-search";
import { ApiError } from "@beautyspa/api-client";
import { useErrorText, useFallbackErrorText, useFieldErrorText } from "@/lib/use-error-text";

export type PickedClient = StaffCustomerSearchResult;

const LINK_BTN = "min-h-12 px-3.5 text-left text-sm font-semibold text-plum";

/** "Last: Pedicure, Manicure" from a client's last visit. */
export function lastVisitText(
  client: PickedClient,
  services: BookingCatalog["services"],
  locale: Locale,
): string | null {
  if (!client.lastVisit) return null;
  const names = client.lastVisit.serviceIds
    .map((sid) => services.find((s) => s.id === sid))
    .filter((s) => s !== undefined)
    .map((s) => localized(s.name, locale));
  return names.length ? names.join(", ") : null;
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function NewClientForm({ onCreated, onCancel }: { onCreated: (c: PickedClient) => void; onCancel: () => void }) {
  const t = useTranslations("staff.book");
  const errorText = useFallbackErrorText();
  const fieldText = useFieldErrorText();
  const pageLocale = useLocale() as Locale;
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [language, setLanguage] = useState<Locale>(pageLocale);
  const [email, setEmail] = useState("");
  const [emailConsent, setEmailConsent] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; phone?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A hint only (the API validates): consent needs an address to go with it.
  const emailLooksValid = EMAIL_SHAPE.test(email.trim());

  async function submit() {
    const e164 = toE164(phone);
    const next = {
      ...(name.trim() ? {} : { name: t("nameRequired") }),
      ...(e164 ? {} : { phone: t("phoneInvalid") }),
    };
    setErrors(next);
    setFailure(null);
    if (!e164 || next.name) return;
    setBusy(true);
    try {
      const trimmed = email.trim();
      const created = await getBrowserApi().staff.createCustomer({
        name: name.trim(),
        phone: e164,
        locale: language,
        email: trimmed || null,
        // Consent is only recorded when the client agreed out loud (the tick), never by default.
        consents: emailConsent && emailLooksValid ? { EMAIL: true } : {},
      });
      onCreated({ ...created, lastVisit: null });
    } catch (err) {
      if (err instanceof ApiError && err.problem.code === "CONFLICT") {
        setErrors({ phone: t("phoneExists") });
      } else {
        const fields = fieldText(err, ["name", "email", "phone"]);
        const { email: emailError, ...own } = fields;
        setErrors(own);
        setFailure(emailError ?? (Object.keys(own).length ? null : errorText(err)));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-xl bg-card p-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Field id="nc-name" label={t("name")} error={errors.name}>
        <input
          id="nc-name"
          className={INPUT_CLASS}
          value={name}
          autoComplete="off"
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field id="nc-phone" label={t("phone")} error={errors.phone}>
        <input
          id="nc-phone"
          type="tel"
          inputMode="tel"
          className={INPUT_CLASS}
          value={phone}
          autoComplete="off"
          onChange={(e) => setPhone(e.target.value)}
        />
      </Field>
      <Field id="nc-language" label={t("language")}>
        <select
          id="nc-language"
          className={INPUT_CLASS}
          value={language}
          onChange={(e) => setLanguage(e.target.value === "es" ? "es" : "en")}
        >
          <option value="en">{t("languageEn")}</option>
          <option value="es">{t("languageEs")}</option>
        </select>
      </Field>
      <Field id="nc-email" label={t("email")}>
        <input
          id="nc-email"
          type="email"
          className={INPUT_CLASS}
          value={email}
          autoComplete="off"
          onChange={(e) => {
            setEmail(e.target.value);
            if (!EMAIL_SHAPE.test(e.target.value.trim())) setEmailConsent(false);
          }}
        />
      </Field>
      <label className={`flex min-h-11 items-center gap-3 text-sm ${emailLooksValid ? "" : "text-muted"}`}>
        <input
          type="checkbox"
          className="size-5"
          checked={emailConsent && emailLooksValid}
          disabled={!emailLooksValid}
          onChange={(e) => setEmailConsent(e.target.checked)}
        />
        {t("emailConsent")}
      </label>
      {failure ? (
        <p role="alert" className="text-sm text-warn">
          {failure}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="min-h-[52px] flex-1 rounded-[14px] bg-plum font-semibold text-white disabled:bg-muted"
        >
          {busy ? t("creating") : t("createClient")}
        </button>
        <button type="button" onClick={onCancel} className="min-h-[52px] rounded-[14px] px-4 font-semibold">
          {t("cancelNew")}
        </button>
      </div>
    </form>
  );
}

export function ClientPicker({
  value,
  onChange,
  allowSkip = false,
  services,
}: {
  value: PickedClient | null;
  onChange: (client: PickedClient | null) => void;
  allowSkip?: boolean;
  services: BookingCatalog["services"];
}) {
  const t = useTranslations("staff.book");
  const errorText = useErrorText();
  const locale = useLocale() as Locale;
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const search = useCustomerSearch(q);

  const label = <span className="text-[13px] font-semibold uppercase text-muted">{t("client")}</span>;

  if (value) {
    return (
      <section className="flex flex-col gap-2">
        {label}
        <div className="flex items-center justify-between rounded-xl bg-plum-tint px-3.5 py-2">
          <span className="flex flex-col">
            <span className="text-[15px] font-semibold">{value.name ?? t("client")}</span>
            <span className="text-[13px] text-muted">{formatUsPhone(value.phoneE164)}</span>
          </span>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="min-h-11 px-2 text-sm font-semibold text-plum"
          >
            {t("change")}
          </button>
        </div>
      </section>
    );
  }

  if (allowSkip && skipped) {
    return (
      <section className="flex flex-col gap-2">
        {label}
        <div className="flex items-center justify-between rounded-xl bg-card px-3.5 py-2">
          <span className="text-[15px]">{t("skipped")}</span>
          <button
            type="button"
            onClick={() => setSkipped(false)}
            className="min-h-11 px-2 text-sm font-semibold text-plum"
          >
            {t("addClient")}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-2">
      <label htmlFor="client-q" className="text-[13px] font-semibold uppercase text-muted">
        {t("searchLabel")}
      </label>
      <input
        id="client-q"
        type="search"
        value={q}
        autoComplete="off"
        placeholder={t("searchPlaceholder")}
        onChange={(e) => setQ(e.target.value)}
        className={`${INPUT_CLASS} border-2 border-plum`}
      />
      {creating ? (
        <NewClientForm
          onCreated={(c) => {
            setCreating(false);
            onChange(c);
          }}
          onCancel={() => setCreating(false)}
        />
      ) : (
        <div className="flex flex-col rounded-xl bg-card">
          {search.loading ? <p className="px-3.5 py-3 text-sm text-muted">{t("searching")}</p> : null}
          {search.error ? (
            <p role="alert" className="px-3.5 py-3 text-sm text-warn">
              {errorText(search.error)}
            </p>
          ) : null}
          {search.active && !search.loading && !search.error && search.results.length === 0 ? (
            <p className="px-3.5 py-3 text-sm text-muted">{t("noResults")}</p>
          ) : null}
          {search.results.map((c) => {
            const last = lastVisitText(c, services, locale);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onChange(c)}
                className="flex min-h-14 flex-col items-start justify-center gap-0.5 border-b border-line px-3.5 py-1.5 text-left"
              >
                <span className="text-[15px] font-semibold">{c.name ?? t("client")}</span>
                <span className="text-[13px] text-muted">
                  {formatUsPhone(c.phoneE164)}
                  {last ? ` · ${t("lastVisit", { services: last })}` : ""}
                </span>
              </button>
            );
          })}
          <button type="button" onClick={() => setCreating(true)} className={LINK_BTN}>
            {t("newClient")}
          </button>
          {allowSkip ? (
            <button type="button" onClick={() => setSkipped(true)} className={LINK_BTN}>
              {t("skip")}
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}
