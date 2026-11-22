"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { getBrowserApi } from "@/lib/api/browser";
import { useSession } from "@/lib/session/use-session";
import { useFallbackErrorText } from "@/lib/use-error-text";

/** Two explicit steps: "Delete my account", then "Yes, delete my account". */
export function DeleteAccount() {
  const t = useTranslations("profile");
  const router = useRouter();
  const session = useSession();
  const errorText = useFallbackErrorText();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const wasConfirming = useRef(false);

  // Focus follows the swap: heading when the confirm opens, trigger when it closes.
  useEffect(() => {
    if (confirming) heading.current?.focus();
    else if (wasConfirming.current) trigger.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await getBrowserApi().me.remove();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
      return;
    }
    try {
      await session.logout(); // clears the cookie, the in-memory token and the booking store
    } catch {
      // The server already revoked every session of the deleted account: end it here too.
      await session.logout({ local: true });
    }
    router.replace("/?deleted=1");
  }

  if (!confirming)
    return (
      <button
        type="button"
        ref={trigger}
        onClick={() => setConfirming(true)}
        className="min-h-11 self-start rounded-xl px-[18px] text-[15px] font-semibold text-warn underline"
      >
        {t("delete")}
      </button>
    );

  return (
    <section aria-labelledby="delete-title" className="flex flex-col gap-3 rounded-[18px] bg-warn-bg p-[18px]">
      <h2
        id="delete-title"
        ref={heading}
        tabIndex={-1}
        className="font-heading text-lg font-semibold text-warn outline-none"
      >
        {t("deleteTitle")}
      </h2>
      <p className="text-[15px] text-warn">{t("deleteBody")}</p>
      {error ? (
        <p role="alert" className="text-sm text-warn">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        disabled={busy}
        onClick={() => void remove()}
        className="min-h-[52px] rounded-[14px] bg-warn text-base font-semibold text-white disabled:opacity-60"
      >
        {busy ? t("deleting") : t("deleteConfirm")}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => setConfirming(false)}
        className="min-h-11 rounded-[14px] text-[15px] font-semibold text-ink"
      >
        {t("deleteKeep")}
      </button>
    </section>
  );
}
