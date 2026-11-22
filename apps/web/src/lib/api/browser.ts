import { createApiClient, createCookieTokenStore, type ApiClient } from "@beautyspa/api-client";

let client: ApiClient | null = null;
let expiredHandler: (() => void) | null = null;

/** The session provider registers here to learn when the refresh cookie stops working. */
export function setSessionExpiredHandler(fn: (() => void) | null): void {
  expiredHandler = fn;
}

/** Browser singleton: access token in memory, refresh token in an httpOnly cookie. */
export function getBrowserApi(): ApiClient {
  client ??= createApiClient({
    baseUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001",
    transport: "cookie",
    tokenStore: createCookieTokenStore(),
    fetch: window.fetch.bind(window),
    refreshLock: async <T>(fn: () => Promise<T>): Promise<T> =>
      navigator.locks ? await navigator.locks.request("bs-refresh", fn) : fn(),
    onSessionExpired: () => expiredHandler?.(),
  });
  return client;
}
