# Screens and flows

All routes under `/[locale]/staff`. A server `layout.tsx` sends
`robots: { index: false }`; `robots.txt` disallows `/*/staff`. Pages other
than sign-in, invite and reset need a **staff** session: on load
`ensure()`; no session → `/[locale]/staff/login?next=<path>`; a customer
session → the same login page (with the notice below).

Staff layout: top bar with location name, EN/ES switch, a menu with
"Agenda", "Clients" (OWNER/RECEPTION), the signed-in name and role (`GET /staff/me`), "Log out"
(same confirm-before-clearing rule as plan 06). Visual tokens as plan 06;
desktop uses the full width (no 480 px column) for the agenda.

| Route                  | Who              | Content                                                                                                                                                                                                                                                                                                                                                                                            | API                                                                                                                  |
| ---------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `/staff/login`         | public           | Email + password → next step by response: `MFA_REQUIRED` → 6-digit code (link "Use a recovery code": it does not sign in; it clears TOTP and returns `ENROLL_REQUIRED`, so the user enrolls a new authenticator); `ENROLL_REQUIRED` → enrollment. Notice "You are signed in as a client on this device; signing in as staff will sign that out" when the session provider holds a customer session | `POST /auth/staff/login`, `/mfa/verify`, `/mfa/recover`                                                              |
| (step) enrollment      | public           | QR of `otpauthUrl` (rendered client-side, no external service) + the secret as text, code field; on success show the 10 recovery codes once with "Copy" and "I saved them" (required tick) before continuing                                                                                                                                                                                       | `/mfa/enroll`, `/mfa/enroll/confirm`                                                                                 |
| `/staff/invite?token=` | public           | Set password (twice, rules shown); the response is already an MFA step (`ENROLL_REQUIRED` + `mfaToken`), so go straight to enrollment                                                                                                                                                                                                                                                              | `POST /auth/staff/invite/accept`                                                                                     |
| `/staff/reset?token=`  | public           | New password (twice) → login                                                                                                                                                                                                                                                                                                                                                                       | `POST /auth/staff/password/reset`                                                                                    |
| `/staff/forgot`        | public           | Email → always "If that email exists, we sent a link"                                                                                                                                                                                                                                                                                                                                              | `POST /auth/staff/password/forgot`                                                                                   |
| `/staff`               | all staff        | Day agenda (below); `?date=YYYY-MM-DD`                                                                                                                                                                                                                                                                                                                                                             | `GET /staff/agenda` (extended, carries the names it needs), `GET /staff/me`                                          |
| `/staff/book`          | OWNER, RECEPTION | Quick booking (below); `?date=&time=&employeeId=&customerId=` prefill                                                                                                                                                                                                                                                                                                                              | `/staff/customers`, `/staff/booking-catalog`, `/availability` (staff token → STAFF mode), `POST /staff/appointments` |
| `/staff/walk-in`       | OWNER, RECEPTION | Walk-in (below)                                                                                                                                                                                                                                                                                                                                                                                    | `POST /staff/walk-in`                                                                                                |
| `/staff/clients`       | OWNER, RECEPTION | Search box (≥ 2 chars, debounced 300 ms) → list name, phone; "New client"                                                                                                                                                                                                                                                                                                                          | `GET /staff/customers?q=`                                                                                            |
| `/staff/clients/[id]`  | OWNER, RECEPTION | Name, phone (tap to call), email, language, consents (read), upcoming and past appointments (past capped at 20; staff see all cancel reasons), private notes editor, "Book" (→ `/staff/book?customerId=`)                                                                                                                                                                                          | `GET /staff/customers/:id`, `GET /staff/customers/:id/appointments`, notes endpoints (all new, api-additions.md)     |

EMPLOYEE opening an OWNER/RECEPTION page gets a "not available for your role"
screen with a link to the agenda (the API would 403 anyway).

## Day agenda (mockup 5)

- Header: date with previous / next day and a date picker; "Today" button when
  not on today; buttons "+ New" (→ `/staff/book`) and "Walk-in" (OWNER,
  RECEPTION).
- Professional chips (filter which columns show; remembered in
  `localStorage`). Every segment has an employee, so there is no "Unassigned"
  column. An employee who is inactive or no longer at the location but still
  has segments that day gets a column marked "Not active — move these
  appointments" (agenda `employees[].active = false`), so deactivation never
  hides appointments.
- **Phone (< 768 px):** one column at a time, swipe or chip tap to switch.
  **Tablet / desktop (≥ 768 px):** visible columns side by side, horizontal
  scroll when they do not fit.
