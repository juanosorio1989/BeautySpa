"use client";

import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { InvalidLink } from "@/components/staff/auth/invalid-link";
import { PasswordFields } from "@/components/staff/auth/password-fields";
import { Link } from "@/i18n/navigation";
import { getBrowserApi } from "@/lib/api/browser";
import { useErrorText } from "@/lib/use-error-text";

function ResetForm() {
  const t = useTranslations("staff.auth");
  const errorText = useErrorText();
  const token = useSearchParams().get("token");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  if (!token) return <InvalidLink />;
  if (done) {
    return (
      <>
        <h1 className="font-heading text-xl font-semibold">{t("resetDone")}</h1>
        <p className="text-sm text-muted">{t("resetDoneBody")}</p>
        <Link href="/staff/login" className="flex min-h-11 items-center text-sm font-semibold text-plum">
          {t("backToLogin")}
        </Link>
      </>
    );
  }
  return (
    <>
      <h1 className="font-heading text-xl font-semibold">{t("resetTitle")}</h1>
      <PasswordFields
        busy={busy}
        error={error}
        submitLabel={busy ? t("saving") : t("resetSubmit")}
        onSubmit={(password) => {
          setBusy(true);
          setError(undefined);
          getBrowserApi()
            .auth.passwordReset({ token, password })
            .then(
              () => setDone(true),
              (err: unknown) => setError(errorText(err)),
            )
            .finally(() => setBusy(false));
        }}
      />
    </>
  );
}

export default function StaffResetPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
