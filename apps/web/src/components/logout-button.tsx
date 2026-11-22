"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useSession } from "@/lib/session/use-session";

/**
 * "Log out" for signed-in visitors. On success the session is signed out (booking store cleared)
 * and it goes home; on failure the visitor is still signed in, so it shows the network error and
 * stays for a retry.
 */
export function LogoutButton() {
  const t = useTranslations();
  const session = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // The header is on every page: learn quietly whether the visitor is signed in (pages that need
  // the session show their own errors; the shared refresh means no extra request for them).
  useEffect(() => {
    if (session.status === "loading") session.ensure().catch(() => undefined);
    // once per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (session.status !== "signedIn") return null;
  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setFailed(false);
          try {
            await session.logout();
          } catch {
            setFailed(true);
            setBusy(false);
            return;
          }
          router.replace("/");
          setBusy(false);
        }}
        className="flex min-h-11 items-center text-sm font-medium text-plum disabled:opacity-60"
      >
        {t("nav.logout")}
      </button>
      {failed ? (
        <span role="alert" className="flex min-h-11 items-center text-sm text-warn">
          {t("errors.network")}
        </span>
      ) : null}
    </>
  );
}
