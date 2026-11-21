# @beautyspa/api

NestJS 11 REST API (CommonJS), served under `/v1`.

- `pnpm --filter @beautyspa/api dev` watch mode on `PORT` (default 3001); see "Config" below.
- Docs: `/v1/docs` (Swagger UI), `/v1/openapi.json`. Generated from shared Zod contracts via `nestjs-zod`.
- Errors are RFC 7807 `application/problem+json` matching `ProblemSchema` (`src/common/problem.filter.ts`).
- Helmet security headers, `cookie-parser`, `trust proxy` from `TRUST_PROXY`, and CORS restricted to `WEB_ORIGIN`; all wiring lives in `src/bootstrap.ts` (`configureApp`).
- Tests: `pnpm --filter @beautyspa/api test` (Vitest + SWC for decorator metadata, config in `vitest.config.mts`; no database needed).

## Config

`src/config/env.ts` validates the environment with Zod (`loadEnv`); the global `ConfigModule` provides it under the
`ENV` token and `main.ts` reads it with `app.get(ENV)`. Empty values (`KEY=`) count as unset. A failure lists only the
invalid key names, never values.

| Key | Rule |
|---|---|
| `DATABASE_URL`, `REDIS_URL`, `WEB_ORIGIN` | required URLs |
| `DEFAULT_ORG_SLUG` | required; the single tenant (`TenancyService.getOrgId()`, cached; 500 if the org is missing) |
| `JWT_PRIVATE_KEY_B64` | required; base64 PKCS#8 DER Ed25519 private key (`secrets:gen`) |
| `DATA_ENCRYPTION_KEY` | required; base64 of exactly 32 bytes (`secrets:gen`) |
| `JWT_KEY_ID`, `DATA_ENCRYPTION_KEY_ID` | default `k1` |
| `OTP_PROVIDER` | `console` (default) / `twilio` / `fake`; `fake` only when `NODE_ENV=test`; `twilio` needs `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID` |
| `EMAIL_PROVIDER` | `console` (default) / `resend`; `resend` needs `RESEND_API_KEY`, `EMAIL_FROM` |
| `COOKIE_SECURE` | `true`/`false`; default `true` only in production |
| `COOKIE_DOMAIN` | optional |
| `TRUST_PROXY` | `false` (default) / a positive hop count / comma-separated proxy IPs or CIDRs (e.g. `10.0.0.0/8,127.0.0.1`); use `1` on Railway/Fly. `true` is rejected: it trusts the client-forged left-most `X-Forwarded-For` and bypasses every per-IP limit |

`NODE_ENV=production` requires `OTP_PROVIDER=twilio` and `EMAIL_PROVIDER=resend`.

Global providers: `REDIS` (`ioredis` client from `REDIS_URL`, `src/redis/`), `RateLimitService` (`src/rate-limit/`,
Redis fixed window `rl:<key>`: `consume`, `enforce` → 429 `RATE_LIMITED`, `peek`, `reset`, `hashKeyPart` for putting
phone/email/IP into keys), `TenancyService` (`src/tenancy/`), `CLOCK` (`src/common/clock.ts`, global `CommonModule`:
`Clock { now(): number }` in epoch ms, default `systemClock` = `Date.now`; booking code reads time only through it).

Error helpers (`src/common/http-errors.ts`): `invalidRef`, `notFound`, `inUse`, `conflict(message)` (409 `CONFLICT`),
`slotTaken(message?)` (409 `SLOT_TAKEN`), `holdExpired()` (409 `HOLD_EXPIRED`), `outsideCancelWindow()` (409
`OUTSIDE_CANCEL_WINDOW`). `src/common/db-errors.ts`: `pgCode`, `isUniqueViolation`, `isForeignKeyViolation`,
`isExclusionViolation` (SQLSTATE `23P01`, an overlapping booking).

