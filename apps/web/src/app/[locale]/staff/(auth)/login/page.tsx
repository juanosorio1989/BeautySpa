"use client";

import { ApiError } from "@beautyspa/api-client";
import type { Locale } from "@beautyspa/i18n";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { StaffLoginFlow } from "@/components/staff/auth/staff-login-flow";
import { getBrowserApi } from "@/lib/api/browser";
import { safeNext } from "@/lib/safe-next";
import { useSession } from "@/lib/session/use-session";

function LoginForm() {
  const t = useTranslations("staff.auth");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const session = useSession();
  const params = useSearchParams();
  const target = safeNext(params.get("next"), locale, "staff");
  const [customer, setCustomer] = useState(params.get("customer") === "1");

  // A live session is learned quietly: staff goes straight to `next`, a customer sees the notice.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!(await session.ensure())) return;
      try {
        await getBrowserApi().staff.me();
        if (!cancelled) router.replace(target);
      } catch (err) {
        if (err instanceof ApiError && err.status === 403 && !cancelled) setCustomer(true);
      }
    })().catch(() => undefined); // signed out or offline: the form below still works
    return () => {
      cancelled = true;
    };
    // once per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <h1 className="font-heading text-xl font-semibold">{t("title")}</h1>
      {customer ? (
        <p role="status" className="rounded-xl border border-line-strong bg-card p-3 text-sm">
          {t("customerNotice")}
        </p>
      ) : null}
      <StaffLoginFlow onDone={() => router.push(target)} />
    </>
  );
}

export default function StaffLoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
