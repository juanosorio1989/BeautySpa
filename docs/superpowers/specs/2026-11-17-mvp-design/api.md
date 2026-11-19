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
| GET | `/availability` | `locationId?`, `services[]=id:employeeId|ANY&date=YYYY-MM-DD` (or `from`/`to`), `excludeAppointmentId?` (authenticated owner of it, or staff) → `Slot[]` |
| POST | `/holds` | `{ segments }` from a slot → `{ holdId, expiresAt }`. Rate-limited per IP. |

## Client (customer token)

| Method | Path | Notes |
|---|---|---|
| GET/PATCH | `/me` | name, email, locale, consents per channel |
| POST | `/appointments` | `{ holdId, notes? }` → `BOOKED`; schedules notifications |
| GET | `/me/appointments` | upcoming + past |
| POST | `/me/appointments/:id/cancel` | within cancel window |
| POST | `/me/appointments/:id/reschedule` | `{ segments }` — atomic swap, no hold (see flows.md) |
| POST | `/me/appointments/:id/repeat` | returns services/employees to prefill booking |
| GET | `/me/export` | JSON export of the customer's data |
| DELETE | `/me` | anonymizes the customer, revokes tokens |

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
| GET | `/staff/agenda?date=&locationId=` | all (EMPLOYEE: own only) |
| GET | `/staff/customers?q=` | OWNER, RECEPTION; EMPLOYEE: only customers with an appointment with them |
| POST | `/staff/customers` | OWNER, RECEPTION — `{ name, phone, locale, consents }` |
| POST | `/staff/appointments` | OWNER, RECEPTION — `{ customerId, segments, override? }`; skips hold; STAFF mode |
| POST | `/staff/walk-in` | OWNER, RECEPTION — `{ customerId?, services }` → first slot from now, booked |
| PATCH | `/staff/appointments/:id` | OWNER, RECEPTION — move / change segments |
| POST | `/staff/appointments/:id/status` | check-in, complete, no-show, cancel (EMPLOYEE: own, check-in/complete only) |
| CRUD | `/staff/services`, `/staff/categories`, `/staff/levels`, `/staff/resources`, `/staff/resource-types` | OWNER |
| GET | `/staff/employees?active=&locationId=`, `/staff/employees/:id` | OWNER, RECEPTION |
| POST, PATCH | `/staff/employees`, `/staff/employees/:id` (no DELETE: `PATCH { active: false }`) | OWNER |
| CRUD | `/staff/employees/:id/working-hours`; POST `/staff/employees/:id/invite`, `/staff/employees/:id/reset-2fa` | OWNER |
| CRUD | `/staff/time-off` | OWNER, RECEPTION; EMPLOYEE: read own |
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