Tests build config with `testEnv(overrides)` (`test/support/test-env.ts`: throwaway keys, fake OTP, org `test-salon`).
Integration tests use `createIntegrationApp({ env, imports, override })` and `resetState(prisma, redis)` from
`test/integration/app.ts`. Booking tests use `test/integration/helpers.ts`: `seedBookingFixture` (location open
Mon-Sat 09:00-19:00, staff "Alex"/"Blair" working Tue-Sat 09:00-19:00 doing Pedicure `pediId` and Manicure `maniId`),
`customerSession(app, f)`, `fixedClock(ms)` (pass `override: (b) => b.overrideProvider(CLOCK).useValue(clock)`),
`BOOKING_NOW` (Mon 2026-11-30 07:00 New York) and `BOOKING_DATE` (`2026-12-01`, a Tuesday).

## Auth

`AuthModule` (`src/auth/`) registers `AccessGuard` as the global `APP_GUARD`. The guard **fails closed**: a route
without an auth decorator answers 403 `FORBIDDEN` to everyone, so every new controller must declare a policy.

| Decorator | Allows |
|---|---|
| `@Public()` | anyone, no token (`/health`, `/auth/refresh`, `/auth/logout`, `/auth/otp/*`, login routes) |
| `@OptionalAuth()` | no `Authorization` header (principal undefined) or any valid access token, customer or staff (principal set) |
| `@CustomerAuth()` | a customer access token |
| `@StaffAuth()` / `@StaffAuth("OWNER", ...)` | any staff token / only the listed roles |
| `@Principal()` | param decorator: the verified `AccessClaims` |

Policies sit on the handler or the controller (handler wins), metadata key `auth:policy`. Tokens come only from
`Authorization: Bearer <jwt>`. Missing, invalid or expired token, or `org` other than `TenancyService.getOrgId()`:
401 `UNAUTHORIZED`. Valid token of the wrong kind or role: 403 `FORBIDDEN`. `@OptionalAuth()` skips verification only
when the header is absent: a header that is present (empty, non-Bearer, invalid, expired, MFA or other-org token) is
still 401, never treated as anonymous.

- `TokenService`: EdDSA JWTs with `jose`, key from `JWT_PRIVATE_KEY_B64`, `kid` = `JWT_KEY_ID`. Access tokens
  (`aud: beautyspa`, 15 min; `typ`/`role` must agree) and MFA step tokens (`aud: beautyspa-mfa`, `typ: mfa`,
  `purpose` `verify`/`enroll`, 5 min) never verify as each other.
- `RefreshTokenService`: opaque tokens stored as SHA-256 in `refresh_token`; `create` starts a family, `rotate`
  rotates inside one transaction (successor keeps the family and `expires_at`). Presenting a rotated token, or losing a
  concurrent rotation, revokes the family (committed first), then writes audit `auth.refresh_reuse` after commit
  (an audit failure is logged as a warning; the answer stays 401). A token revoked by logout/`revokeAllFor` is a
  plain 401 with no audit. Also `revokeFamilyOf`, `revokeAllFor`.
- `SessionService.start(subject, req, res)` is what login flows call; `refresh` and `logout` back
  `POST /v1/auth/refresh` (200 `TokenResponse`) and `POST /v1/auth/logout` (204, also for unknown tokens).
  A session only starts or refreshes for a customer without `deleted_at` or a staff user with `active` and
  `can_login`.
- Transport: header `x-token-transport: body` → refresh token in the JSON body, no cookie. Otherwise cookie
  `bs_refresh` (`HttpOnly`, `SameSite=Lax`, `Path=/v1/auth`, `Secure` = `COOKIE_SECURE`, `Domain` = `COOKIE_DOMAIN`)
  and no `refreshToken` in the body. A cookie is accepted on refresh/logout only with `x-beautyspa-csrf: 1`
  (else 403); a body `refreshToken` takes precedence over the cookie. A refresh whose token came from the cookie
  always answers with a cookie, ignoring `x-token-transport`, and a 401 on that path clears the cookie.
  CORS (`src/bootstrap.ts`) allows only the request headers `authorization`, `content-type`, `x-beautyspa-csrf`:
  browsers cannot send `x-token-transport` cross-origin (native clients do not use CORS).
