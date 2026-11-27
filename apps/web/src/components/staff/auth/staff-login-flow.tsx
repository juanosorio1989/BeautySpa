"use client";

import type { MfaStepResponse } from "@beautyspa/contracts";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { errorProps, Field, INPUT_CLASS } from "@/components/booking/field";
import { Link } from "@/i18n/navigation";
import { getBrowserApi } from "@/lib/api/browser";
import { useSession } from "@/lib/session/use-session";
import { useErrorText } from "@/lib/use-error-text";
import { CodeForm, LINK_BUTTON, PRIMARY_BUTTON } from "./code-form";
import { EnrollStep } from "./enroll-step";
import { RecoveryCodes } from "./recovery-codes";

export type InitialStep = { status: MfaStepResponse["status"]; mfaToken: string };

type Step =
  | { kind: "credentials" }
  | { kind: "code"; mfaToken: string }
  | { kind: "recover"; mfaToken: string }
  | { kind: "enroll"; mfaToken: string }
  | { kind: "codes"; codes: readonly string[] };

function fromStatus({ status, mfaToken }: InitialStep): Step {
  return status === "ENROLL_REQUIRED" ? { kind: "enroll", mfaToken } : { kind: "code", mfaToken };
}

/** Staff sign-in: password, then authenticator code (or enrollment with recovery codes). `onDone` runs once signed in. */
export function StaffLoginFlow({ onDone, initialStep }: { onDone: () => void; initialStep?: InitialStep }) {
  const t = useTranslations("staff.auth");
  const errorText = useErrorText();
  const session = useSession();
  const [step, setStep] = useState<Step>(initialStep ? fromStatus(initialStep) : { kind: "credentials" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  const api = () => getBrowserApi().auth;

  const submitCredentials = () =>
    run(async () => setStep(fromStatus(await api().staffLogin({ email: email.trim(), password }))));
  const verify = (mfaToken: string, code: string) =>
    run(async () => {
      await api().mfaVerify({ mfaToken, code });
      session.signedIn();
      onDone();
    });
  const recover = (mfaToken: string) =>
    run(async () => setStep(fromStatus(await api().mfaRecover({ mfaToken, recoveryCode }))));

  if (step.kind === "credentials") {
    return (
      <form
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submitCredentials();
        }}
      >
        <Field id="staff-email" label={t("email")}>
          <input
            id="staff-email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={INPUT_CLASS}
          />
        </Field>
        <Field id="staff-password" label={t("password")} error={error}>
          <input
            id="staff-password"
            type="password"
            autoComplete="current-password"
            value={password}
            {...errorProps("staff-password", error)}
            onChange={(e) => setPassword(e.target.value)}
            className={INPUT_CLASS}
          />
        </Field>
        <button type="submit" disabled={busy || !email || !password} className={PRIMARY_BUTTON}>
          {busy ? t("signingIn") : t("signIn")}
        </button>
        <Link href="/staff/forgot" className="flex min-h-11 items-center text-sm font-semibold text-plum">
          {t("forgotLink")}
        </Link>
      </form>
    );
  }

  if (step.kind === "code") {
    const { mfaToken } = step;
    return (
      <div className="flex flex-col gap-2">
        <CodeForm
          onSubmit={(code) => void verify(mfaToken, code)}
          busy={busy}
          error={error}
          submitLabel={busy ? t("verifying") : t("verify")}
        />
        <button
          type="button"
          className={LINK_BUTTON}
          onClick={() => {
            setError(undefined);
            setStep({ kind: "recover", mfaToken });
          }}
        >
          {t("useRecovery")}
        </button>
      </div>
    );
  }

  if (step.kind === "recover") {
    const { mfaToken } = step;
    return (
      <form
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (recoveryCode.trim()) void recover(mfaToken);
        }}
      >
        <Field id="staff-recovery" label={t("recoveryLabel")} error={error}>
          <input
            id="staff-recovery"
            type="text"
            autoComplete="off"
            autoCapitalize="off"
            value={recoveryCode}
            {...errorProps("staff-recovery", error)}
            onChange={(e) => setRecoveryCode(e.target.value)}
            className={INPUT_CLASS}
          />
        </Field>
        <button type="submit" disabled={busy || !recoveryCode.trim()} className={PRIMARY_BUTTON}>
          {t("recoverySubmit")}
        </button>
        <button
          type="button"
          className={LINK_BUTTON}
          onClick={() => {
            setError(undefined);
            setStep({ kind: "code", mfaToken });
          }}
        >
          {t("useAuthenticator")}
        </button>
      </form>
    );
  }

  if (step.kind === "enroll") {
    return (
      <EnrollStep
        mfaToken={step.mfaToken}
        onEnrolled={(result) => {
          session.signedIn();
          setStep({ kind: "codes", codes: result.recoveryCodes });
        }}
      />
    );
  }

  return <RecoveryCodes codes={step.codes} onContinue={onDone} />;
}
