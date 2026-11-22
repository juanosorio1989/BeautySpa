import type { Locale } from "@beautyspa/i18n";

/** A same-site path from `?next=`, or `/<locale>/me`. Rejects absolute and protocol-relative urls. */
export function safeNext(raw: string | null, locale: Locale): string {
  const ok =
    raw !== null && raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\") && !/[\s\\]/.test(raw);
  return ok ? raw : `/${locale}/me`;
}
