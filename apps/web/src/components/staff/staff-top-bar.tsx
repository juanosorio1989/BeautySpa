"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { LocaleSwitch } from "@/components/locale-switch";
import { Link, useRouter } from "@/i18n/navigation";
import { getBrowserApi } from "@/lib/api/browser";
import { dropPushSubscription } from "@/lib/push";
import { useSession } from "@/lib/session/use-session";
import { useStaff } from "@/lib/staff/use-staff";

/** Location name, language switch, menu, name and role, and "Log out" for the staff panel. */
export function StaffTopBar() {
  const t = useTranslations("staff");
  const tNav = useTranslations("nav");
  const tErr = useTranslations("errors");
  const staff = useStaff();
  const session = useSession();
  const router = useRouter();
  const [locationName, setLocationName] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    getBrowserApi()
      .public.locations()
      .then((list) => setLocationName(list[0]?.name ?? ""))
      .catch(() => undefined); // the name is decoration; the panel works without it
  }, []);

  const canSeeClients = staff.role === "OWNER" || staff.role === "RECEPTION";

  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 pb-3 pt-5">
      <Link
        href="/staff"
        className="inline-flex min-h-11 items-center font-heading text-xl font-bold text-ink hover:text-ink"
      >
        {locationName || t("panel")}
      </Link>
      <LocaleSwitch />
      <nav aria-label={t("menu")} className="flex w-full flex-wrap items-center gap-x-4 text-sm font-medium">
        <Link href="/staff" className="flex min-h-11 items-center">
          {t("agenda")}
        </Link>
        {canSeeClients ? (
          <Link href="/staff/clients" className="flex min-h-11 items-center">
            {t("clients")}
          </Link>
        ) : null}
        <span className="flex min-h-11 items-center text-ink/70">
          {staff.name} · {t(`roles.${staff.role}`)}
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setFailed(false);
            try {
              await dropPushSubscription().catch(() => undefined);
              await session.logout();
            } catch {
              setFailed(true);
              setBusy(false);
              return;
            }
            router.replace("/staff/login");
            setBusy(false);
          }}
          className="flex min-h-11 items-center text-plum disabled:opacity-60"
        >
          {tNav("logout")}
        </button>
        {failed ? (
          <span role="alert" className="flex min-h-11 items-center text-warn">
            {tErr("network")}
          </span>
        ) : null}
      </nav>
    </header>
  );
}
