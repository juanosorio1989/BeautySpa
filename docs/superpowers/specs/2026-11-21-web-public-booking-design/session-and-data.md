# Session, data access and errors

## Two data paths

| Where | How | Auth |
|---|---|---|
| Server components (public pages, step 1 data) | `createApiClient({ baseUrl: API_URL, transport: "cookie", tokenStore: createCookieTokenStore(), fetch: revalidatingFetch(60) })` per request, public methods only. `revalidatingFetch(s)` is a web-side `FetchLike` wrapper that calls `fetch(url, { ...init, next: { revalidate: s } })` (`api-client` forwards only method, headers, body, credentials) | none |
| Client components (booking, client area, login) | one browser `api-client` instance (module singleton) with `baseUrl: NEXT_PUBLIC_API_URL`, `createCookieTokenStore()`, `refreshLock: (fn) => navigator.locks.request("bs-refresh", fn)` (fall back to running `fn` directly when `navigator.locks` is missing) | access token in memory, refresh cookie |

`API_URL` may differ from `NEXT_PUBLIC_API_URL` (server-to-server address in
containers); both are the API origin without `/v1` (the client adds it); dev default `http://localhost:3001`.

## Session

- On load of any page that needs it, the session provider calls `refresh()`
  once (shared promise). Success → signed in; 401/403 → signed out; network,
  5xx or 429 → status `error` and `ensure()` rejects (callers show the error
  with a retry; a later `ensure()` refreshes again). The header checks the
  session quietly on every page, so it shows "My appointments" either way and
  signed-in users also see "Log out".
- Access token expiry is handled by `api-client` (refresh once on 401).
- `refreshLock` with Web Locks serializes refreshes across tabs, so two tabs
  never present the same rotated token (which would revoke the family).
- Log out: `logout()` calls `POST /auth/logout`. Only when it succeeds is the
  booking store cleared and the status set to signed out. When it fails the
  refresh cookie is still valid, so the visitor stays signed in (the dropped
  access token is renewed by the next `ensure()`), nothing is cleared, and the
  caller shows `errors.network` with a retry (header Log out, "Not you?"). On a
  shared device the visitor is never told they are logged out while they are
  not. `logout({ local: true })` skips the request and only resets locally; it
  is used after a successful `DELETE /me` when the logout call fails (the server
  already revoked every session of that account).
- One session per browser: customer and staff share the `bs_refresh` cookie;
  whichever logs in last owns it. The staff login shows a notice when a customer
  session is active (implemented in plan 07a).
- Locale: the URL locale wins for the UI. `PATCH /me { locale }` is sent on
  first booking and when the user changes language in profile, so messages
  (plan 05) use it.

## `api-client` additions

Typed methods (contracts-validated, like existing ones), grouped as in code:
`public.locations`, `public.services`, `public.employees`;
`booking.availability`, `booking.createHold`, `booking.releaseHold`,
`booking.book`; `me.get`, `me.patch`, `me.appointments`, `me.cancel`,
`me.reschedule`, `me.repeat`, `me.export`, `me.remove`. Each with unit tests in
`packages/api-client`. No DOM types in the package (platform
rule); `navigator.locks` is passed in from web.

## Errors

API errors are RFC 7807 `Problem` objects (`ApiError` in `api-client`). Web maps
by `code`, never by message text:

| Code | UI |
|---|---|
| `SLOT_TAKEN` | "That time was just taken", refetch slots |
| `HOLD_EXPIRED` | back to time step, expired message |
| `OUTSIDE_CANCEL_WINDOW` | too late + call the salon |
| `CONFLICT` | context message (already booked / not changeable) |
| `VALIDATION_FAILED` | field error by `path` when the field is on screen, else generic |
| `OTP_INVALID` | "That code is not right" under the code field |
| `RATE_LIMITED` / 429 | "Too many tries, wait a moment"; on the session refresh, status becomes `error` like a network failure |
| 401 after refresh failed | to login with `next` |
| network (`TypeError`, `errors.network`) | "We could not reach the server, check your connection" with retry; session status becomes `error` |
| 5xx | "Something went wrong, try again" (`errors.generic`) with retry; on the session refresh, status becomes `error` |

Error copy lives in the catalogs under `errors.<code>`.
