"use client";

import { ApiError } from "@beautyspa/api-client";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getBrowserApi, setSessionExpiredHandler } from "@/lib/api/browser";
import { SessionContext, type Session, type SessionStatus } from "./use-session";

export const BOOKING_STORE_KEY = "bs-booking";

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>("loading");
  const pending = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    setSessionExpiredHandler(() => setStatus("signedOut"));
    return () => setSessionExpiredHandler(null);
  }, []);

  const ensure = useCallback((): Promise<boolean> => {
    pending.current ??= getBrowserApi()
      .auth.refresh()
      .then(
        () => {
          setStatus("signedIn");
          return true;
        },
        (err: unknown) => {
          if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
            setStatus("signedOut");
            return false;
          }
          throw err;
        },
      )
      .finally(() => {
        pending.current = null;
      });
    return pending.current;
  }, []);

  const signedIn = useCallback(() => setStatus("signedIn"), []);

  const logout = useCallback(async () => {
    try {
      await getBrowserApi().auth.logout();
    } finally {
      try {
        sessionStorage.removeItem(BOOKING_STORE_KEY);
      } catch {
        // sessionStorage unavailable: nothing to clear
      }
      setStatus("signedOut");
    }
  }, []);

  const value = useMemo<Session>(() => ({ status, ensure, signedIn, logout }), [status, ensure, signedIn, logout]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
