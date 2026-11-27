import type { Locale } from "@beautyspa/i18n";

/** A same-site path from `?next=`, or `/<locale>/<fallback>` (`me` by default). Rejects absolute and protocol-relative urls. */
export function safeNext(raw: string | null, locale: Locale, fallback = "me"): string {
  const ok =
    raw !== null && raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\") && !/[\s\\]/.test(raw);
  return ok ? raw : `/${locale}/${fallback}`;
}