- Timeline from the earliest working-hours start to the latest end of the
  shown employees that day, from the agenda's `employees[].ranges` (fall back
  9:00–19:00 when nobody works), 15-min grid; a "now" line on
  today. Gaps inside working hours show "Free · 12:00 – 1:30"; tapping a gap
  opens quick booking prefilled with that employee, date and time.
- Card (names from the agenda response, also for EMPLOYEE): customer name (or
  "Walk-in client"), services, resource name, time range, status badge (Booked / Checked in / Done / No-show / Cancelled),
  source "Online" when `ONLINE`, "Confirmed" when the customer confirmed via the
  manage link, and a "No messages" badge when the customer has no consented
  channel (needs the API field in api-additions.md). Multi-segment appointments
  show a card per segment, each saying "part 1 of 2".
- No-show cards are dimmed. A "Show cancelled" toggle (off by default)
  refetches with `includeCancelled=true` and shows cancelled cards dimmed.
- Tap a card → action sheet: details (phone tap-to-call, notes),
  then actions allowed by status and role:
  - Check in (`BOOKED`), Complete (`BOOKED`, `CHECKED_IN`): only from the
    appointment's local day; on a future day they are hidden.
  - No-show (`BOOKED`), disabled before the start time with "Available from
    10:00".
  - Move (`BOOKED`, `CHECKED_IN` as the API allows; for `CHECKED_IN` the
    start stays the same or moves later, never earlier, plan 04 R9): sheet with
    date + time picker for the same services and employees (employees
    changeable), STAFF availability with `excludeAppointmentId`; save →
    `PATCH /staff/appointments/:id`.
  - Cancel (`BOOKED`, `CHECKED_IN`): optional reason (≤ 200 chars), confirm.
  - EMPLOYEE sees only Check in / Complete on their own segments. Status is
    per appointment: when the appointment has segments of other employees,
    the confirm says "This marks the whole appointment".
- Refresh: polling every 30 s while the tab is visible, refetch on focus and
  after every action. A 409 `CONFLICT` from an action (the UI already hides
  actions the status, day or role forbid, so a 409 means someone else changed
  it) shows "This appointment changed, refreshed" and refetches.

## Quick booking (mockup 6)

Target: ≤ 6 taps for a returning client.

1. **Client:** search field (phone or name). Results show name, phone and the
   last visit's services ("last: pedicure"). "New client" expands name, phone
   (US), language (default = panel locale), email optional, and an
   "Agrees to email messages" tick that is off by default and must be asked
   aloud (sent as consent with source `RECEPTION`). With a `customerId` query
   the client is preselected.
2. **Services:** chips of the most booked services first, then a full list by
   category (STAFF mode includes non-online services). "Same as last time"
   button when the client has a last visit.
3. **Time:** next slots for "any professional" (or a chosen one), 3 shown, then
   "More times" (the day's full list) and a date switch. Prefill from an agenda
   gap selects that slot when it is valid.
4. **Out-of-hours:** "Other time…" reloads the times with
   `GET /availability?override=true` (staff only), which ignores working hours
   and closures but still forbids overlaps, and marks times outside normal
   availability. Picking one of those shows "Outside normal availability" and
   a "Book anyway" confirm; the server-built plan is sent with
   `override: true` (the API audits it). The client never builds a plan.
5. Footer: "Save · 12:00" and a line saying whether the client gets a message,
   from the API's `reachable` ("The client gets a confirmation" / "No messages:
   no consented channel").
   Save → back to the agenda on that date with the new card highlighted.

Errors as plan 06 (`SLOT_TAKEN` → refetch times, `VALIDATION_FAILED` → field).

## Walk-in

Client optional (same search/new as quick booking, plus "Skip"), services,
then "Start now" → `POST /staff/walk-in`; result shows the professional and
time picked by the API; no slot → "No one is free right now" with the next
times link to quick booking.

## Calls (decided by Claude)

- Staff pages are client components under one session provider; no server data
  fetching with tokens.
- Polling rather than websockets: simple, fine for one salon; revisit if load
  matters.
- Move via sheet, no drag-and-drop (drag is error-prone on phones).
- The "last visit" hint, "No messages" badge and card names come from API
  additions (api-additions.md) instead of extra client calls per row.
- No "override" flag on cards: it is not stored on the appointment, only in
  the audit log.
- Professional filter in `localStorage`, per device.
- Agenda on phones renders only the active column (chips are tabs; a horizontal touch swipe of 60 px or more switches
  to the next or previous professional). Wide screens render every selected column; the chip filter is kept in
  `localStorage["bs-staff-agenda-employees"]`.
- Move sheet reads the professionals able to do each service from `GET /staff/booking-catalog`; a checked-in
  appointment hides times earlier than its current start (a hint; the API enforces it).
