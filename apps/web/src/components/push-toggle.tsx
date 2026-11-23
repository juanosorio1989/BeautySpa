"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { getBrowserApi } from "@/lib/api/browser";
import { disablePush, enablePush, getPushSupport, type PushConsentSource, type PushSupport } from "@/lib/push";

/** "Notify me on this device": web push opt-in. Hidden when the browser or server cannot do push. */
export function PushToggle({ consentSource }: { consentSource: PushConsentSource }) {
  const t = useTranslations("push");
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    void getPushSupport(getBrowserApi()).then((s) => {
      if (live) setSupport(s);
    });
    return () => {
      live = false;
    };
  }, []);

  if (support === null || support === "unsupported") return null;
  if (support === "needs-install" || support === "denied") {
    return <p className="text-sm text-muted">{t(support === "denied" ? "denied" : "needsInstall")}</p>;
  }

  async function toggle() {
    setBusy(true);
    setFailed(false);
    try {
      const api = getBrowserApi();
      if (support === "subscribed") {
        await disablePush(api);
        setSupport("available");
      } else {
        setSupport(await enablePush(api, consentSource));
      }
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={busy}
        className="min-h-11 self-start rounded-xl border border-plum px-[18px] text-[15px] font-semibold text-plum hover:bg-plum-tint disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? t("working") : support === "subscribed" ? t("disable") : t("enable")}
      </button>
      {failed ? (
        <p role="alert" className="text-sm text-warn">
          {t("failed")}
        </p>
      ) : null}
    </div>
  );
}
