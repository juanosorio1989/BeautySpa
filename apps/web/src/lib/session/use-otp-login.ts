"use client";

import { useLocale } from "next-intl";
import type { Locale } from "@beautyspa/i18n";
import { getBrowserApi } from "@/lib/api/browser";
import { useSession } from "./use-session";

/** Phone + code login with the page locale; `verify` marks the session signed in. */
export function useOtpLogin(): {
  start(phone: string): Promise<"whatsapp" | "sms">;
  verify(phone: string, code: string): Promise<void>;
} {
  const locale = useLocale() as Locale;
  const session = useSession();
  return {
    async start(phone) {
      const res = await getBrowserApi().auth.otpStart({ phone, locale });
      return res.channel;
    },
    async verify(phone, code) {
      await getBrowserApi().auth.otpVerify({ phone, code, locale });
      session.signedIn();
    },
  };
}
