"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import type { Locale } from "@beautyspa/i18n";
import { BackHeader } from "@/components/booking/back-header";
import { OtpFlow } from "@/components/booking/otp-flow";
import { safeNext } from "@/lib/safe-next";

function LoginForm() {
  const locale = useLocale() as Locale;
  const router = useRouter();
  const next = useSearchParams().get("next");
  return (
    <div className="px-5 pt-5">
      <OtpFlow onVerified={() => router.push(safeNext(next, locale))} />
    </div>
  );
}

export default function LoginPage() {
  const t = useTranslations("login");
  return (
    <main>
      <BackHeader href="/" backLabel={t("back")} title={t("title")} />
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
