# API `/v1`

REST, JSON, versioned by path. OpenAPI generated from `packages/contracts`,
served at `/v1/docs` (and `/v1/openapi.json`). Errors are
`application/problem+json` with a stable `code` (e.g. `SLOT_TAKEN`,
`HOLD_EXPIRED`, `OTP_INVALID`, `MFA_INVALID` (wrong TOTP/recovery code), `LINK_INVALID` (expired/used/unknown invite or reset token), `OUTSIDE_CANCEL_WINDOW`, `FORBIDDEN`, `CONFLICT`, `BAD_REQUEST`, `VALIDATION_FAILED`, `NOT_FOUND`, `UNAUTHORIZED`, `RATE_LIMITED`, `INTERNAL`).

## Auth

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/otp/start` | `{ phone, locale }` → sends code (WhatsApp, fallback SMS). Rate-limited. |
| POST | `/auth/otp/verify` | `{ phone, code, locale? }` → tokens + `{ isNew }` (`isNew` = customer has no name yet). Creates customer if new; `locale` is used only then. |
| POST | `/auth/staff/login` | `{ email, password }` → `{ status: "MFA_REQUIRED" \| "ENROLL_REQUIRED", mfaToken, mfaTokenExpiresAt }` |
| POST | `/auth/staff/mfa/enroll` | `{ mfaToken }` → TOTP secret + otpauth URL |
| POST | `/auth/staff/mfa/enroll/confirm` | `{ mfaToken, code }` → tokens + 10 recovery codes (shown once) |
| POST | `/auth/staff/mfa/verify` | `{ mfaToken, code }` → tokens |
| POST | `/auth/staff/invite/accept`, `/auth/staff/password/forgot`, `/auth/staff/password/reset` | single-use emailed tokens; `invite/accept` `{ token, password }` returns `ENROLL_REQUIRED` + enroll `mfaToken` (or `MFA_REQUIRED` if already enrolled) |
| POST | `/auth/staff/mfa/recover` | `{ mfaToken, recoveryCode }` → clears old TOTP, returns `ENROLL_REQUIRED` + enroll `mfaToken` (no session) |
| POST | `/auth/refresh` | refresh from cookie or body → new pair (rotation). Cookie use requires header `x-beautyspa-csrf: 1`. |
| POST | `/auth/logout` | revokes the family. Cookie use requires header `x-beautyspa-csrf: 1`. |

Web receives the refresh token only as cookie `bs_refresh` (HttpOnly; SameSite=Lax; Path=/v1/auth). A client sending header `x-token-transport: body` (native) gets it in the JSON body instead and no cookie.

## Public (no auth)

`locationId` may be omitted only in an organization with a single location (else 400 on `locationId`).

| Method | Path | Notes |
|---|---|---|
| GET | `/public/locations` | all org locations sorted by name: name, address, phone, timezone, hours (an end at midnight is `"24:00"`) |
| GET | `/public/services?locationId=` | `{ categories, services }`, both languages. Listed: `active && onlineBookable`, done by ≥ 1 listed employee, and (with a `resourceTypeId`) the location has ≥ 1 active resource of that type. `fromPriceCents` = cheapest listed qualified employee's price (level override, else `priceCents`). Categories: only those with a listed service |
| GET | `/public/employees?locationId=` | sorted by `displayName`. Listed: active, profile `bookableOnline`, assigned to the location; `serviceIds` only listed services |
| GET | `/availability` | `locationId?`, repeated `services=<serviceId>:<employeeId\|ANY>` (1-4), one `date=YYYY-MM-DD` per call (the date strip calls per day), `excludeAppointmentId?` → `Slot[]`. Optional auth: the mode comes from the token (none or customer: online rules; staff: no lead time, no horizon, non-online employees and services included). `excludeAppointmentId` needs a token: a customer must own the appointment, staff any in the organization, else 404; no token is 401. Segments of `HELD` appointments whose hold has expired are ignored. Rate-limited per IP (120 per minute). |
| POST | `/holds` | `{ locationId?, segments }` copied from a slot → 201 `{ holdId, expiresAt }` (`expiresAt` = now + `holdMinutes`). The plan is re-validated in the write transaction: 409 `SLOT_TAKEN` when the time is taken, 400 `VALIDATION_FAILED` (path `segments`) when the plan was altered. 30 per IP per 10 min. |

## Client (customer token)

| Method | Path | Notes |
|---|---|---|
| GET/PATCH | `/me` | name, email, locale, consents per channel; PATCH writes only changed values (consent rows source `PROFILE`) and audits only changed keys |
| POST | `/appointments` | `{ holdId, notes? }` → 201 `Appointment` (`BOOKED`, the caller attached, `notes` saved). Unknown hold (or another organization's) 404; expired hold (still held past `expiresAt`, or already released) 409 `HOLD_EXPIRED`; a hold already booked or otherwise used 409 `CONFLICT`; a customer without a name 400 `VALIDATION_FAILED` path `name` (the hold stays). The segments are not re-validated: the hold already occupies them. Notifications are triggered after commit and never fail the request. 10 per customer per hour. |
| GET | `/me/appointments` | `{ upcoming, past }` of the caller's appointments, holds excluded. `upcoming`: `BOOKED` or `CHECKED_IN` ending after now, soonest first. `past`: everything else (including future cancelled ones), latest start first, at most 50. |
| POST | `/me/appointments/:id/cancel` | `{ reason? }` → `Appointment` (200). Own `BOOKED` appointment within the cancel window: `CANCELLED`, segments stop occupying, `manage_version` + 1. Not the caller's → 404; not `BOOKED` → 409 `CONFLICT`; too late → 409 `OUTSIDE_CANCEL_WINDOW` (see flows.md). |
| POST | `/me/appointments/:id/reschedule` | `{ segments }` (a slot from `/availability?excludeAppointmentId=`) → `Appointment` (200). Atomic swap, no hold; same ownership, status and window rules as cancel; must keep the same services (employees and times may change), else 400 `VALIDATION_FAILED` on `segments`; taken time → 409 `SLOT_TAKEN` with the old time kept (see flows.md). |
| POST | `/me/appointments/:id/repeat` | → `{ locationId, services: [{ serviceId, employeeId \| "ANY" }] }` (200) to prefill a booking; any status; inactive services dropped, employees no longer bookable become `"ANY"`. |
| GET | `/me/export` | `{ customer, consentHistory, appointments }` (holds excluded) |
| DELETE | `/me` | 204; anonymizes the customer, cancels future bookings, clears notes and customer cancel reasons (also in audit rows), revokes tokens (see security-quality.md). Every `/me` and `/me/appointments` route answers 401 for a deleted customer. |

## Manage link (from WhatsApp/email, no login)

`GET /manage/:token`, `POST /manage/:token/confirm`, `POST /manage/:token/cancel`.
Token **(call)**: stateless, HMAC-SHA256 signed (`MANAGE_LINK_SECRET`) over
`{appointmentId, manageVersion, exp}`; `exp` = appointment start. Any message
(including 24 h / 2 h reminders) can mint a fresh link. Revocation: increment
`appointment.manage_version` (done on cancel and reschedule). Cancel via link
obeys the same `cancelWindowHours` as the app; inside the window the page shows
"confirm" plus the salon phone. Reschedule from the link goes through OTP.

## Staff (staff token, RBAC)

| Method | Path | Roles |
|---|---|---|
| GET | `/staff/agenda?date=&locationId=&employeeId=` | all (EMPLOYEE: own only; another `employeeId` is 403) |
| GET | `/staff/customers?q=` | all; EMPLOYEE: only customers with a non-held appointment with them. `q` 2-80 chars; name match, plus phone match with 4+ digits; 20 max |
| POST | `/staff/customers` | OWNER, RECEPTION — `{ name, phone, locale, email?, consents }`; 201; duplicate phone 409 `CONFLICT`; audit `customer.create` lists keys only |
| POST | `/staff/appointments` | OWNER, RECEPTION — `{ customerId, locationId?, segments, notes?, override? }` → 201 `StaffAppointment` (`BOOKED`, source `RECEPTION`, `createdByStaffId` = caller). Skips the hold; validated in STAFF mode (no lead time or horizon); `override: true` also ignores working hours, time off, location hours and closures, never overlaps (409 `SLOT_TAKEN`). `customerId` not an active customer of the org → 400 `VALIDATION_FAILED` path `customerId`. |
| POST | `/staff/walk-in` | OWNER, RECEPTION — `{ customerId?, locationId?, services, notes? }` → 201 `StaffAppointment` (`CHECKED_IN`, source `WALK_IN`; `customerId` may be null). Takes the first STAFF-mode slot of today (location timezone) starting no later than now rounded down to the slot grid + `slotIntervalMin`; none → 409 `SLOT_TAKEN` (design call 9). |
| PATCH | `/staff/appointments/:id` | OWNER, RECEPTION — `{ segments, override? }` → `StaffAppointment`. `BOOKED` or `CHECKED_IN` only (else 409 `CONFLICT`); services may change; same validation as staff create with its own segments excluded; no cancel window; old segments replaced, `manage_version` + 1; taken time → 409 `SLOT_TAKEN` with the old time kept. |
| POST | `/staff/appointments/:id/status` | all staff — `{ status, reason? }` → `StaffAppointment`. Transitions (design call 7): `BOOKED → CHECKED_IN \| COMPLETED \| NO_SHOW \| CANCELLED`, `CHECKED_IN → COMPLETED \| CANCELLED`, anything else 409 `CONFLICT`; `NO_SHOW` only once now ≥ start (else 409). `CANCELLED` (no cancel window for staff) records `cancelledBy STAFF` and the reason and increments `manage_version`; `CANCELLED` and `NO_SHOW` free the time. EMPLOYEE: only appointments with a segment of theirs and only `CHECKED_IN`/`COMPLETED`, else 403. |
| CRUD | `/staff/services`, `/staff/categories`, `/staff/levels`, `/staff/resources`, `/staff/resource-types` | OWNER |
| GET | `/staff/employees?active=&locationId=`, `/staff/employees/:id` | OWNER, RECEPTION |
| POST, PATCH | `/staff/employees`, `/staff/employees/:id` (no DELETE: `PATCH { active: false }`) | OWNER |
| GET | `/staff/employees/:id/working-hours?locationId=` | OWNER, RECEPTION; EMPLOYEE: own |
| PUT | same path, body `{ days: [{ weekday, start, end }] }` replaces the set | OWNER |
| POST | `/staff/employees/:id/invite`, `/staff/employees/:id/reset-2fa` | OWNER |
| CRUD | `/staff/time-off` (`?locationId` also returns rows with no location, i.e. all locations) | OWNER, RECEPTION; EMPLOYEE: read own |
| GET/PATCH | `/staff/settings?locationId=` — location profile, `settings` (merged by key), `hours` (replaced as a set) | OWNER |
| GET | `/staff/closures?from=&to=&locationId=` | all staff |
| POST, PATCH, DELETE | `/staff/closures`, `/staff/closures/:id` | OWNER |
| GET | `/staff/audit?entity=&id=&cursor=&limit=` | OWNER — `{ items, nextCursor }`, newest first (`id desc`); `nextCursor` is the last item id when a page is full (`limit`, default 50, max 100), else null |

### Settings

- `GET|PATCH /staff/settings?locationId=` (OWNER) answer `StaffSettings`:
  `location { id, name, address, phone, timezone }`, `settings` and
  `hours [{ weekday, start, end }]`.
- `settings` keys (defaults): `slotIntervalMin` 5, 10, 15, 20, 30 or 60 (15);
  `holdMinutes` 1-30 (5); `cancelWindowHours` 0-168 (24); `bookingHorizonDays`
  1-365 (60); `minLeadMinutes` 0-1440 (60). A stored key that is missing or
  invalid reads as its default.
- `PATCH` merges `settings` by key (only given keys change), replaces `hours`
  as a set (overlapping shifts on a weekday are 400 on `hours.<i>`) and
  updates `name`, `address`, `phone`, `timezone`. An empty body is 400.
- Wall times are "HH:MM"; an end may be "24:00" (stored as 00:00). `weekday`
  is 0 (Sunday) to 6.
- `locationId` may be omitted only in an organization with a single location
  (else 400 on `locationId`); another org's location is 404. Closures follow
  the same rule.

### Employees

- **Every staff member is an "employee"**: `/staff/employees` lists OWNER,
  RECEPTION and EMPLOYEE rows (active first, then display name or email).
  `profile` (display name, bio, photo, level, bookable online) exists only for
  people who perform services; `serviceIds` require a profile, and
  `PATCH { profile: null }` also removes all services. `canLogin` requires an
  email. A duplicate email answers 409 `CONFLICT`.
- `profile` in a PATCH replaces the profile as a whole; omitted fields take
  their defaults (send the full profile to change one field).
- **No hard delete** for services, resources and staff (they have history):
  `PATCH { active: false }`. Categories, levels, resource types, time off and
  closures can be deleted; a delete blocked by a foreign key answers 409.
- **Locations**: `POST` without `locationIds` assigns the only location (400 on
  `locationIds` when there are several). `PATCH locationIds` replaces them and
  deletes the member's working hours and location-bound time off at removed
  locations.
- **Reads** are OWNER and RECEPTION (reception books for a professional);
  writes are OWNER. `POST { sendInvite: true }` emails the invite after commit.
  If that email fails, the member exists and the response is 5xx; recover with
  `POST /staff/employees/:id/invite` (retrying the `POST` gives 409).
- **Self-protection**: an OWNER cannot change their own `role`, `active` or
  `canLogin` (403 `FORBIDDEN`), so the salon never loses its last owner by
  accident.
- **Revocation**: changing any member's `role` or `email` (your own email
  included: you sign in again with the new address), or setting `active` or
  `canLogin` to false, in the same transaction revokes all their refresh
  tokens and spends their unused invite and password-reset links (a link sent
  to an old address, or one that would turn login back on, stops working).
- **Accepted limitation**: access tokens stay valid for up to 15 minutes after
  revocation (`role`/`active` are not re-checked per request), so two OWNERs
  acting concurrently could leave no active owner; self-protection only
  prevents doing it to yourself.

## Webhooks

`POST /webhooks/twilio/status` (delivery status, signature-verified),
`POST /webhooks/twilio/inbound` (STOP/BAJA → consent revoked; START → restored).

## RBAC summary

| Capability | OWNER | RECEPTION | EMPLOYEE | CUSTOMER |
|---|---|---|---|---|
| Catalog, employees, settings | ✓ | read employees | – | – |
| All appointments, customers | ✓ | ✓ | own | own |
| Customer private notes | ✓ | ✓ | own appointments | – |
| Audit log | ✓ | – | – | – |

Enforced by NestJS guards from the token's `role`; ownership checks in the
service layer; every query also filters by `orgId`.
