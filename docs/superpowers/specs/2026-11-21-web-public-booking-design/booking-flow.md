# Booking flow

```
Services (/) → Professional + time (/book/time) → [POST /holds]
  → Details (/book/details): phone → code → name/email/consent (first time only)
  → [PATCH /me] → [POST /appointments] → Done (/book/done/:id)
```

A customer who already has a session skips phone and code: Details shows only
what is missing (name if `me.name` is null), then Confirm.

## Booking state

A client-side store holds `{ serviceIds, choices: [{ serviceId, employeeId | "ANY" }], date, slot, hold: { holdId, expiresAt, localExpiresAt } }`,
persisted to `sessionStorage` (wrapped in try/catch; works without it). A page
reached with missing prerequisites redirects to the previous step. State is
cleared after a successful booking.

Implementation (`apps/web/src/lib/booking/`): `store.ts` is a small external
store (`useBookingStore()`, key `bs-booking`; `ready` is false until
`sessionStorage` is read, so redirects wait for it). `reset()` clears memory and `sessionStorage`; a successful `logout()` calls it. The stored
hold (`StoredHold`, `hold-slot.ts`) adds `localExpiresAt`: the device time when
the hold arrived plus the location's `booking.holdMinutes` (epoch ms). Every
"still valid" check and the countdown use it, never the server's `expiresAt`,
so a device clock that runs fast or slow cannot expire a fresh hold; the API
still decides (`HOLD_EXPIRED`). A stored hold without `localExpiresAt` (older
shape) is dropped on read. `toggleService`, `setChoice` and `prefill` clear the
hold (it no longer matches the selection) and release it best effort, so going
Forward to Details cannot book stale services (Details sends a store without a
hold back to step 2). With the catalog's ids, `toggleService` counts only
services still in the catalog toward the 4-service limit. `TimePicker`
(`components/booking/time-picker.tsx`) takes the selected services, employees
and choices as props and has optional `excludeAppointmentId` and `onPick` (the
reschedule page uses them); by default it holds the slot and goes to Details.

## Step 1 — Services

- Up to 4 services (the API limit); a fifth tap shows a short notice.
- `?service=<id>` preselects one (from the services page or "Book again").
- Continue disabled with zero services.

## Step 2 — Professional and time

- Per selected service: chips "Any" + each professional whose `serviceIds`
  include it (from `GET /public/employees`). Default "Any".
- Date strip: today in the location timezone through `bookingHorizonDays`
  (from the location's booking settings), horizontally scrollable, 7 visible.
- Slots: `GET /availability?services=<id>:<emp|ANY>&...&date=` for the selected
  date only (refetch when choices or date change). Time shown in the location
  timezone. Empty → "No times this day" + a "Next day with times" button that
  queries the following days one by one (stop after 14 days or the horizon).
- When the slot has parallel segments, show the mockup hint "Manicure and
  pedicure at the same time, with two professionals" (derived from segment
  overlap in the returned slot, not computed).
- Footer: chosen day and time range, each service with its assigned
  professional's name and exact price (from the slot's segments), and their
  exact total. Button
  "Hold this time" → `POST /holds { segments }` (segments copied from the slot).
  - On arrival at `/book/time` (e.g. Back from Details) a stored hold is
    released with `DELETE /holds/:holdId` (best effort, errors ignored) and
    cleared before availability loads: availability hides every live hold,
    the customer's own included, so its slot would otherwise be missing.
  - Before holding: a stored hold is always dropped; while still locally
    valid it is released first (best effort: errors are ignored, the hold
    would expire anyway). Then a new hold is created.
  - 201 → store hold, go to Details.
  - 409 `SLOT_TAKEN` → toast "Someone just took that time", refetch slots.
  - 429 → "Too many tries, wait a minute".

## Step 3 — Details

- Countdown banner "We're holding your time for m:ss", measured from the time
  the device received the hold with the configured hold length
  (`localExpiresAt`), not from the server's `expiresAt` (device clocks may be
  skewed; web never extends it). At 0 → back to step 2 with "Your hold
  expired, pick a time again".
- Phone: `+1` fixed prefix and a US number field, formatted as typed, converted
  to E.164 before sending. `POST /auth/otp/start { phone, locale }`.
- Code: six-digit field (`inputmode="numeric"`, `autocomplete="one-time-code"`),
  label uses the returned `channel` ("We sent you a code on WhatsApp" /
  "We texted you a code"). "Resend code"
  re-calls start (disabled 30 s). Wrong code → inline error; 429 → wait
  message. Success → tokens stored, then `GET /me`.
- First time (`me.name` null): name (required), email (optional), checkbox
  "Email me my confirmation and reminders" (unticked; enabled only with an
  email). Language = page locale. On Confirm: `PATCH /me { name, locale,
  email?, consents: { EMAIL: true }?, consentSource: "BOOKING_FORM" }` (only
  changed keys; `consentSource` only with `consents`), then book.