- `AuditService.record(entry, tx?)` (`src/audit/`) appends to `audit_log`, optionally inside a transaction. Never
  put tokens, hashes, passwords or TOTP secrets in `before`/`after`.

### Customer phone OTP

`src/auth/otp/`. `POST /v1/auth/otp/start` `{ phone, locale }` → 200 `{ channel }`; `POST /v1/auth/otp/verify`
`{ phone, code, locale? }` → 200 `TokenResponse` + `isNew` (same token transports as refresh). Both `@Public()`.

- US only: a phone not starting with `+1`, or not NANP-shaped (`/^\+1[2-9]\d{2}[2-9]\d{6}$/`), is 400
  `VALIDATION_FAILED` with `errors: [{ path: "phone" }]`. Non-US NANP ranges are left to Twilio Geo Permissions
  and Fraud Guard.
- `start` tries WhatsApp and falls back to SMS when WhatsApp is unavailable (`OtpProviderUnavailableError` or
  any untyped error) or answers `OtpInvalidRecipientError` (a WhatsApp 400 can be a channel-config error such as
  Twilio 60223); both failing → 503. `OtpInvalidRecipientError` from SMS → 400 `VALIDATION_FAILED` on `phone`.
  `OtpProviderRateLimitedError` → 429 `RATE_LIMITED` on either channel, no fallback. On `verify`, a provider rate limit is 429
  and any other provider failure 503.
