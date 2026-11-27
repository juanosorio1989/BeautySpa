"use client";

import type { MfaEnrollConfirmResponse } from "@beautyspa/contracts";
import { useTranslations } from "next-intl";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import { getBrowserApi } from "@/lib/api/browser";
import { useErrorText } from "@/lib/use-error-text";
import { CodeForm } from "./code-form";

/** First-time authenticator enrollment: QR and secret, then the code that proves the app works. */
export function EnrollStep({
  mfaToken,
  onEnrolled,
}: {
  mfaToken: string;
  onEnrolled: (result: MfaEnrollConfirmResponse) => void;
}) {
  const t = useTranslations("staff.auth");
  const errorText = useErrorText();
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [loadError, setLoadError] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      const { secret, otpauthUrl } = await getBrowserApi().auth.mfaEnrollStart({ mfaToken });
      setSetup({ secret, qr: await QRCode.toDataURL(otpauthUrl) });
    })().catch((err: unknown) => setLoadError(errorText(err)));
    // once per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function confirm(code: string) {
    setBusy(true);
    setError(undefined);
    try {
      onEnrolled(await getBrowserApi().auth.mfaEnrollConfirm({ mfaToken, code }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (loadError)
    return (
      <p role="alert" className="text-sm text-warn">
        {loadError}
      </p>
    );
  if (!setup) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-heading text-lg font-semibold">{t("enrollTitle")}</h2>
      <p className="text-sm text-muted">{t("enrollBody")}</p>
      {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL, nothing to optimize */}
      <img src={setup.qr} alt={t("qrAlt")} width={200} height={200} className="self-center" />
      <p className="text-sm">
        {t("secretLabel")} <code className="break-all font-mono">{setup.secret}</code>
      </p>
      <CodeForm onSubmit={(c) => void confirm(c)} busy={busy} error={error} submitLabel={t("enrollConfirm")} />
    </section>
  );
}
