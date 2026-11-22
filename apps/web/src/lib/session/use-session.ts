"use client";

import { createContext, useContext } from "react";

export type SessionStatus = "loading" | "signedIn" | "signedOut";

export interface Session {
  status: SessionStatus;
  /** Refreshes once (shared promise); resolves true when signed in. */
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
