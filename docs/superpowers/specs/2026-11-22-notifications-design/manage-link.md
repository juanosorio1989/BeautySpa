# Manage link

## Token

Stateless, as the parent spec decided: `base64url(payload) "." base64url(HMAC-SHA256(MANAGE_LINK_SECRET, payload))`
with payload JSON `{ "a": appointmentId, "v": manageVersion, "e": exp }`, `exp`
= appointment start in epoch seconds. Compared in constant time. Minted fresh
for every message (each `deliver` render). URL:
`${WEB_ORIGIN}/${locale}/manage/${token}`.

Valid only when: signature matches, `now < exp`, the appointment exists in the
org, `manage_version = v`, and its customer is not deleted. **(call)** Every
failure answers the same 404 `NOT_FOUND` (no oracle). Rate limit **(call)**: 30
requests per minute per IP across `/manage/*`.

## API

| Method | Path | Result |
|---|---|---|
| GET | `/manage/:token` | `ManageView`: the customer-shaped `Appointment`, `location` (name, address, phone, timezone), `canCancel` (status `BOOKED` and inside `cancelWindowHours`), `canConfirm` (status `BOOKED`, `confirmedByCustomerAt` null) |
| POST | `/manage/:token/confirm` | sets `confirmed_by_customer_at` once (idempotent: already confirmed → same 200); not `BOOKED` → 409 `CONFLICT`. Audit `appointment.confirm` (actor CUSTOMER). No message sent. |
| POST | `/manage/:token/cancel` | `{ reason? }` → same rules and code path as `POST /me/appointments/:id/cancel` (window → 409 `OUTSIDE_CANCEL_WINDOW`, not `BOOKED` → 409 `CONFLICT`), actor CUSTOMER, `manage_version + 1`, `cancelled` event. |
| GET | `/manage/:token/calendar.ics` | the `.ics` for the appointment (`text/calendar`), `METHOD:PUBLISH` **(call)**: a download is not an invitation |

Customer cancel logic is extracted from `MyAppointmentsService.cancel` into one
shared function so both paths stay identical.

Responses carry `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.

## Web page `/[locale]/manage/[token]`

Client component (token stays out of server logs as far as Next allows; page
is `noindex`). Shows the appointment (date/time in the location timezone,
services, professional, address), then:

- `canConfirm` → "Confirm I'll be there"; after → "Confirmed".
- `canCancel` → "Cancel appointment" with an optional reason (same dialog as
  the client area).
- not `canCancel` and `BOOKED` → "To change or cancel, call {phone}".
- "Add to calendar" → the `.ics` URL.
- "Reschedule" → `/[locale]/login?next=/me` (reschedule needs OTP, parent
  spec).
- Invalid/expired → "This link is no longer valid" + link to `/me` (a 404
  carries no location data, so no salon phone here).

**(call)** The page's language comes from the URL locale (the link is built
with the customer's locale).
