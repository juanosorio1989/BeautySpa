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
  once (shared promise). Success → signed in; 401 → signed out. The header shows
  "My appointments" either way; signed-in users also see "Log out".
- Access token expiry is handled by `api-client` (refresh once on 401).
- `refreshLock` with Web Locks serializes refreshes across tabs, so two tabs
  never present the same rotated token (which would revoke the family).
- Log out: `logout()` then clear the booking store.
- One session per browser: customer and staff share the `bs_refresh` cookie;
  whichever logs in last owns it. Plan 07 shows a notice on the staff login when
  a customer session is active.
- Locale: the URL locale wins for the UI. `PATCH /me { locale }` is sent on
  first booking and when the user changes language in profile, so messages
  (plan 05) use it.

## `api-client` additions

Typed methods (contracts-validated, like existing ones) for: `publicLocations`,
`publicServices`, `publicEmployees`, `availability`, `createHold`,
`bookAppointment`, `getMe`, `patchMe`, `myAppointments`, `cancelMyAppointment`,
`rescheduleMyAppointment`, `repeatMyAppointment`, `exportMe`, `deleteMe`. Each
with unit tests in `packages/api-client`. No DOM types in the package (platform
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
| `RATE_LIMITED` / 429 | "Too many tries, wait a moment" |
| 401 after refresh failed | to login with `next` |
| network / 5xx | "Something went wrong, try again" with retry |

Error copy lives in the catalogs under `errors.<code>`.
