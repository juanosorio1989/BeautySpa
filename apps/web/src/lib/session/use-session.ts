"use client";

import { createContext, useContext } from "react";

export type SessionStatus = "loading" | "signedIn" | "signedOut" | "error";

export interface Session {
  status: SessionStatus;
  /**
   * Resolves true when signed in, false when signed out (401/403 on refresh).
   * Already signedIn: resolves true without refreshing (api-client refreshes on 401).
   * Otherwise refreshes once (shared promise). Network/5xx/429: status becomes
   * "error" and the promise rejects; callers show errorMessageKey + retry, and
   * a later ensure() retries.
   */
  ensure(): Promise<boolean>;
  /** Call after a successful login. */
  signedIn(): void;
  logout(): Promise<void>;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}
