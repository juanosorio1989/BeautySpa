"use client";

import type { MfaEnrollConfirmResponse } from "@beautyspa/contracts";
import { useTranslations } from "next-intl";
import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@/i18n/navigation";
import { getBrowserApi } from "@/lib/api/browser";
import { isUnauthorized } from "@/lib/errors";
import { useErrorText } from "@/lib/use-error-text";
import { CodeForm, LINK_BUTTON, PRIMARY_BUTTON } from "./code-form";

/**
 * First-time authenticator enrollment: QR and secret, then the code that proves the app works.
 * An expired `mfaToken` (401) calls `onExpired`; another load error offers Try again and a way back.
 */
export function EnrollStep({
  mfaToken,
  onEnrolled,
  onExpired,
}: {
  mfaToken: string;
  onEnrolled: (result: MfaEnrollConfirmResponse) => void;
  onExpired: () => void;
}) {
  const t = useTranslations("staff.auth");
  const tCommon = useTranslations("common");
  const errorText = useErrorText();
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [loadError, setLoadError] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  const load = useCallback(() => {
    setLoadError(undefined);
    (async () => {
      const { secret, otpauthUrl } = await getBrowserApi().auth.mfaEnrollStart({ mfaToken });
      setSetup({ secret, qr: await QRCode.toDataURL(otpauthUrl) });
    })().catch((err: unknown) => (isUnauthorized(err) ? onExpired() : setLoadError(errorText(err))));
    // errorText and onExpired are fresh each render; the token is what matters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mfaToken]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    load();
  }, [load]);

  async function confirm(code: string) {
    setBusy(true);
    setError(undefined);
    try {
      onEnrolled(await getBrowserApi().auth.mfaEnrollConfirm({ mfaToken, code }));
    } catch (err) {
      if (isUnauthorized(err)) onExpired();
      else setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (loadError)
    return (
      <div className="flex flex-col gap-3">
        <p role="alert" className="text-sm text-warn">
          {loadError}
        </p>
        <button type="button" className={PRIMARY_BUTTON} onClick={load}>
          {tCommon("retry")}
        </button>
        <Link href="/staff/login" className={`flex items-center ${LINK_BUTTON}`}>
          {t("backToLogin")}
        </Link>
      </div>
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