- Returning: show "Booking as <name>" with "Not you?" (logs out, back to phone).
- Implementation (`app/[locale]/book/details/page.tsx`): `OtpFlow` (phone and code
  steps, shared with `/login`) uses `useOtpLogin` (`lib/session/use-otp-login.ts`).
  A hold already past `localExpiresAt` is sent back by `HoldCountdown` on mount. The
  way back to step 2 carries `?notice=expired` or `?notice=conflict`
  (`TimeNotice`). "Not you?" logs out, then restores the booking store (services,
  slot, hold) so the held time is kept for the next account. If logout fails the
  customer is still signed in and the store (hold included) is untouched: it
  shows the network message with a retry. A session `error`
  status shows the network message with a retry that calls `ensure()` again.
  `PATCH /me` and `POST /appointments` have separate error handling: a profile
  error keeps the hold; `HOLD_EXPIRED` and `NOT_FOUND` on book clear the hold and
  go back with the expired notice; `CONFLICT` only applies to the book call.
  Field errors show localized copy (`errors.field.*`) only for fields on screen
  (the input gets `aria-invalid` and `aria-describedby` the error), else
  `errors.generic`. `TimeNotice` drops `?notice=` from the URL
  after the first render. After booking, `reset()` clears the store and sessionStorage, then Done.
- Optional "Note for the salon" field (`notes`, ≤ 500 chars, visible to the
  customer later).
- Confirm → `POST /appointments { holdId, notes? }`:
  - 201 → Done.
  - 409 `HOLD_EXPIRED` → back to step 2 with the expired message.
  - 409 `CONFLICT` (the hold was already used) → "This time is no longer
    available", clear the hold, back to step 2, with a link to My
    appointments in case the customer booked it in another tab.
  - 400 path `name` → show the name field.

## Step 4 — Done

- Reads the appointment from `GET /me/appointments` (by id) so a reload works.
- Mockup 4: "You're all set, <name>!", date, time range, each service with
  professional and price, "Total at the salon", location address.
- If the customer has no email consent: card "Want your confirmation and
  reminders by email?" with an email field (prefilled when known) and "Yes,
  email me" → `PATCH /me { email, consents: { EMAIL: true }, consentSource:
  "BOOKING_FORM" }`. Shown once per
  booking; hidden after success. (Messages start once plan 05 lands.)
- Signed-out visitors (reload after the session ended) go to
  `/<locale>/login?next=<this page>`; `/login` returns to `safeNext(next)`
  (same-site paths only, else `/<locale>/me`).
- Links: "See or change my appointments" → `/me`; "Book another".

## Client area actions

- Cancel: confirmation sheet with optional reason → `POST
  /me/appointments/:id/cancel`. 409 `OUTSIDE_CANCEL_WINDOW` → "It's too late to
  cancel online, call the salon" + tap-to-call phone. The Cancel button is
  hidden when `now > startsAt - cancelWindowHours` (display hint only; the API
  decides).
- Change time: reschedule page; the API keeps services fixed. 409 `SLOT_TAKEN` →
  refetch, old time kept. Same window rule as cancel.
- Book again: `POST /me/appointments/:id/repeat` → fill the booking store with
  its `services` (skip to step 2; empty list → step 1).
- Delete account: `DELETE /me`, then `logout()` (clears the cookie and the
  in-memory token; `/auth/logout` answers 204 for revoked tokens), clear the
  booking store, home with a "Your account was deleted" notice.

Implementation (`app/[locale]/me/`, `components/me/`, `lib/me/window.ts`):

- Every client-area page uses `useAuthedLoad` (`lib/session/use-authed-load.ts`): it waits for
  `session.ensure()`, sends signed-out visitors to `/<locale>/login?next=<encoded path>`, and
  shows `LoadError` (localized copy and retry) when the session `error` status or the load fails.
- Cancel and Change time show only while `canChangeOnline` is true; otherwise the card shows the
  call-the-salon message (`CallSalon`, `tel:` link from `PublicLocation.phone`). The API still decides:
  `OUTSIDE_CANCEL_WINDOW` from cancel or reschedule shows the same message. After a cancel the card moves to Past.
- Reschedule reuses `TimePicker` with `excludeAppointmentId` and `onPick` (calls `me.reschedule`, then goes to
  `/me`). Choices start from the appointment's segments; `SLOT_TAKEN` is rethrown so the picker refetches and the
  old time is kept.
- Profile sends only changed fields. The email switch sends `consents: { EMAIL }` without `consentSource`
  (the API records `PROFILE`) and is disabled without an email. A language change patches `locale`, then
  `router.replace(pathname, { locale })`. Export is a `Blob` object URL saved as `beautyspa-my-data.json`.
- Delete account: two buttons, then `me.remove()`, `session.logout()` (resets the booking store), `/?deleted=1`
  (`DeletedNotice` on the home page).
- Validation errors never show API text: the field copy (`errors.field.*`) for fields on screen, else
  `errors.generic` (`useFallbackErrorText`).
- Profile language starts from the stored `me.locale`; `locale` is patched only when it differs from it, and the URL
  switches whenever the selection differs from the page locale. The header shows "Log out" (`LogoutButton`) when
  signed in. The cancel sheet is a native modal `<dialog>`. The Done page also loads through `useAuthedLoad`.
