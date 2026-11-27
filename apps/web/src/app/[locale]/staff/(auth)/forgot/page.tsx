"use client";

import { ApiError } from "@beautyspa/api-client";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { errorProps, Field, INPUT_CLASS } from "@/components/booking/field";
import { PRIMARY_BUTTON } from "@/components/staff/auth/code-form";
import { Link } from "@/i18n/navigation";
import { getBrowserApi } from "@/lib/api/browser";
import { useErrorText } from "@/lib/use-error-text";

export default function StaffForgotPage() {
  const t = useTranslations("staff.auth");
  const errorText = useErrorText();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function submit() {
    setBusy(true);
    setError(undefined);
    try {
      await getBrowserApi().auth.passwordForgot({ email: email.trim() });
      setSent(true);
    } catch (err) {
      // The answer never reveals whether the email exists: a 404 reads like success.
      if (err instanceof ApiError && err.status === 404) setSent(true);
      else setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="font-heading text-xl font-semibold">{t("forgotTitle")}</h1>
      {sent ? (
        <p role="status" className="text-base">
          {t("forgotSent")}
        </p>
      ) : (
        <>
          <p className="text-sm text-muted">{t("forgotBody")}</p>
          <form
            className="flex flex-col gap-3"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (email.trim()) void submit();
            }}
          >
            <Field id="staff-forgot-email" label={t("email")} error={error}>
              <input
                id="staff-forgot-email"
                type="email"
                autoComplete="username"
                value={email}
                {...errorProps("staff-forgot-email", error)}
                onChange={(e) => setEmail(e.target.value)}
                className={INPUT_CLASS}
              />
            </Field>
            <button type="submit" disabled={busy || !email.trim()} className={PRIMARY_BUTTON}>
              {t("forgotSubmit")}
            </button>
          </form>
        </>
      )}
      <Link href="/staff/login" className="flex min-h-11 items-center text-sm font-semibold text-plum">
        {t("backToLogin")}
      </Link>
    </>
  );
}
