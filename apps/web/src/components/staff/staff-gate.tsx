"use client";

import { ApiError } from "@beautyspa/api-client";
import type { StaffMe } from "@beautyspa/contracts";
import { useLocale } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { LoadError } from "@/components/me/load-error";
import { getBrowserApi, setSessionExpiredHandler } from "@/lib/api/browser";
import { useSession } from "@/lib/session/use-session";
import { staffLoginPath } from "@/lib/staff/login-path";
import { StaffContext } from "@/lib/staff/use-staff";

/**
 * Staff session gate: no session or a customer session goes to `/<locale>/staff/login?next=<path?query>`
 * (`&customer=1` for a customer); network and 5xx errors show a retry. Also catches a refresh token
 * that expires later (e.g. while polling).
 */
export function StaffGate({ children }: { children: ReactNode }) {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const session = useSession();
  const [staff, setStaff] = useState<StaffMe | null>(null);
  const [error, setError] = useState<{ cause: unknown } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const pathRef = useRef({ pathname, search });
  const sessionRef = useRef(session);
  useEffect(() => {
    pathRef.current = { pathname, search };
    sessionRef.current = session;
  });

  useEffect(() => {
    let cancelled = false;
    const toLogin = (customer: boolean) =>
      router.replace(staffLoginPath(locale, pathRef.current.pathname, pathRef.current.search, customer));
    (async () => {
      if (!(await sessionRef.current.ensure())) {
        if (!cancelled) toLogin(false);
        return;
      }
      let me: StaffMe;
      try {
        me = await getBrowserApi().staff.me();
      } catch (err) {
        if (err instanceof ApiError && (err.status === 403 || err.status === 401)) {
          if (!cancelled) toLogin(err.status === 403);
          return;
        }
        throw err;
      }
      if (cancelled) return;
      setStaff(me);
      // Registered after the provider's own effect so it is not overwritten.
      setSessionExpiredHandler(() => {
        sessionRef.current.logout({ local: true }).catch(() => undefined);
        toLogin(false);
      });
    })().catch((cause: unknown) => {
      if (!cancelled) setError({ cause });
    });
    return () => {
      cancelled = true;
      // Back to the provider's behavior: mark the session signed out.
      setSessionExpiredHandler(() => void sessionRef.current.logout({ local: true }).catch(() => undefined));
    };
    // `router` is stable for the page lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, locale]);

  if (error) {
    return (
      <div className="px-5 py-8">
        <LoadError
          error={error.cause}
          onRetry={() => {
            setError(null);
            setAttempt((n) => n + 1);
          }}
        />
      </div>
    );
  }
  if (!staff) return null;
  return <StaffContext.Provider value={staff}>{children}</StaffContext.Provider>;
}
