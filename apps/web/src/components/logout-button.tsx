"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useSession } from "@/lib/session/use-session";

/** "Log out" for signed-in visitors; logs out (which resets the booking store) and goes home. */
export function LogoutButton() {
  const t = useTranslations("nav");
  const session = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (session.status !== "signedIn") return null;
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await session.logout();
        } catch {
          // logout() already treats the session as signed out
        }
        router.replace("/");
        setBusy(false);
      }}
      className="flex min-h-11 items-center text-sm font-medium text-plum disabled:opacity-60"
    >
      {t("logout")}
    </button>
  );
}