- `verify`: a wrong code is 400 `OTP_INVALID`. A correct code upserts the customer on `(organization_id,
  phone_e164)`: new rows get `locale` = request `locale` or the organization's `default_locale`, `created_via =
  ONLINE`; every login sets `phone_verified_at`. A soft-deleted customer is 401 `UNAUTHORIZED`. Writes audit
  `auth.customer.login` (`after: { isNew }`), then `SessionService.start`. `isNew` = the customer has no name yet.
  Verifying a phone is not consent to messages: no `notification_consent` rows are written.
- Rate limits (429 `RATE_LIMITED`; keys use `hashKeyPart`, never the raw phone or IP): start 3 / 10 min per phone
  (`otp:start:phone:*`) and 10 / hour per client IP (`otp:start:ip:*`, `req.ip`, so set `TRUST_PROXY` (`1` on Railway/Fly) behind a
  proxy); verify 5 / 10 min per phone (`otp:verify:phone:*`).
- `ProblemFilter` passes through a well-formed `errors` array (`{ path, message }[]`) from an `HttpException` body.

Providers (`OTP_PROVIDER` token, picked in `AuthModule` by `env.OTP_PROVIDER`):

| `OTP_PROVIDER` | Behavior | Allowed in |
|---|---|---|
| `twilio` | Twilio Verify REST API (no SDK, form bodies, Basic auth). Needs `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`. Each request is aborted after 10 s. start: 400 → `OtpInvalidRecipientError`, 429 → `OtpProviderRateLimitedError`, other non-2xx / network / timeout → `OtpProviderUnavailableError`; check: 404 → `false`, 429 → rate limited, other non-2xx / network / timeout → unavailable (errors in `otp-provider.ts`). Errors carry only the HTTP status (or `network` / `timeout`). | all |
| `console` (default) | Logs `OTP for <phone>: <code>` to the API log; stores only `sha256` of the code in Redis (`otp:console:<hashKeyPart(phone)>`, 10 min, deleted on success). | development, test |
| `fake` | Sends nothing; accepts only `000000`. | `NODE_ENV=test` only |

Dev usage: with the default `console` provider, call `start`, read the 6-digit code from the API log line
`OTP for +1...: 123456`, and send it to `verify`.

Tests: `src/auth/token.service.test.ts`, `src/auth/otp/*.test.ts` (unit), `test/integration/auth/{session,guard,optional-auth,otp,staff-login,mfa}.int.test.ts` (test-only
controllers passed through `createIntegrationApp({ imports })`). `TenancyService` caches the org id per app, so an
integration test that re-seeds the org per case needs a fresh app per case.

### Staff login (password + mandatory TOTP)

`src/auth/staff/`, all `@Public()`, all 200. Sequence: `POST /v1/auth/staff/login` `{ email, password }` →
`MFA_REQUIRED` + verify `mfaToken` (enrolled) or `ENROLL_REQUIRED` + enroll `mfaToken`; then either
`mfa/verify` `{ mfaToken, code }` → tokens, or `mfa/enroll` (secret + otpauth URL) → `mfa/enroll/confirm` → tokens
+ 10 recovery codes (shown once). `mfa/recover` `{ mfaToken, recoveryCode }` clears TOTP, revokes all sessions and
returns `ENROLL_REQUIRED` (no session).

- Unknown email, inactive, `can_login=false`, no password or wrong password: the same 401 `Invalid email or password`
  (a dummy argon2 verify equalizes timing). Wrong password on a real account writes `auth.staff.login_failed`.
- Limits (429 `RATE_LIMITED`): 5 attempts / 15 min per email (`login:fail:<hashKeyPart(email)>`, consumed before
  the password check so parallel bursts get no extra guesses, reset on success and after a password is set by
  invite accept or a reset link; key built by `loginFailureKey`), 30 attempts / 15 min per IP,
  5 enroll/confirm/verify/recover attempts / 5 min per staff id.
- Confirm and recover lock the `staff_user` row (`FOR UPDATE`); confirm enrolls only the exact pending secret the
  code was checked against (else 409), so concurrent confirms or recoveries succeed once.
- TOTP: secret AES-256-GCM encrypted (`Encryptor`, provided and exported by `AuthModule`); a wrong or replayed code
  is 400 `MFA_INVALID`; each matched step is spent once (`totp:used:<staffId>:<step>`, 120 s; cleared when a new
  secret is issued). Audit: `auth.staff.mfa_enrolled`, `auth.staff.login`, `auth.staff.recovery_used`.

### Staff links (invite, password reset) and OWNER actions

`StaffLinksService` (`src/auth/staff/staff-links.service.ts`). Links are `${WEB_ORIGIN}/<locale>/staff/invite?token=`
(72 h) or `/staff/reset?token=` (1 h), locale from `staff_user.locale`; 32 random bytes base64url, only the sha256
hex is stored in `staff_auth_token`; a new link marks older unused ones of the same purpose used.

- `POST /v1/auth/staff/invite/accept` `{ token, password }` → 200 `ENROLL_REQUIRED` (or `MFA_REQUIRED` if enrolled);
  sets the password and `can_login`. `password/forgot` `{ email }` → always 204; only an active, `can_login`,
  password-holding member gets a reset email; over 3 per email per hour nothing is sent. `password/reset`
  `{ token, password }` → 204, revokes every session. All `@Public()`, 10 requests / 15 min per IP each (429).
- Unknown, used, expired, wrong-purpose or inactive-staff links: 400 `LINK_INVALID`. The link is spent by a
  conditional update inside the transaction, so concurrent uses succeed once.
- `POST /v1/staff/employees/:id/invite` and `/:id/reset-2fa`: `@StaffAuth("OWNER")`, 204, `:id` a UUID (400).
  Invite: 404 outside the org, 409 without email, inactive or with a password. Reset-2FA: 403 on yourself, clears
  TOTP and recovery codes and revokes sessions.
- Audit: `auth.staff.invite_accepted`, `auth.staff.password_reset`, `staff.invite`, `staff.reset_2fa`
  (`before: { totpEnrolled }`), `staff.owner_cli` (SYSTEM). Never tokens or passwords.
- Mail (`src/mail/`, global `MAILER`): `ConsoleMailer` (dev/test; logs the text, keeps the last 50 in `sent`) or
  `ResendMailer` (`EMAIL_PROVIDER=resend`; aborted after 10 s → `Resend send failed: timeout`). Copy in `src/auth/staff/emails.ts` (EN/ES).
- CLI `src/cli/create-owner.ts` (`pnpm --filter @beautyspa/api create-owner --email <e> [--locale en|es]`): see
  [docs/development](../../docs/development/README.md#first-owner).

Tests: `src/mail/resend.mailer.test.ts`, `src/cli/create-owner.test.ts`,
`test/integration/auth/{staff-links,owner-cli}.int.test.ts`.

## Auth crypto

Plain functions in `src/auth/crypto/` (`node:crypto`, plus `@node-rs/argon2`):

- `Encryptor` (`encryption.ts`): AES-256-GCM, 32-byte key (`DATA_ENCRYPTION_KEY`), random 12-byte IV, 16-byte tag;
  payload `<keyId>.<b64url iv>.<b64url ciphertext||tag>`. Errors: `Unknown encryption key id`, `Decryption failed`.
- TOTP (`totp.ts`): RFC 6238, HMAC-SHA1, 30 s, 6 digits, 20-byte base32 secret; `verifyTotp` accepts +-1 step
  (constant-time) and returns the matched step for replay checks. Issuer `BeautySpa` in `otpauthUrl`.
- Base32 (`base32.ts`): RFC 4648, uppercase, no padding; decode is case-insensitive and ignores spaces/`=`.
- Passwords (`password.ts`): argon2id, m=19456 KiB, t=2, p=1; `verifyPassword` returns false on a malformed hash.
  Hash `DUMMY_PASSWORD_HASH_INPUT` once at startup to equalize timing for unknown users.
- Tokens (`tokens.ts`): `randomToken` = 32 random bytes base64url; store only `sha256Hex` of it.
- Recovery codes (`recovery-codes.ts`): 10 codes of 80 bits, `xxxx-xxxx-xxxx-xxxx` lowercase base32; stored as
  SHA-256 hex of the normalized code (lowercase, no spaces or dashes).

## Database (Prisma 6, PostgreSQL 16)

Schema: `prisma/schema.prisma` (spec: `docs/superpowers/specs/2026-11-17-mvp-design/data-model.md`).
`PrismaService` (global `PrismaModule`, `src/prisma/`) connects lazily on the first query.
The booking exclusion constraints are raw SQL in `prisma/migrations/*_booking_constraints`.

| Script | What it does |
|---|---|
| `db:migrate` | `prisma migrate dev` against `DATABASE_URL` (create/apply migrations) |
| `db:deploy` | `prisma migrate deploy` (apply pending migrations, never drops data) |
| `db:seed` | idempotent seed: org `demo-salon`, location `Main` with hours |
| `db:drift` | fails if `schema.prisma` and `prisma/migrations` differ (shadow DB: `DATABASE_URL_TEST` + `_shadow`, or `SHADOW_DATABASE_URL`) |
| `db:generate` | regenerate the Prisma client (also runs on `postinstall`) |
| `test:int` | integration tests (`vitest.int.config.mts`, `test/integration/**/*.int.test.ts`) against `DATABASE_URL_TEST` and `REDIS_URL_TEST` |
| `secrets:gen` | add missing `JWT_PRIVATE_KEY_B64` / `DATA_ENCRYPTION_KEY` to the repo-root `.env` (prints key names only) |

`dev`, `start`, `db:*` and `test:int` are wrapped in `dotenv -e ../../.env --`: they read the repo-root `.env`, shell/CI variables win, and a missing file is ignored.

`test:int` applies pending migrations to `DATABASE_URL_TEST` (database name must contain `test` as a `_`-separated word, e.g. `beautyspa_test`, and differ from `DATABASE_URL`) and truncates all tables before each test. `REDIS_URL_TEST` must not be DB 0 or the `REDIS_URL` database: tests `FLUSHDB` it. The drift check refuses a shadow database whose name lacks `shadow`/`test` or that equals `DATABASE_URL`.
If you edit an already-applied migration locally, reset the test database by hand:
`DATABASE_URL=$DATABASE_URL_TEST pnpm exec prisma migrate reset`.

## Catalog (`src/catalog/`)

`CatalogModule` holds the OWNER-only catalog CRUD (`@StaffAuth("OWNER")`, every query filtered by `principal.org`, every write audited in the same transaction):
`/v1/staff/categories`, `/v1/staff/levels`, `/v1/staff/resource-types` (`GET`, `POST`, `GET|PATCH|DELETE /:id`) and `/v1/staff/resources` (`GET ?locationId`, `POST`, `GET|PATCH /:id`; no DELETE, deactivate with `active: false`) and `/v1/staff/services` (`GET ?active=true|false&categoryId`, `POST`, `GET|PATCH /:id`; no DELETE, deactivate with `active: false`; a PATCH with `levelPrices` replaces all rows).
Lists sort by `sort, name.en` (categories), `rank` (levels), `name.en` (resource types), `name` (resources). Deleting a resource type still used by a service or resource answers 409 `CONFLICT`; a resource with an unknown `resourceTypeId` answers 400 on that path. A missing or other-org `:id` is 404, a non-UUID 400.
Tests: `test/integration/catalog/simple-crud.int.test.ts`, `test/integration/catalog/services.int.test.ts`.

## Staff (`src/staff/`)

`StaffModule` holds `/v1/staff/employees` (every staff member, OWNER, RECEPTION and EMPLOYEE, is an employee row): `GET ?active=true|false&locationId` and `GET /:id` for OWNER and RECEPTION; `POST` and `PATCH /:id` for OWNER. No DELETE: deactivate with `active: false`. `POST /:id/invite` and `/:id/reset-2fa` stay in `StaffAdminController` (`src/auth/staff/`).
Writes run in one transaction with their `staff_user.*` audit row (`after` is the API shape, never secrets). Create assigns the only location when `locationIds` is omitted and, with `sendInvite`, emails the invite after commit (if the email fails the member exists and the answer is 5xx: recover with `POST /:id/invite`, since retrying `POST` gives 409); a duplicate email is 409. Without `locationIds` in an org with several locations it answers 400 on `locationIds`. Update locks the row (`FOR UPDATE`), keeps `canLogin ⇒ email` and `serviceIds ⇒ profile` (400 on `email` / `serviceIds`), replaces `locationIds` (dropping working hours and location-bound time off at removed locations) and `serviceIds`; `profile: null` removes the services; `profile` in a PATCH replaces the profile as a whole, omitted fields take their defaults (send the full profile to change one field). An OWNER changing their own `role`, `active` or `canLogin` gets 403. Changing any member's `role` or `email` (your own email included), or turning `active` / `canLogin` off, revokes their refresh tokens and spends their unused invite/reset links (`StaffLinksService.endPendingLinks`) in the same transaction. Accepted limitation: access tokens stay valid up to 15 minutes after revocation, so two OWNERs acting concurrently could leave no active owner.
Working hours (`/v1/staff/employees/:id/working-hours?locationId=`): `GET` for OWNER, RECEPTION and EMPLOYEE (own id only, else 403), `PUT` for OWNER with `{ days: [{ weekday, start, end }] }` (wall times "HH:MM", an end may be "24:00", stored as 00:00). `PUT` replaces all rows of the employee at that location in one transaction (row `FOR UPDATE` on the staff row); the member must be assigned to the location (400 on `locationId`); overlapping shifts are 400 on `days.<i>`. `locationId` may be omitted only with a single location. `GET` for a location the member is not assigned to returns `days: []` (not an error). Audit `working_hours.update`, `entityId "<staffId>:<locationId>"`, `before`/`after` = `{ days }`.
Time off (`/v1/staff/time-off`): `GET ?from&to&employeeId&locationId` lists rows overlapping `[from, to)` by `startsAt` (with `locationId`, rows at that location plus rows with no location, which apply to all) (OWNER, RECEPTION all; EMPLOYEE only their own, 403 for another `employeeId`); `POST` (201), `PATCH /:id` and `DELETE /:id` (204) for OWNER and RECEPTION. `employeeId` must be an org member and a non-null `locationId` one of their locations (400); `PATCH` re-checks `startsAt < endsAt` on the merged row (400 on `endsAt`). Overlapping rows are allowed. Audit `time_off.create|update|delete`.
Tests: `test/integration/staff/{employees,working-hours,time-off}.int.test.ts`.

## Locations (`src/locations/`)

`LocationsModule` holds `/v1/staff/settings?locationId=` and `/v1/staff/closures`. `locationId` may be omitted only in an organization with a single location (else 400 on `locationId`); another org's location is 404.
Settings: `GET` and `PATCH` for OWNER (RECEPTION and EMPLOYEE get 403) answer `StaffSettings` (`location`, `settings`, `hours`). `PATCH` merges `settings` into the stored JSON (only given keys change), replaces all `location_hours` rows when `hours` is given (wall times "HH:MM", an end may be "24:00", stored as 00:00) and updates `name`, `address`, `phone`, `timezone`; an empty body is 400. One transaction (row `FOR UPDATE` on the location) with one `location.update` audit row whose `before`/`after` are the full `StaffSettings`. `readLocationSettings(json)` (exported from `settings.service.ts`) returns the defaults overlaid with the stored keys, any invalid key falling back to its default; plan 04 uses it to build the engine's location input.
Closures: `GET ?from&to&locationId` (all staff) lists rows overlapping `[from, to)` by `startsAt`; `POST` (201), `PATCH /:id` and `DELETE /:id` (204) for OWNER. `PATCH` re-checks `startsAt < endsAt` on the merged row (400 on `endsAt`). Rows have no organization column: the org is checked through the location. Audit `location_closure.create|update|delete`.
Tests: `test/integration/locations/{settings,closures}.int.test.ts`.

## Public reads and audit (`src/public/`, `src/audit/`)

`PublicModule`: `@Public()` `GET /v1/public/locations`, `/public/services?locationId=` and `/public/employees?locationId=` (org from `TenancyService.getOrgId()`; `locationId` may be omitted only with one location). A listed employee is active, `bookableOnline` and assigned to the location; a listed service is `active && onlineBookable`, done by a listed employee, and, when it has a `resourceTypeId` (any type: chair, cabin), the location has an active resource of that type. `fromPriceCents` is the cheapest listed qualified employee's level price (else base price); categories are those with a listed service. `PublicCatalogService` is exported for plan 04: `bookableEmployees(orgId, locationId)` returns each employee's qualified service ids unfiltered (inactive or non-listed services included), so callers must filter by listed services; `listedServices(orgId, locationId, employees)` applies the rules above and gives that filtered view.
`AuditModule` also serves `GET /v1/staff/audit?entity=&id=&cursor=&limit=` (OWNER only), newest first by `id` (UUIDv7); `nextCursor` is the last id when the page is full (`limit` items), else null.
Tests: `test/integration/public/public.int.test.ts`, `test/integration/audit-read.int.test.ts`, `test/integration/rbac-matrix.int.test.ts` (see Booking and customers below).

## Booking and customers (`src/booking/`, `src/customers/`)

`BookingModule`: `GET /v1/availability` (`@OptionalAuth()`), `POST /v1/holds` (`@Public()`), `POST /v1/appointments` and `/v1/me/appointments*` (`@CustomerAuth()`: list, cancel, reschedule, repeat), `GET /v1/staff/agenda`, `POST /v1/staff/appointments`, `PATCH /v1/staff/appointments/:id`, `POST /v1/staff/appointments/:id/status` and `POST /v1/staff/walk-in` (`@StaffAuth()`), plus the hold sweeper. `CustomersModule`: `/v1/me` (GET, PATCH, DELETE), `GET /v1/me/export` (`@CustomerAuth()`) and `/v1/staff/customers` (search for all staff, create for OWNER and RECEPTION). Route contracts, rate limits and error codes: `docs/superpowers/specs/2026-11-17-mvp-design/api.md`.

Tests: `test/integration/rbac-matrix.int.test.ts` covers every plan 03 and 04 route: 401 without a token, 403 for each disallowed caller (a CUSTOMER token on a staff route and a staff token on a customer route included); `@Public()` routes answer 200 or at least pass the guard; `GET /availability` needs no token but answers 401 to an invalid one.
