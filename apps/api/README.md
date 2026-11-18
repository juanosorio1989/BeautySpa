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
| `TRUST_PROXY` | `true`/`false`, default `false` |

`NODE_ENV=production` requires `OTP_PROVIDER=twilio` and `EMAIL_PROVIDER=resend`.

Global providers: `REDIS` (`ioredis` client from `REDIS_URL`, `src/redis/`), `RateLimitService` (`src/rate-limit/`,
Redis fixed window `rl:<key>`: `consume`, `enforce` → 429 `RATE_LIMITED`, `peek`, `reset`, `hashKeyPart` for putting
phone/email/IP into keys), `TenancyService` (`src/tenancy/`).

Tests build config with `testEnv(overrides)` (`test/support/test-env.ts`: throwaway keys, fake OTP, org `test-salon`).
Integration tests use `createIntegrationApp({ env, imports, override })` and `resetState(prisma, redis)` from
`test/integration/app.ts`.

## Auth

`AuthModule` (`src/auth/`) registers `AccessGuard` as the global `APP_GUARD`. The guard **fails closed**: a route
without an auth decorator answers 403 `FORBIDDEN` to everyone, so every new controller must declare a policy.

| Decorator | Allows |
|---|---|
| `@Public()` | anyone, no token (`/health`, `/auth/refresh`, `/auth/logout`, `/auth/otp/*`, login routes) |
| `@CustomerAuth()` | a customer access token |
| `@StaffAuth()` / `@StaffAuth("OWNER", ...)` | any staff token / only the listed roles |
| `@Principal()` | param decorator: the verified `AccessClaims` |

Policies sit on the handler or the controller (handler wins), metadata key `auth:policy`. Tokens come only from
`Authorization: Bearer <jwt>`. Missing, invalid or expired token, or `org` other than `TenancyService.getOrgId()`:
401 `UNAUTHORIZED`. Valid token of the wrong kind or role: 403 `FORBIDDEN`.

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

- US only: a phone not starting with `+1` is 400 `VALIDATION_FAILED` with `errors: [{ path: "phone" }]`.
- `start` tries WhatsApp, logs a warning and falls back to SMS if it throws; both throw → 503.
- `verify`: a wrong code is 400 `OTP_INVALID`. A correct code upserts the customer on `(organization_id,
  phone_e164)`: new rows get `locale` = request `locale` or the organization's `default_locale`, `created_via =
  ONLINE`; every login sets `phone_verified_at`. A soft-deleted customer is 401 `UNAUTHORIZED`. Writes audit
  `auth.customer.login` (`after: { isNew }`), then `SessionService.start`. `isNew` = the customer has no name yet.
  Verifying a phone is not consent to messages: no `notification_consent` rows are written.
- Rate limits (429 `RATE_LIMITED`; keys use `hashKeyPart`, never the raw phone or IP): start 3 / 10 min per phone
  (`otp:start:phone:*`) and 10 / hour per client IP (`otp:start:ip:*`, `req.ip`, so set `TRUST_PROXY` behind a
  proxy); verify 5 / 10 min per phone (`otp:verify:phone:*`).
- `ProblemFilter` passes through a well-formed `errors` array (`{ path, message }[]`) from an `HttpException` body.

Providers (`OTP_PROVIDER` token, picked in `AuthModule` by `env.OTP_PROVIDER`):

| `OTP_PROVIDER` | Behavior | Allowed in |
|---|---|---|
| `twilio` | Twilio Verify REST API (no SDK, form bodies, Basic auth). Needs `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`. Errors carry only the HTTP status. | all |
| `console` (default) | Logs `OTP for <phone>: <code>` to the API log; stores only `sha256` of the code in Redis (`otp:console:<hashKeyPart(phone)>`, 10 min, deleted on success). | development, test |
| `fake` | Sends nothing; accepts only `000000`. | `NODE_ENV=test` only |

Dev usage: with the default `console` provider, call `start`, read the 6-digit code from the API log line
`OTP for +1...: 123456`, and send it to `verify`.

Tests: `src/auth/token.service.test.ts`, `src/auth/otp/*.test.ts` (unit), `test/integration/auth/{session,guard,otp,staff-login,mfa}.int.test.ts` (test-only
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
  the password check so parallel bursts get no extra guesses, reset on success), 30 attempts / 15 min per IP,
  5 enroll/confirm/verify/recover attempts / 5 min per staff id.
- Confirm and recover lock the `staff_user` row (`FOR UPDATE`); confirm enrolls only the exact pending secret the
  code was checked against (else 409), so concurrent confirms or recoveries succeed once.
- TOTP: secret AES-256-GCM encrypted (`Encryptor`, provided and exported by `AuthModule`); a wrong or replayed code
  is 400 `MFA_INVALID`; each matched step is spent once (`totp:used:<staffId>:<step>`, 120 s; cleared when a new
  secret is issued). Audit: `auth.staff.mfa_enrolled`, `auth.staff.login`, `auth.staff.recovery_used`.

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
