"use client";

import type { MfaStepResponse } from "@beautyspa/contracts";
import type { Locale } from "@beautyspa/i18n";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { InvalidLink } from "@/components/staff/auth/invalid-link";
import { PasswordFields } from "@/components/staff/auth/password-fields";
import { StaffLoginFlow } from "@/components/staff/auth/staff-login-flow";
import { getBrowserApi } from "@/lib/api/browser";
import { safeNext } from "@/lib/safe-next";
import { useErrorText } from "@/lib/use-error-text";

function InviteForm() {
  const t = useTranslations("staff.auth");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const errorText = useErrorText();
  const token = useSearchParams().get("token");
  const [step, setStep] = useState<MfaStepResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  if (!token) return <InvalidLink />;
  if (step) {
    return (
      <StaffLoginFlow
        initialStep={{ status: step.status, mfaToken: step.mfaToken }}
        onDone={() => router.push(safeNext(null, locale, "staff"))}
      />
    );
  }
  return (
    <>
      <h1 className="font-heading text-xl font-semibold">{t("inviteTitle")}</h1>
      <p className="text-sm text-muted">{t("inviteBody")}</p>
      <PasswordFields
        busy={busy}
        error={error}
        submitLabel={busy ? t("saving") : t("inviteSubmit")}
        onSubmit={(password) => {
          setBusy(true);
          setError(undefined);
          getBrowserApi()
            .auth.inviteAccept({ token, password })
            .then(setStep, (err: unknown) => setError(errorText(err)))
            .finally(() => setBusy(false));
        }}
      />
    </>
  );
}

export default function StaffInvitePage() {
  return (
    <Suspense>
      <InviteForm />
    </Suspense>
  );
}
