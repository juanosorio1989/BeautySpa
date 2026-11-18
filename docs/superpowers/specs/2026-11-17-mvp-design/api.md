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
| POST | `/auth/staff/invite/accept`, `/auth/staff/password/forgot`, `/auth/staff/password/reset` | single-use emailed tokens; `invite/accept` `{ token, password }` returns `ENROLL_REQUIRED` + enroll `mfaToken` |
| POST | `/auth/staff/mfa/recover` | `{ mfaToken, recoveryCode }` → clears old TOTP, returns `ENROLL_REQUIRED` + enroll `mfaToken` (no session) |
| POST | `/auth/refresh` | refresh from cookie or body → new pair (rotation). Cookie use requires header `x-beautyspa-csrf: 1`. |
| POST | `/auth/logout` | revokes the family. Cookie use requires header `x-beautyspa-csrf: 1`. |

Web receives the refresh token only as cookie `bs_refresh` (HttpOnly; SameSite=Lax; Path=/v1/auth). A client sending header `x-token-transport: body` (native) gets it in the JSON body instead and no cookie.

## Public (no auth)

| Method | Path | Notes |
|---|---|---|
| GET | `/public/locations` | name, address, hours, phone (one in the MVP) |
| GET | `/public/services` | active, online-bookable, by category, both languages |
| GET | `/public/employees` | bookable profiles + services they do |
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
| CRUD | `/staff/employees`, `/staff/employees/:id/working-hours`; POST `/staff/employees/:id/invite`, `/staff/employees/:id/reset-2fa` | OWNER |
| CRUD | `/staff/time-off` | OWNER, RECEPTION; EMPLOYEE: read own |
| GET/PATCH | `/staff/settings` | OWNER |
| GET | `/staff/audit?entity=&id=` | OWNER |

## Webhooks

`POST /webhooks/twilio/status` (delivery status, signature-verified),
`POST /webhooks/twilio/inbound` (STOP/BAJA → consent revoked; START → restored).

## RBAC summary

| Capability | OWNER | RECEPTION | EMPLOYEE | CUSTOMER |
|---|---|---|---|---|
| Catalog, employees, settings | ✓ | – | – | – |
| All appointments, customers | ✓ | ✓ | own | own |
| Customer private notes | ✓ | ✓ | own appointments | – |
| Audit log | ✓ | – | – | – |

Enforced by NestJS guards from the token's `role`; ownership checks in the
service layer; every query also filters by `orgId`.
