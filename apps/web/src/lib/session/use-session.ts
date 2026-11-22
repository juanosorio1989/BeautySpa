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
  /**
   * Revokes the refresh cookie (POST /auth/logout); only on success clears the booking store and
   * sets status "signedOut". On failure it rejects and the status stays as it was (the cookie is
   * still valid; callers show errors.network + retry). `local: true` skips the request and only
   * resets locally (the server already revoked the session, e.g. after DELETE /me).
   */
  logout(opts?: { local?: boolean }): Promise<void>;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}
