import "server-only";
import type { PublicLocation } from "@beautyspa/contracts";
import { createApiClient, createCookieTokenStore, type ApiClient, type FetchLike } from "@beautyspa/api-client";

/** Wraps `fetch` so Next caches the response for `seconds`. */
export function revalidatingFetch(seconds: number): FetchLike {
  return (url, init) => fetch(url, { ...init, next: { revalidate: seconds } });
}

/** Per-request client for server components; public methods only. */
export function getServerApi(): Pick<ApiClient, "public"> {
  return createApiClient({
    baseUrl: process.env.API_URL ?? "http://localhost:3001",
    transport: "cookie",
    tokenStore: createCookieTokenStore(),
    fetch: revalidatingFetch(60),
  });
}

/** The location shown in the header; undefined (logged) when the API is unreachable so pages still render. */
export async function getPrimaryLocation(): Promise<PublicLocation | undefined> {
  try {
    const [location] = await getServerApi().public.locations();
    return location;
  } catch (err) {
    console.error("public locations unavailable", err instanceof Error ? err.name : "unknown error");
    return undefined;
  }
}
