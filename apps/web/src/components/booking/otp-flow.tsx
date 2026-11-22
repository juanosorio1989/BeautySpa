"use client";

import { useState } from "react";
import { useErrorText } from "@/lib/use-error-text";
import { useOtpLogin } from "@/lib/session/use-otp-login";
import { CodeStep } from "./code-step";
import { PhoneStep } from "./phone-step";

type Step = { name: "phone" } | { name: "code"; phone: string; channel: "whatsapp" | "sms"; sent: number };

/** Phone → code. Calls `onVerified` once the session is signed in. Shared by Details and Login. */
export function OtpFlow({ onVerified }: { onVerified: () => void }) {
  const otp = useOtpLogin();
  const errorText = useErrorText();
  const [step, setStep] = useState<Step>({ name: "phone" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function start(phone: string) {
    setBusy(true);
    setError(undefined);
    try {
      const channel = await otp.start(phone);
      setStep({ name: "code", phone, channel, sent: Date.now() });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function verify(phone: string, code: string) {
    setBusy(true);
    setError(undefined);
    try {
      await otp.verify(phone, code);
      onVerified();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (step.name === "phone") return <PhoneStep onSubmit={start} busy={busy} error={error} />;
  return (
    <CodeStep
      channel={step.channel}
      key={step.sent}
      busy={busy}
      error={error}
      onVerify={(code) => verify(step.phone, code)}
      onResend={() => start(step.phone)}
      onChangeNumber={() => {
        setError(undefined);
        setStep({ name: "phone" });
      }}
    />
  );
}
