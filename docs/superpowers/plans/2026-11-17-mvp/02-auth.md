# Plan 02 — Auth

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clients sign in with phone + OTP, staff with email + password + mandatory TOTP; both get a 15-minute access JWT and a rotating refresh token; every route is guarded by role; staff are onboarded by invite links and the first OWNER by a CLI; `@beautyspa/api-client` wraps it all with a pluggable `TokenStore`.

**Architecture:** A NestJS `auth` module on top of small, unit-tested primitives (AES-256-GCM, TOTP, argon2id, opaque tokens). Access tokens are EdDSA JWTs (`jose`); refresh tokens are opaque, stored as SHA-256 hashes in `refresh_token`, rotated on every use with family-wide revocation on reuse. A global fail-closed guard reads route decorators. Rate limits are an in-house Redis fixed-window limiter. External services (Twilio Verify, Resend) sit behind interfaces with console/fake implementations for dev and test. No schema migration: plan 01 already created every auth table.

**Tech Stack:** NestJS 11 (CommonJS), Prisma 6, `jose@^5` (has a CJS build), `@node-rs/argon2@^2`, `ioredis@^5`, `cookie-parser@^1`, Zod, Vitest + supertest, real Postgres/Redis for integration tests.

**Spec:** `docs/superpowers/specs/2026-11-17-mvp-design/` — `architecture.md` (Authentication), `api.md` (Auth, RBAC), `security-quality.md` (rate limits, audit), `data-model.md` (Staff and auth, Encryption).

**Branch:** `feat/mvp-02-auth`

## Routing

Main session: Opus 5.5 (orchestrates, does not implement normal tasks).

| Task | What | Implementer | Reviewer | Why |
|---|---|---|---|---|
| 1 | Auth contracts and error codes | implementer-sonnet | reviewer-opus | schemas fully specified |
| 2 | Config, secrets script, Redis, rate limiter, tenancy, test harness | **implementer-opus** | reviewer-opus | secrets handling (Opus rule) |
| 3 | Crypto primitives: AES-GCM, TOTP, argon2id, tokens, recovery codes | **implementer-opus** | reviewer-opus | auth/secrets |
| 4 | Access/refresh tokens, sessions, guard, `/auth/refresh`, `/auth/logout`, audit writer | **implementer-opus** | reviewer-opus | auth |
| 5 | Customer phone OTP | **implementer-opus** | reviewer-opus | auth |
| 6 | Staff login, lockout, TOTP enroll/verify/recover | **implementer-opus** | reviewer-opus | auth |
| 7 | Mailer, invite/reset links, owner invite + reset-2FA, `create-owner` CLI | **implementer-opus** | reviewer-opus | auth |
| 8 | `@beautyspa/api-client` with `TokenStore` | implementer-sonnet | reviewer-opus | pure TS, contract and tests given |

One final branch review (`reviewer-opus`). Not a money/production-data branch.

## Design calls (made in this plan; the spec is updated in the task that implements each)

1. **Refresh lifetime is absolute per login**: a rotated token inherits `expires_at` from the token it replaces (customers re-verify by OTP after 30 days; staff log in again after 12 h, one shift). (Task 4, `architecture.md`)
2. **Transport**: web gets the refresh token only as cookie `bs_refresh` (`HttpOnly; SameSite=Lax; Path=/v1/auth`, `Secure` per `COOKIE_SECURE`); a client sending header `x-token-transport: body` gets it in the JSON body instead (native) and no cookie. Cookie-based `/auth/refresh` and `/auth/logout` require header `x-beautyspa-csrf: 1` (forces a CORS preflight). (Task 4, `architecture.md`, `api.md`)
3. **TOTP enrollment is two calls**: `POST /auth/staff/mfa/enroll` `{ mfaToken }` → secret + otpauth URL; `POST /auth/staff/mfa/enroll/confirm` `{ mfaToken, code }` → tokens + 10 recovery codes (shown once). (Task 6, `api.md`)
4. **Recovery code does not grant a session**: `/auth/staff/mfa/recover` clears the old TOTP and returns `ENROLL_REQUIRED` + an enroll `mfaToken`; the session comes from the confirm step. Invite accept also returns `ENROLL_REQUIRED`. (Task 6/7, `api.md`)
5. **Rate limiting** is an in-house Redis fixed-window limiter instead of `@nestjs/throttler`: the limits are per phone/email as well as per IP, which the throttler's single tracker does not model. (Task 2, `security-quality.md`)
6. **Route guard fails closed**: a route with no auth decorator answers 403 to everyone. (Task 4)
7. **New error codes** `MFA_INVALID` (wrong TOTP/recovery code) and `LINK_INVALID` (expired/used/unknown invite or reset token). (Task 1, `api.md`)
8. **`isNew`** on OTP verify means "customer has no name yet" (needs the name step). `/auth/otp/verify` takes an optional `locale` used only when the customer row is created. (Task 5, `api.md`)
9. **OTP countries**: only `+1` numbers are accepted (400 `VALIDATION_FAILED`, path `phone`); Twilio fraud guard covers the rest. (Task 5)
10. **`create-owner`** creates the OWNER, or for an existing OWNER with that email clears password, TOTP, recovery codes and sessions; either way it prints a fresh 72 h invite link. (Task 7, `architecture.md`)

## Global Constraints

- Everything from plan 01's Global Constraints still holds (Node 22, strict TS, English only, no secrets committed, platform packages have no DOM/Node imports).
- Access token: EdDSA (Ed25519) JWT, 15 min, `iss: "beautyspa-api"`, `aud: "beautyspa"`, claims `sub`, `typ` (`customer` | `staff`), `org`, `role` (`OWNER` | `RECEPTION` | `EMPLOYEE` | `CUSTOMER`), header `kid` = `JWT_KEY_ID`.
- MFA token: same key, `aud: "beautyspa-mfa"`, `typ: "mfa"`, claim `purpose` (`verify` | `enroll`), 5 min. Never accepted as an access token.
- Refresh token: 32 random bytes, base64url; DB stores `sha256` hex only. TTL 30 days (`CUSTOMER`), 12 h (`STAFF`).
- Invite link 72 h, reset link 1 h; 32 random bytes base64url, stored as sha256 hex; issuing a new one of the same purpose marks older unused ones `used_at = now()`.
- Passwords: argon2id, `memoryCost 19456`, `timeCost 2`, `parallelism 1`; new passwords 12–128 chars.
- TOTP: RFC 6238, SHA-1, 6 digits, 30 s step, ±1 step accepted, each step usable once per user.
- Emails are trimmed and lowercased before storage and lookup (`staff_user.email` is stored lowercased).
- Secrets never appear in logs, audit `before`/`after`, problem `detail`, or test snapshots. The console OTP/mail providers are refused when `NODE_ENV=production`.
- Every auth error is `application/problem+json` via the existing `ProblemFilter`; services throw Nest `HttpException`s with `{ code }` in the body.
- Each task ends with green `pnpm turbo run lint typecheck test` and, for API tasks, `pnpm --filter @beautyspa/api test:int`; docs change in the same commit.

## Rate limits (Task 2 builds the limiter; tasks 5–7 apply these exact values)

| Key | Limit | Window | On exceed |
|---|---|---|---|
| OTP start per phone | 3 | 600 s | 429 `RATE_LIMITED` |
| OTP start per IP | 10 | 3600 s | 429 |
| OTP verify per phone | 5 | 600 s | 429 |
| Staff login attempts per email | 5 | 900 s | 429 until the window ends (lockout); counted before the password check (race-safe), success resets |
| Staff login per IP | 30 | 900 s | 429 |
| MFA verify/confirm/recover per staff id | 5 | 300 s | 429 |
| Password forgot per email | 3 | 3600 s | still 204, no email sent |
| Password forgot / invite accept / reset per IP | 10 | 900 s | 429 |

Phone and email in Redis keys are replaced by the first 16 hex chars of their sha256.

## Review Focus

1. **Two tabs refresh with the same token at once** → exactly one gets a new pair; the other is treated as reuse and the family is revoked (both then re-login). The client must not race itself: `api-client` single-flights refresh (tests in Task 4 and Task 8).
2. **Phone typed with spaces, dashes or no `+1`** → the API accepts only E.164 and answers 400 `VALIDATION_FAILED` on `phone`, never 500; non-`+1` numbers → 400 (test in Task 5). Formatting belongs to the web form (plan 06).
3. **Staff email typed as `" Ana@Salon.COM "`** → logs in as `ana@salon.com`; forgot-password finds it too (tests in Task 1 and Task 6).
4. **An old, used, or superseded invite/reset link is opened** → 400 `LINK_INVALID`, never 500, and a re-sent link kills the earlier one (test in Task 7).
5. **Staff deactivated (or customer deleted) while holding a valid refresh token** → next refresh is 401 and the family is revoked (test in Task 4).

---

### Task 1: Auth contracts and error codes

**Files:**
- Create: `packages/contracts/src/auth.ts`, `packages/contracts/src/auth.test.ts`
- Modify: `packages/contracts/src/errors.ts` (add `MFA_INVALID`, `LINK_INVALID`), `packages/contracts/src/index.ts`
- Modify (docs): `docs/superpowers/specs/2026-11-17-mvp-design/api.md` (error codes; enroll/confirm; recover and invite accept return `ENROLL_REQUIRED`; optional `locale` on verify; headers `x-token-transport`, `x-beautyspa-csrf`)

**Interfaces — Produces** (all exported from `@beautyspa/contracts`, each with `type X = z.infer<typeof XSchema>`):
- `EmailSchema = z.string().trim().toLowerCase().email().max(254)`
- `NewPasswordSchema = z.string().min(12).max(128)`; `StaffRoleSchema = z.enum(["OWNER","RECEPTION","EMPLOYEE"])`
- `OtpCodeSchema = z.string().regex(/^\d{6}$/)`
- `OtpStartRequestSchema { phone: PhoneE164Schema, locale: LocaleSchema }`, `OtpStartResponseSchema { channel: z.enum(["whatsapp","sms"]) }`
- `OtpVerifyRequestSchema { phone, code: OtpCodeSchema, locale: LocaleSchema.optional() }`
- `TokenResponseSchema { accessToken: z.string(), accessTokenExpiresAt: IsoInstantSchema, refreshToken: z.string().optional() }`
- `OtpVerifyResponseSchema = TokenResponseSchema.extend({ isNew: z.boolean() })`
- `StaffLoginRequestSchema { email: EmailSchema, password: z.string().min(1).max(128) }`
- `MfaStepResponseSchema { status: z.enum(["MFA_REQUIRED","ENROLL_REQUIRED"]), mfaToken: z.string(), mfaTokenExpiresAt: IsoInstantSchema }`
- `MfaTokenRequestSchema { mfaToken: z.string().min(1).max(2048) }`
- `MfaEnrollStartResponseSchema { secret: z.string(), otpauthUrl: z.string() }`
- `MfaCodeRequestSchema = MfaTokenRequestSchema.extend({ code: OtpCodeSchema })` (used by enroll/confirm and mfa/verify)
- `MfaEnrollConfirmResponseSchema = TokenResponseSchema.extend({ recoveryCodes: z.array(z.string()).length(10) })`
- `MfaRecoverRequestSchema = MfaTokenRequestSchema.extend({ recoveryCode: z.string().trim().min(1).max(64) })`
- `LinkTokenSchema = z.string().min(20).max(200)`; `InviteAcceptRequestSchema { token: LinkTokenSchema, password: NewPasswordSchema }`; `PasswordResetRequestSchema` same shape; `PasswordForgotRequestSchema { email: EmailSchema }`
- `RefreshRequestSchema { refreshToken: z.string().min(1).max(512).optional() }`; `LogoutRequestSchema` same shape
- `AccessClaimsSchema { sub: IdSchema, typ: z.enum(["customer","staff"]), org: IdSchema, role: z.union([StaffRoleSchema, z.literal("CUSTOMER")]) }`
- `AUTH_HEADERS = { tokenTransport: "x-token-transport", csrf: "x-beautyspa-csrf" } as const`

- [ ] **Step 1: Write failing tests** in `auth.test.ts`:
  - `EmailSchema.parse(" Ana@Salon.COM ")` → `"ana@salon.com"`; `"not-an-email"` fails.
  - `NewPasswordSchema`: 11 chars fails, 12 passes, 129 fails.
  - `OtpCodeSchema`: `"123456"` passes; `"12345"`, `"1234567"`, `"12a456"` fail.
  - `OtpStartRequestSchema` rejects `{ phone: "305 555 0100", locale: "en" }` and `locale: "fr"`.
  - `MfaEnrollConfirmResponseSchema` rejects 9 recovery codes.
  - `AccessClaimsSchema` accepts `role: "CUSTOMER"` with `typ: "customer"`, rejects `role: "ADMIN"`.
  - `ErrorCode.options` contains `MFA_INVALID` and `LINK_INVALID`.
- [ ] **Step 2: Run** `pnpm --filter @beautyspa/contracts test` · Expected: FAIL (module `./auth` not found).
- [ ] **Step 3: Implement** the schemas above and the two error codes; export from `index.ts`.
- [ ] **Step 4: Run** `pnpm turbo run lint typecheck test build --filter=@beautyspa/contracts` · Expected: PASS.
- [ ] **Step 5: Update `api.md`** per the Files list (design calls 2, 3, 4, 7, 8).
- [ ] **Step 6: Commit** — `feat(contracts): auth request/response schemas and error codes`

---

### Task 2: Config, secrets script, Redis, rate limiter, tenancy, test harness

**Files:**
- Modify: `apps/api/src/config/env.ts`, `apps/api/src/main.ts`, `apps/api/src/bootstrap.ts`, `apps/api/src/app.module.ts`, `apps/api/src/prisma/prisma.service.ts`, `apps/api/package.json`, `.env.example`, `.github/workflows/ci.yml`, `apps/api/test/app.e2e.test.ts`, `apps/api/test/integration/setup.ts`
- Create: `apps/api/src/config/config.module.ts`, `apps/api/src/redis/redis.module.ts`, `apps/api/src/rate-limit/rate-limit.service.ts`, `apps/api/src/rate-limit/rate-limit.module.ts`, `apps/api/src/tenancy/tenancy.service.ts`, `apps/api/src/tenancy/tenancy.module.ts`, `apps/api/scripts/gen-secrets.ts`, `apps/api/scripts/secrets.ts`, `apps/api/test/support/test-env.ts`, `apps/api/test/integration/app.ts`
- Test: `apps/api/test/env.test.ts`, `apps/api/test/secrets.test.ts`, `apps/api/test/integration/rate-limit.int.test.ts`, `apps/api/test/integration/tenancy.int.test.ts`
- Docs: `docs/development/README.md` (`secrets:gen`, `REDIS_URL_TEST`), `apps/api/README.md` (config section), `docs/superpowers/specs/2026-11-17-mvp-design/security-quality.md` (design call 5)

**Interfaces — Produces:**
- `Env` gains: `DEFAULT_ORG_SLUG` (string, required), `JWT_PRIVATE_KEY_B64` (base64 PKCS#8 DER Ed25519, required), `JWT_KEY_ID` (default `"k1"`), `DATA_ENCRYPTION_KEY` (base64 of exactly 32 bytes, required), `DATA_ENCRYPTION_KEY_ID` (default `"k1"`), `OTP_PROVIDER` (`twilio` | `console` | `fake`, default `console`), `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID` (required when `OTP_PROVIDER=twilio`), `EMAIL_PROVIDER` (`console` | `resend`, default `console`), `RESEND_API_KEY`, `EMAIL_FROM` (required when `resend`), `COOKIE_SECURE` (`"true"`/`"false"` → boolean; default `true` when `NODE_ENV=production`, else `false`), `COOKIE_DOMAIN` (optional), `TRUST_PROXY` (boolean, default `false` — superseded in the final review: `false` | hop count | IP/CIDR list, `true` and `/0` rejected, use `1` on Railway/Fly). Cross-field rules via `superRefine`: `fake` OTP only when `NODE_ENV=test`; production requires `OTP_PROVIDER=twilio` and `EMAIL_PROVIDER=resend`. The error message still lists only key names, never values.
- `ENV` injection token (`export const ENV = Symbol("ENV")`) from a `@Global()` `ConfigModule` whose provider calls `loadEnv()`; tests use `.overrideProvider(ENV).useValue(testEnv())`. `main.ts` builds the app, then `configureApp(app, app.get(ENV))`. `PrismaService` takes `datasourceUrl` from `ENV.DATABASE_URL`.
- `configureApp` additionally: `app.use(cookieParser())`; `(app as NestExpressApplication).set("trust proxy", env.TRUST_PROXY)`.
- `REDIS` injection token: an `ioredis` client from `ENV.REDIS_URL` (`lazyConnect: false`, `maxRetriesPerRequest: 2`), quit on module destroy; `@Global() RedisModule`.
- `RateLimitService` (`@Global() RateLimitModule`):
  - `consume(key: string, limit: number, windowSec: number): Promise<{ allowed: boolean; remaining: number; retryAfterSec: number }>` — `MULTI INCR rl:<key>; EXPIRE rl:<key> <windowSec> NX; TTL rl:<key>`.
  - `enforce(key, limit, windowSec): Promise<void>` — throws `HttpException({ code: "RATE_LIMITED", message: "Too many attempts, try again later" }, 429)` when not allowed.
  - `peek(key, limit): Promise<boolean>` (true = currently blocked, does not increment); `reset(key): Promise<void>`.
  - `hashKeyPart(value: string): string` — first 16 hex chars of sha256.
- `TenancyService.getOrgId(): Promise<string>` — looks up `organization.slug = DEFAULT_ORG_SLUG` once and caches; throws `Error("Organization <slug> not found")` (→ 500) if missing. `@Global() TenancyModule`.
- `apps/api/scripts/secrets.ts`: `addMissingSecrets(envText: string, gen: Record<string, () => string>): { text: string; added: string[] }` — appends `KEY=value` lines only for keys absent from `envText`; never changes existing lines. `defaultGenerators()` returns generators for `JWT_PRIVATE_KEY_B64` (`generateKeyPairSync("ed25519")`, PKCS#8 DER, base64) and `DATA_ENCRYPTION_KEY` (32 random bytes, base64).
- `gen-secrets.ts` (script `"secrets:gen": "tsx scripts/gen-secrets.ts"`): reads repo-root `.env` (copies `.env.example` first if missing), writes the result, prints only `Added: KEY1, KEY2` or `Nothing to add`. Never prints values.
- `.env.example`: placeholders `JWT_PRIVATE_KEY_B64=` and `DATA_ENCRYPTION_KEY=` (empty, with a comment "run pnpm --filter @beautyspa/api secrets:gen"), `DEFAULT_ORG_SLUG=demo-salon`, `REDIS_URL_TEST=redis://localhost:6379/1`, `OTP_PROVIDER=console`, `EMAIL_PROVIDER=console`, commented Twilio/Resend keys. `addMissingSecrets` treats `KEY=` with an empty value as missing and replaces that line.
- `test/support/test-env.ts`: `testEnv(overrides?: Record<string, string>): Env` — `NODE_ENV=test`, generated Ed25519 key and encryption key (generated once per process), `DATABASE_URL = DATABASE_URL_TEST ?? "postgresql://u:p@localhost:5432/db_test"`, `REDIS_URL = REDIS_URL_TEST ?? "redis://localhost:6379/1"`, `DEFAULT_ORG_SLUG=test-salon` (matches `seedFixture`), `OTP_PROVIDER=fake`, `EMAIL_PROVIDER=console`, `WEB_ORIGIN=http://localhost:3000`.
- `setup.ts` adds `testRedisUrl()`: requires `REDIS_URL_TEST`, refuses DB index `0` (path `/0` or none) and a URL equal to `REDIS_URL`.
- `test/integration/app.ts`: `createIntegrationApp(opts?: { env?: Record<string, string>; imports?: Type[]; override?: (b: TestingModuleBuilder) => TestingModuleBuilder }): Promise<{ app: INestApplication; prisma: PrismaService; redis: Redis; close(): Promise<void> }>` — testing module importing `AppModule` plus `opts.imports` (test-only modules/controllers), `ENV` overridden by `testEnv({ DATABASE_URL: testDatabaseUrl(), REDIS_URL: testRedisUrl(), ...opts.env })`, then `opts.override` (e.g. stub providers), `configureApp`, `init`. `resetState(prisma, redis)`: `truncateAll` + `redis.flushdb()`.
- CI `integration` job env adds `REDIS_URL_TEST: redis://localhost:6379/1`.

- [ ] **Step 1: Check branch** — `git branch --show-current` → `feat/mvp-02-auth` (created with this plan).
- [ ] **Step 2: Write failing tests**
  - `env.test.ts`: `loadEnv(base)` with all required keys passes and `COOKIE_SECURE` is `false`; with `NODE_ENV: "production"` and default providers it throws naming `OTP_PROVIDER` and `EMAIL_PROVIDER`; `OTP_PROVIDER: "fake"` with `NODE_ENV: "development"` throws naming `OTP_PROVIDER`; `DATA_ENCRYPTION_KEY` of 16 bytes throws naming it; the thrown message never contains the value of `JWT_PRIVATE_KEY_B64`.
  - `secrets.test.ts`: `addMissingSecrets("A=1\nJWT_PRIVATE_KEY_B64=\n", gens)` → `added` equals `["JWT_PRIVATE_KEY_B64", "DATA_ENCRYPTION_KEY"]`, `A=1` unchanged, the empty line replaced; running it again on its output → `added: []` and identical text; `defaultGenerators().DATA_ENCRYPTION_KEY()` decodes to 32 bytes; the JWT key imports with `createPrivateKey({ key: Buffer.from(v, "base64"), format: "der", type: "pkcs8" })` and has `asymmetricKeyType === "ed25519"`.
  - `rate-limit.int.test.ts` (real Redis): 3 `consume("t", 3, 60)` allowed, 4th `allowed: false` with `retryAfterSec` in 1–60; `enforce` on the 4th rejects with status 429 and response code `RATE_LIMITED`; `reset("t")` then allowed again; window expiry with `windowSec: 1` (wait 1.1 s with a real timer) allows again.
  - `tenancy.int.test.ts`: after `seedFixture`, `getOrgId()` returns the fixture org id; with no org it rejects with `/test-salon not found/`.
  - `app.e2e.test.ts`: switch its `loadEnv({...})` to `testEnv()`; all existing cases still pass.
- [ ] **Step 3: Run** `pnpm --filter @beautyspa/api test` and `test:int` · Expected: new tests FAIL.
- [ ] **Step 4: Implement** the files above; add deps `ioredis`, `cookie-parser`, `@types/cookie-parser` (dev).
- [ ] **Step 5: Run** `pnpm turbo run lint typecheck test --filter=@beautyspa/api && pnpm --filter @beautyspa/api test:int` · Expected: PASS. Then `cp .env .env.bak 2>/dev/null; pnpm --filter @beautyspa/api secrets:gen` prints only key names; `grep -c '^JWT_PRIVATE_KEY_B64=.\+' .env` → `1`. (Do not print `.env`.)
- [ ] **Step 6: Docs** per Files list. **Commit** — `feat(api): typed auth config, secrets script, redis, rate limiter, tenancy`

---

### Task 3: Crypto primitives

**Files:**
- Create: `apps/api/src/auth/crypto/encryption.ts`, `totp.ts`, `base32.ts`, `password.ts`, `tokens.ts`, `recovery-codes.ts` (all under `apps/api/src/auth/crypto/`)
- Test: same names with `.test.ts` in that folder
- Docs: `apps/api/README.md` (short "Auth crypto" list: algorithms and parameters)

**Interfaces — Produces:**
- `class Encryptor { constructor(opts: { keyId: string; keyB64: string }); encrypt(plaintext: string): string; decrypt(payload: string): string }` — AES-256-GCM, 12-byte random IV, format `<keyId>.<b64url iv>.<b64url ciphertext‖16-byte tag>`; `decrypt` throws `Error("Unknown encryption key id")` for another key id and `Error("Decryption failed")` on tamper.
- `base32Encode(bytes: Uint8Array): string` (RFC 4648, uppercase, no padding); `base32Decode(s: string): Uint8Array` (case-insensitive, ignores padding/spaces, throws on invalid chars).
- `generateTotpSecret(): string` (20 random bytes, base32); `totpCode(secretB32: string, timeMs: number, digits = 6): string`; `verifyTotp(secretB32: string, code: string, timeMs: number, window = 1): number | null` — returns the matched step counter (`floor(timeMs/1000/30)` ± window) or null; constant-time compare; `otpauthUrl(secretB32: string, accountEmail: string): string` → `otpauth://totp/BeautySpa:<encodeURIComponent(email)>?secret=<s>&issuer=BeautySpa&algorithm=SHA1&digits=6&period=30`.
- `hashPassword(pw: string): Promise<string>`; `verifyPassword(hash: string, pw: string): Promise<boolean>` (false, not throw, on malformed hash); `DUMMY_PASSWORD_HASH_INPUT` constant used to precompute a dummy hash for timing equalization.
- `randomToken(): string` (32 bytes base64url); `sha256Hex(s: string): string`.
- `generateRecoveryCodes(n = 10): string[]` — each `xxxx-xxxx-xxxx-xxxx` of lowercase base32 chars (80 bits), all distinct; `normalizeRecoveryCode(input: string): string` (lowercase, remove whitespace and `-`); `hashRecoveryCode(input: string): string` = `sha256Hex(normalizeRecoveryCode(input))`.

- [ ] **Step 1: Write failing tests**
  - TOTP, RFC 6238 SHA-1 vectors with secret `base32Encode(Buffer.from("12345678901234567890"))` (= `"GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"`), `digits = 8`: t=59 s → `94287082`; 1111111109 → `07081804`; 1111111111 → `14050471`; 1234567890 → `89005924`; 2000000000 → `69279037`. With 6 digits t=59 s → `287082`.
  - `verifyTotp(secret, totpCode(secret, T - 30_000), T)` returns `floor(T/30000) - 1`; a code from `T - 60_000` returns null; `"000000"` for a random secret at a fixed T returns null unless it matches.
  - base32 round-trips random 20-byte buffers; decode of `"gezdgnbv"` equals decode of `"GEZDGNBV"`; `"GEZ1"` throws.
  - Encryptor: round-trip `"JBSWY3DPEHPK3PXP"`; two encryptions of the same text differ; flipping one char of the ciphertext part → throws `Decryption failed`; payload from an Encryptor with `keyId: "k2"` → throws `Unknown encryption key id`.
  - Password: `verifyPassword(await hashPassword("correct horse battery"), "correct horse battery")` → true; wrong pw → false; `verifyPassword("garbage", "x")` → false; hash starts with `$argon2id$v=19$m=19456,t=2,p=1$`.
  - Tokens: `randomToken()` matches `/^[A-Za-z0-9_-]{43}$/`; `sha256Hex("abc")` = `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`.
  - Recovery codes: 10 distinct, each matches `/^[a-z2-7]{4}(-[a-z2-7]{4}){3}$/`; `hashRecoveryCode(" ABCD-efgh ijkl-MNOP ")` equals `hashRecoveryCode("abcdefghijklmnop")`.
- [ ] **Step 2: Run** `pnpm --filter @beautyspa/api test -- src/auth/crypto` · Expected: FAIL.
- [ ] **Step 3: Implement** with `node:crypto` only (plus `@node-rs/argon2` for passwords; add the dep).
- [ ] **Step 4: Run** `pnpm turbo run lint typecheck test --filter=@beautyspa/api` · Expected: PASS.
- [ ] **Step 5: Commit** — `feat(api): auth crypto primitives (aes-gcm, totp, argon2id, tokens)`

---

### Task 4: Tokens, sessions, guard, refresh and logout, audit writer

**Files:**
- Create: `apps/api/src/auth/auth.module.ts`, `token.service.ts`, `refresh-token.service.ts`, `session.service.ts`, `access.guard.ts`, `decorators.ts`, `session.controller.ts`, `request-meta.ts` (all under `apps/api/src/auth/`); `apps/api/src/audit/audit.service.ts`, `apps/api/src/audit/audit.module.ts`
- Modify: `apps/api/src/app.module.ts` (import `AuthModule`, `AuditModule`), `apps/api/src/health/health.controller.ts` (`@Public()`)
- Test: `apps/api/src/auth/token.service.test.ts`, `apps/api/test/integration/auth/session.int.test.ts`, `apps/api/test/integration/auth/guard.int.test.ts`
- Docs: `docs/superpowers/specs/2026-11-17-mvp-design/architecture.md` (design calls 1, 2), `apps/api/README.md` ("Auth" section: decorators, fail-closed guard, transports)

**Interfaces:**
- Consumes: `Env`, `ENV`, `TenancyService`, `RateLimitService`, `randomToken`, `sha256Hex`, `AccessClaims`, `TokenResponse`, `AUTH_HEADERS`.
- Produces:
  - `TokenService`: `issueAccess(claims: AccessClaims): Promise<{ token: string; expiresAt: Date }>`; `verifyAccess(token: string): Promise<AccessClaims>` (throws `UnauthorizedException({ code: "UNAUTHORIZED" })`); `issueMfa(staffId: string, orgId: string, purpose: "verify" | "enroll"): Promise<{ token: string; expiresAt: Date }>`; `verifyMfa(token: string, purpose: "verify" | "enroll"): Promise<{ staffId: string; orgId: string }>` (throws 401 `UNAUTHORIZED`). Uses `jose` `SignJWT`/`jwtVerify` with `algorithms: ["EdDSA"]`, the `iss`/`aud`/`typ` from Global Constraints; public key derived from the private key at construction.
  - `type Subject = { type: "CUSTOMER" | "STAFF"; id: string }`; `type RequestMeta = { ip: string | null; userAgent: string | null }`; `requestMeta(req: Request): RequestMeta` (user agent truncated to 255).
  - `RefreshTokenService`: `create(subject: Subject, meta: RequestMeta): Promise<{ token: string; expiresAt: Date }>` (new `family_id` = `randomUUID()`); `rotate(token: string, meta: RequestMeta): Promise<{ subject: Subject; token: string; expiresAt: Date }>` — in one `$transaction`: find by hash; unknown or expired → 401; already rotated or revoked → revoke whole family (`revoked_at = now()` where null), write audit `auth.refresh_reuse` (actor `SYSTEM`, entity `refresh_token_family`, entityId family id), then 401; else `updateMany({ where: { id, rotatedAt: null, revokedAt: null }, data: { rotatedAt: now } })` and if `count !== 1` treat as reuse (concurrent rotation); insert the successor with the same `familyId` and the same `expiresAt`. `revokeFamilyOf(token: string): Promise<void>` (no-op if unknown); `revokeAllFor(subject: Subject): Promise<void>`.
  - `SessionService`: `start(subject: Subject, req: Request, res: Response): Promise<TokenResponse>` — loads the subject's claims (customer → `{ typ: "customer", role: "CUSTOMER", org: customer.organizationId }`; staff → role from `staff_user`), issues both tokens, applies transport; `refresh(req, res): Promise<TokenResponse>` — reads token from cookie `bs_refresh` (requires header `x-beautyspa-csrf: 1`, else 403 `FORBIDDEN`) or from body `refreshToken` (body transport), rotates, then rejects with 401 and `revokeAllFor(subject)` if the customer is soft-deleted or the staff user is `active = false` or `can_login = false`; `logout(req, res): Promise<void>` — revokes the family, clears the cookie, 204 even for unknown tokens.
  - Transport: if request header `x-token-transport` equals `body`, put `refreshToken` in the response and set no cookie; otherwise set cookie `bs_refresh` (`httpOnly`, `sameSite: "lax"`, `path: "/v1/auth"`, `secure: env.COOKIE_SECURE`, `domain: env.COOKIE_DOMAIN`, `expires: expiresAt`) and omit `refreshToken`.
  - `session.controller.ts`: `POST /auth/refresh` (`@Public()`, body `RefreshRequestSchema`, 200 `TokenResponse`), `POST /auth/logout` (`@Public()`, 204).
  - Decorators: `Public()`, `CustomerAuth()`, `StaffAuth(...roles: StaffRole[])` (no roles = any staff role), `Principal()` param decorator → `AccessClaims`. Metadata key `"auth:policy"`.
  - `AccessGuard` (registered as `APP_GUARD` in `AuthModule`): no policy metadata → 403 `FORBIDDEN`; `public` → allow; otherwise `Authorization: Bearer <jwt>` required (missing/invalid/expired → 401 `UNAUTHORIZED`), `claims.org` must equal `TenancyService.getOrgId()` (else 401), `typ`/`role` must match the policy (else 403 `FORBIDDEN`). Sets `req.principal`.
  - `AuditService.record(entry: { orgId: string; actorType: "STAFF" | "CUSTOMER" | "SYSTEM"; actorId: string | null; action: string; entity: string; entityId?: string | null; before?: object | null; after?: object | null; ip?: string | null }, tx?: Prisma.TransactionClient): Promise<void>`.

- [ ] **Step 1: Write failing tests**
  - `token.service.test.ts` (unit, `testEnv()`): access token round-trips claims; `exp - iat === 900`; header `alg: "EdDSA"`, `kid: "k1"`; an MFA token passed to `verifyAccess` → 401; an access token passed to `verifyMfa` → 401; MFA `enroll` token rejected by `verifyMfa(t, "verify")`; a token signed by a different Ed25519 key → 401; expired token (use `vi.setSystemTime` +16 min) → 401.
  - `session.int.test.ts` (seed a customer and a staff user; call `SessionService.start` through a test-only controller registered in the testing module, `@Public()` `POST /test/login/:kind/:id`):
    - cookie transport: response sets `bs_refresh` with `HttpOnly`, `SameSite=Lax`, `Path=/v1/auth`; body has no `refreshToken`.
    - `POST /v1/auth/refresh` with the cookie and `x-beautyspa-csrf: 1` → 200, new access token, new cookie; DB row of the old token has `rotated_at` set; successor has the same `family_id` and `expires_at`.
    - same refresh without the CSRF header → 403 `FORBIDDEN`.
    - body transport (`x-token-transport: body`): response has `refreshToken`, no `set-cookie`; refresh with `{ refreshToken }` works.
    - reuse: refresh with token A → B; refresh with A again → 401, every row of the family has `revoked_at`, and refresh with B → 401; an `audit_log` row `auth.refresh_reuse` exists.
    - concurrent: `Promise.all` of two refreshes with the same token → exactly one 200 and one 401.
    - staff TTL: staff refresh `expires_at` ≈ now + 12 h (±60 s); customer ≈ now + 30 d.
    - after `staff_user.active = false`, refresh → 401 and the family is revoked; same for a customer with `deleted_at` set.
    - expired token (set `expires_at` in the past) → 401.
    - logout with cookie + CSRF header → 204, `set-cookie` clears `bs_refresh`, family revoked; logout with an unknown token → 204.
  - `guard.int.test.ts` (test controller with routes: undecorated, `@Public()`, `@CustomerAuth()`, `@StaffAuth()`, `@StaffAuth("OWNER")`): undecorated → 403 even with a valid OWNER token; public → 200 without token; customer route: no token 401, staff token 403, customer token 200 and `Principal()` returns its claims; OWNER route: RECEPTION 403, OWNER 200; token with `org` of another organization → 401; `GET /v1/health` still 200 without a token.
- [ ] **Step 2: Run** unit + `test:int` · Expected: FAIL.
- [ ] **Step 3: Implement**; add dep `jose@^5`.
- [ ] **Step 4: Run** `pnpm turbo run lint typecheck test --filter=@beautyspa/api && pnpm --filter @beautyspa/api test:int` · Expected: PASS.
- [ ] **Step 5: Docs** per Files list. **Commit** — `feat(api): access/refresh tokens with rotation and reuse detection, fail-closed RBAC guard`

---

### Task 5: Customer phone OTP

**Files:**
- Create: `apps/api/src/auth/otp/otp-provider.ts` (interface + `OTP_PROVIDER` token), `twilio-verify.provider.ts`, `console-otp.provider.ts`, `fake-otp.provider.ts`, `otp.service.ts`, `otp.controller.ts` (under `apps/api/src/auth/otp/`)
- Modify: `apps/api/src/auth/auth.module.ts` (provider chosen by `env.OTP_PROVIDER`)
- Test: `apps/api/src/auth/otp/twilio-verify.provider.test.ts`, `apps/api/test/integration/auth/otp.int.test.ts`
- Docs: `apps/api/README.md` (OTP providers and dev usage: the console provider logs the code)

**Interfaces:**
- Consumes: `RateLimitService`, `TenancyService`, `SessionService`, `AuditService`, `sha256Hex`, contracts `OtpStart*`, `OtpVerify*`.
- Produces:
  - `interface OtpProvider { start(phone: string, channel: "whatsapp" | "sms", locale: Locale): Promise<void>; check(phone: string, code: string): Promise<boolean> }`.
  - `TwilioVerifyProvider(env, fetchFn = fetch)`: `start` → `POST https://verify.twilio.com/v2/Services/{TWILIO_VERIFY_SERVICE_SID}/Verifications`, form `To`, `Channel`, `Locale`; Basic auth `SID:TOKEN`; non-2xx throws `Error("Twilio Verify start failed: <status>")` (no body in message). `check` → `.../VerificationCheck` form `To`, `Code`; returns `json.status === "approved"`; 404 → false; other non-2xx throws.
  - `ConsoleOtpProvider(redis)`: `start` stores `sha256Hex(code)` of a random 6-digit code at `otp:console:<hashKeyPart(phone)>` with `EX 600` and logs `OTP for <phone>: <code>` via Nest `Logger`; `check` compares and deletes on success.
  - `FakeOtpProvider`: `start` no-op; `check` returns `code === "000000"`.
  - `OtpService.start(req: { phone, locale }, ip): Promise<{ channel }>` — rejects non-`+1` phones with `BadRequestException({ code: "VALIDATION_FAILED", message: "Only US phone numbers are supported" })` (body also `errors: [{ path: "phone", message }]`; extend `ProblemFilter` to pass through an `errors` array from an `HttpException` body if not already supported); enforces per-phone and per-IP limits; tries `whatsapp`, on throw logs a warning and tries `sms`; both throw → `ServiceUnavailableException()`.
  - `OtpService.verify(req: { phone, code, locale? }, httpReq, res): Promise<OtpVerifyResponse>` — per-phone limit; `check` false → `BadRequestException({ code: "OTP_INVALID" })`; true → `customer.upsert` on `organizationId_phoneE164` (create: `locale = req.locale ?? organization.defaultLocale`, `createdVia: "ONLINE"`, `phoneVerifiedAt: now`; update: `phoneVerifiedAt: now`); a found customer with `deletedAt` set → 401 `UNAUTHORIZED` (plan 04 anonymization frees the phone); audit `auth.customer.login` (actor `CUSTOMER`, entity `customer`, `after: { isNew }`); `SessionService.start`; returns tokens + `isNew = customer.name === null`.
  - Controller: `POST /auth/otp/start` (`@Public()`, 200), `POST /auth/otp/verify` (`@Public()`, 200).

- [ ] **Step 1: Write failing tests**
  - `twilio-verify.provider.test.ts` (fake fetch): start sends form `To=%2B13055550100&Channel=whatsapp&Locale=es` to the Verifications URL with `Authorization: Basic <base64(SID:TOKEN)>`; check returns true for `{ status: "approved" }`, false for `{ status: "pending" }`, false on 404, throws on 500 with a message that does not include the response body.
  - `otp.int.test.ts` (`OTP_PROVIDER=fake`, seeded org):
    - start `{ phone: "+13055550100", locale: "es" }` → 200 `{ channel: "whatsapp" }`.
    - start with `"+443055550100"` → 400 `VALIDATION_FAILED`, `errors[0].path === "phone"`; with `"305-555-0100"` → 400 `VALIDATION_FAILED`.
    - whatsapp failure falls back: via `createIntegrationApp({ override })`, replace the `OTP_PROVIDER` token with a stub whose `start` throws for `whatsapp` → `{ channel: "sms" }`; both throw → 503.
    - 4th start for the same phone within 10 min → 429 `RATE_LIMITED`.
    - verify with `"123456"` → 400 `OTP_INVALID`; with `"000000"` → 200, `isNew: true`, a `customer` row exists with `locale` from the request (`"es"`) and `phone_verified_at` set, `created_via = ONLINE`; an `audit_log` row `auth.customer.login`.
    - second verify for the same phone after setting the name → `isNew: false`, still one customer row.
    - returned access token works on a `@CustomerAuth()` test route.
    - 6th verify within 10 min → 429.
- [ ] **Step 2: Run** · Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** full API checks + `test:int` · Expected: PASS.
- [ ] **Step 5: Commit** — `feat(api): customer phone OTP via Twilio Verify with whatsapp→sms fallback`

---

### Task 6: Staff login, lockout, TOTP enroll/verify/recover

**Files:**
- Create: `apps/api/src/auth/staff/staff-auth.service.ts`, `apps/api/src/auth/staff/staff-auth.controller.ts`, `apps/api/src/auth/staff/mfa.service.ts`
- Modify: `apps/api/src/auth/auth.module.ts`
- Test: `apps/api/test/integration/auth/staff-login.int.test.ts`, `apps/api/test/integration/auth/mfa.int.test.ts`; helper `createStaff(prisma, f, opts: { email: string; role: StaffRole; password?: string; totpSecret?: string; active?: boolean; canLogin?: boolean }): Promise<{ id: string }>` in `test/integration/helpers.ts` (encrypts `totpSecret` with the test `Encryptor`, sets `totp_enrolled_at` when given)
- Docs: `docs/superpowers/specs/2026-11-17-mvp-design/api.md` already updated in Task 1; `apps/api/README.md` (staff login sequence, 4 lines)

**Interfaces:**
- Consumes: `hashPassword`, `verifyPassword`, `Encryptor` (provided in `AuthModule` from `env.DATA_ENCRYPTION_KEY`/`_ID`), `generateTotpSecret`, `verifyTotp`, `otpauthUrl`, recovery-code functions, `TokenService.issueMfa/verifyMfa`, `SessionService.start`, `RateLimitService`, `AuditService`, `TenancyService`.
- Produces:
  - `StaffAuthService.login(body: StaffLoginRequest, req): Promise<MfaStepResponse>` — per-IP limit; then `consume(rl:login:fail:<hash(email)>, 5, 900)` before the password check, not allowed → 429 (decided in review: check-then-count was racy); find `staff_user` by org + email; missing, `active=false`, `can_login=false` or no `password_hash` → still run `verifyPassword(dummyHash, pw)`, count a failure, 401 `{ code: "UNAUTHORIZED", message: "Invalid email or password" }`; wrong password → count failure, audit `auth.staff.login_failed` (entity `staff_user`), same 401; success → `reset` failure key; `totp_enrolled_at` set → `MFA_REQUIRED` + `issueMfa(id, org, "verify")`, else `ENROLL_REQUIRED` + `issueMfa(id, org, "enroll")`.
  - `MfaService.enrollStart(mfaToken): Promise<MfaEnrollStartResponse>` — enroll purpose; 409 `CONFLICT` if already enrolled; stores a new encrypted secret in `totp_secret_enc` (pending while `totp_enrolled_at` is null; re-calling replaces it).
  - `MfaService.enrollConfirm(body: MfaCodeRequest, req, res): Promise<MfaEnrollConfirmResponse>` — enroll purpose; per-staff limit; no pending secret → 409; code checked with `verifyTotp` + replay guard → else 400 `MFA_INVALID`; in one transaction set `totp_enrolled_at`, delete old recovery codes, insert 10 new hashes; audit `auth.staff.mfa_enrolled`; `SessionService.start`; return tokens + plaintext codes.
  - `MfaService.verify(body: MfaCodeRequest, req, res): Promise<TokenResponse>` — verify purpose; per-staff limit; re-check `active` and `can_login`; TOTP + replay guard → else 400 `MFA_INVALID`; audit `auth.staff.login`; session.
  - `MfaService.recover(body: MfaRecoverRequest): Promise<MfaStepResponse>` — verify purpose; per-staff limit; find unused code by `hashRecoveryCode` → else 400 `MFA_INVALID`; one transaction: mark it used, delete the other codes, clear `totp_secret_enc`/`totp_enrolled_at`, `revokeAllFor(staff)`; audit `auth.staff.recovery_used`; return `ENROLL_REQUIRED` + enroll mfaToken.
  - Replay guard: `SET totp:used:<staffId>:<counter> 1 NX EX 120`; NX failure → `MFA_INVALID`.
  - Routes (all `@Public()`): `POST /auth/staff/login`, `/auth/staff/mfa/enroll`, `/auth/staff/mfa/enroll/confirm`, `/auth/staff/mfa/verify`, `/auth/staff/mfa/recover`; all 200.

- [ ] **Step 1: Write failing tests**
  - `staff-login.int.test.ts`:
    - enrolled staff, login with `" Ana@Salon.COM "` (stored `ana@salon.com`) → 200 `MFA_REQUIRED` with an `mfaToken`.
    - not enrolled → `ENROLL_REQUIRED`.
    - wrong password, unknown email, inactive, `can_login=false` → all 401 with identical body `{ code: "UNAUTHORIZED", detail: "Invalid email or password" }`.
    - 5 wrong passwords then the correct one → 429 `RATE_LIMITED`; after `redis.del` of the failure key the correct one → 200; a success resets the counter (4 wrong, 1 right, 4 wrong → still not locked).
    - `auth.staff.login_failed` audit rows exist for the known-email failures and contain no password.
  - `mfa.int.test.ts` (use `totpCode(secret, Date.now())` to produce codes):
    - enroll start → `secret` base32 and `otpauthUrl` starting `otpauth://totp/BeautySpa:`; calling it with a `verify` mfaToken → 401.
    - enroll confirm with a wrong code → 400 `MFA_INVALID`; with the right code → 200, 10 recovery codes, tokens, `totp_enrolled_at` set, 10 rows in `staff_recovery_code`; the DB `totp_secret_enc` does not contain the plaintext secret.
    - enroll start after enrollment → 409 `CONFLICT`.
    - verify with the current code → 200 tokens (role claim matches `staff_user.role`); the same code again within 2 min → 400 `MFA_INVALID` (replay); 6th attempt → 429.
    - an expired mfaToken → 401: sign it in the test with `jose` `SignJWT` using the test env's `JWT_PRIVATE_KEY_B64`, the MFA `aud`/`typ`/`purpose` claims and `exp` 1 minute in the past.
    - recover with a valid code → `ENROLL_REQUIRED`; the code cannot be reused (the old mfaToken + same code → 400); `totp_enrolled_at` is null; the user's refresh families are revoked; enroll start + confirm with the new enroll token works.
- [ ] **Step 2: Run** · Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** full API checks + `test:int` · Expected: PASS.
- [ ] **Step 5: Commit** — `feat(api): staff password login with lockout and mandatory TOTP`

---

### Task 7: Mailer, invite/reset links, owner endpoints, `create-owner` CLI

**Files:**
- Create: `apps/api/src/mail/mailer.ts` (interface + `MAILER` token), `console.mailer.ts`, `resend.mailer.ts`, `mail.module.ts` (under `apps/api/src/mail/`); `apps/api/src/auth/staff/staff-links.service.ts`, `staff-links.controller.ts`, `staff-admin.controller.ts`, `emails.ts` (under `apps/api/src/auth/staff/`); `apps/api/src/cli/create-owner.ts`
- Modify: `apps/api/src/auth/auth.module.ts`, `apps/api/src/app.module.ts`, `apps/api/package.json` (script `"create-owner": "nest build && dotenv -e ../../.env -- node dist/cli/create-owner.js"`)
- Test: `apps/api/src/mail/resend.mailer.test.ts`, `apps/api/test/integration/auth/staff-links.int.test.ts`, `apps/api/test/integration/auth/owner-cli.int.test.ts`
- Docs: `docs/development/README.md` ("First owner": run `create-owner`, open the printed link; dev emails are printed by the console mailer), `docs/superpowers/specs/2026-11-17-mvp-design/architecture.md` (design call 10)

**Interfaces:**
- Produces:
  - `interface MailMessage { to: string; subject: string; text: string }`; `interface Mailer { send(msg: MailMessage): Promise<void> }`.
  - `ConsoleMailer`: logs `to` and `subject` and the `text` via Nest `Logger`; keeps the last 50 in `readonly sent: MailMessage[]` (tests read it via `app.get(MAILER)`).
  - `ResendMailer(env, fetchFn = fetch)`: `POST https://api.resend.com/emails`, `Authorization: Bearer RESEND_API_KEY`, JSON `{ from: EMAIL_FROM, to: [to], subject, text }`; non-2xx throws `Error("Resend send failed: <status>")`.
  - `emails.ts`: `inviteEmail(locale: Locale, link: string): { subject: string; text: string }` and `resetEmail(locale, link)` — EN and ES copy; subjects: EN `"You're invited to BeautySpa"` / ES `"Te invitaron a BeautySpa"`; EN `"Reset your BeautySpa password"` / ES `"Restablece tu contraseña de BeautySpa"`. Text says the link expiry (72 hours / 1 hour; ES "72 horas" / "1 hora").
  - `StaffLinksService`:
    - `issue(staffId: string, purpose: "INVITE" | "PASSWORD_RESET", tx?): Promise<string>` — marks older unused tokens of that purpose used, stores `sha256Hex` of a new `randomToken()`, returns the link `${WEB_ORIGIN}/${locale}/staff/invite?token=<t>` or `/staff/reset?token=<t>` (`locale` from `staff_user.locale`).
    - `acceptInvite(body: InviteAcceptRequest, req): Promise<MfaStepResponse>` — token by hash, purpose `INVITE`, unused, unexpired, staff `active` → else 400 `LINK_INVALID`; one transaction: mark used (conditional `updateMany` on `usedAt: null`, count must be 1), set `password_hash`, `can_login = true`; audit `auth.staff.invite_accepted`; returns `ENROLL_REQUIRED` + enroll mfaToken (or `MFA_REQUIRED` + verify token if already enrolled).
    - `forgot(body: PasswordForgotRequest, ip): Promise<void>` — per-IP limit (429); per-email limit exceeded → return silently; only an active, `can_login`, password-holding staff gets a `PASSWORD_RESET` link by email; always resolves (controller returns 204).
    - `reset(body: PasswordResetRequest, req): Promise<void>` — same token checks with purpose `PASSWORD_RESET` → else `LINK_INVALID`; set the hash, `revokeAllFor(staff)`, audit `auth.staff.password_reset`.
    - `inviteByOwner(ownerClaims: AccessClaims, staffId: string, ip): Promise<void>` — staff in the same org with an email → else 404 `NOT_FOUND` / 409 `CONFLICT` "Staff member has no email"; already has a password → 409 `CONFLICT`; issues 72 h invite, emails it, audit `staff.invite` (actor STAFF).
    - `reset2faByOwner(ownerClaims, staffId, ip): Promise<void>` — own id → 403 `FORBIDDEN`; target in org → else 404; clears TOTP and recovery codes, `revokeAllFor`, audit `staff.reset_2fa` with `before: { totpEnrolled: boolean }`.
    - `createOrResetOwner(email: string, locale: Locale): Promise<{ link: string; created: boolean }>` — in the default org: no staff with that email → create `role OWNER`, `can_login true`; existing OWNER → clear password, TOTP, recovery codes, `revokeAllFor`; existing non-OWNER → throw `Error("<email> belongs to a non-owner staff member")`; issue INVITE; audit `staff.owner_cli` (actor SYSTEM).
  - Routes: `POST /auth/staff/invite/accept` (200), `/auth/staff/password/forgot` (204), `/auth/staff/password/reset` (204) — all `@Public()`, per-IP limit 10/900 s; `POST /staff/employees/:id/invite` and `POST /staff/employees/:id/reset-2fa` — `@StaffAuth("OWNER")`, 204, `:id` validated as UUID (400 otherwise).
  - `create-owner.ts`: parses `--email <e>` (validated with `EmailSchema`) and `--locale en|es` (default `en`); boots `NestFactory.createApplicationContext(AppModule)`; prints `Owner created` or `Owner reset`, then `Invite link (valid 72 h): <link>`; exit 1 with a one-line message on bad args or non-owner email.

- [ ] **Step 1: Write failing tests**
  - `resend.mailer.test.ts` (fake fetch): request URL, bearer header, JSON body; throws on 422 without echoing the body.
  - `staff-links.int.test.ts`:
    - OWNER (enrolled, token from `SessionService`) invites a RECEPTION staff with email and no password → 204; `ConsoleMailer.sent` has one message to that email, subject in the staff's locale, containing `/staff/invite?token=`; `staff_auth_token` row stores a hash ≠ the token in the link.
    - RECEPTION calling the invite route → 403; staff in another org id → 404; staff with a password → 409.
    - accept with the link token + `"a-long-password-1"` → 200 `ENROLL_REQUIRED`; `can_login = true`; login with that password → `ENROLL_REQUIRED`.
    - accept the same token again → 400 `LINK_INVALID`; an expired token (set `expires_at` past) → 400 `LINK_INVALID`; an unknown token → 400 `LINK_INVALID`; re-invite then the first link → 400 `LINK_INVALID`, second link works.
    - accept with an 11-char password → 400 `VALIDATION_FAILED`.
    - forgot for `" ANA@salon.com "` → 204 and one reset email; for an unknown email → 204 and no email; 4th forgot within an hour → 204 and still only 3 emails.
    - reset with the link → 204; old password fails login; new password works; refresh families revoked; reusing the link → `LINK_INVALID`.
    - OWNER reset-2fa on an enrolled EMPLOYEE → 204; next login → `ENROLL_REQUIRED`; their refresh token → 401; audit row `staff.reset_2fa`; OWNER resetting self → 403.
  - `owner-cli.int.test.ts` (calls `createOrResetOwner` directly): new email → `created: true`, OWNER row with `can_login`, link contains `/en/staff/invite?token=`; same email again → `created: false`, password and TOTP cleared; email of an EMPLOYEE → rejects with `/non-owner/`.
- [ ] **Step 2: Run** · Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** full API checks + `test:int` · Expected: PASS. Then CLI smoke: `pnpm --filter @beautyspa/api db:deploy && pnpm --filter @beautyspa/api db:seed && pnpm --filter @beautyspa/api create-owner --email owner@example.com --locale es` → prints `Owner created` and a link containing `/es/staff/invite?token=`; running it again prints `Owner reset`.
- [ ] **Step 5: Docs** per Files list. **Commit** — `feat(api): staff invites, password reset, owner 2FA reset and create-owner CLI`

---

### Task 8: `@beautyspa/api-client`

**Files:**
- Create: `packages/api-client/package.json` (same build/test/lint scripts and `exports` shape as `packages/contracts`; deps `@beautyspa/contracts`, `zod`), `tsconfig.json` (platform), `tsup.config.ts`, `eslint.config.mjs` (platform), `vitest.config.ts`, `README.md` (10 lines: usage on web and native)
- Create: `packages/api-client/src/index.ts`, `src/fetch.ts`, `src/token-store.ts`, `src/errors.ts`, `src/client.ts`
- Test: `packages/api-client/src/client.test.ts`, `src/token-store.test.ts`

**Interfaces:**
- Consumes: contracts from Task 1 (`ProblemSchema`, auth schemas, `AUTH_HEADERS`).
- Produces:
  - `type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; credentials?: "include" | "omit" }) => Promise<{ status: number; headers: { get(name: string): string | null }; text(): Promise<string> }>` (no DOM types).
  - `interface TokenStore { getAccessToken(): string | null; setAccessToken(token: string | null): void; getRefreshToken(): Promise<string | null>; setRefreshToken(token: string | null): Promise<void> }`.
  - `class MemoryTokenStore implements TokenStore` (both tokens in memory; base for native, used in tests); `createCookieTokenStore(): TokenStore` (access in memory; refresh methods are no-ops returning null — the cookie holds it).
  - `class ApiError extends Error { readonly status: number; readonly problem: Problem }` — non-problem error bodies become `{ type: "about:blank", title: "Error", status, code: status >= 500 ? "INTERNAL" : "BAD_REQUEST" }`.
  - `createApiClient(opts: { baseUrl: string; fetch: FetchLike; tokenStore: TokenStore; transport: "cookie" | "body"; onSessionExpired?: () => void }): ApiClient`.
  - `ApiClient.request<T>(opts: { method: "GET" | "POST" | "PATCH" | "DELETE"; path: string; body?: unknown; schema: z.ZodType<T> | null; auth?: boolean }): Promise<T>` — `schema: null` for 204. Sends JSON, `Authorization: Bearer` when `auth !== false` and a token exists; `credentials: "include"` in cookie transport. On 401 with `auth !== false`: one refresh (single-flight across concurrent calls), retry once; refresh failure → `tokenStore` cleared, `onSessionExpired?.()`, throw the original 401 `ApiError`. Response parsed with `schema.parse`.
  - `ApiClient.auth`: `otpStart(b)`, `otpVerify(b)`, `staffLogin(b)`, `mfaEnrollStart(b)`, `mfaEnrollConfirm(b)`, `mfaVerify(b)`, `mfaRecover(b)`, `inviteAccept(b)`, `passwordForgot(b)`, `passwordReset(b)`, `refresh()`, `logout()` — paths from `api.md` under `/v1`. Methods that return tokens store them (`accessToken`; `refreshToken` in body transport). Body transport adds header `x-token-transport: body` to token-issuing calls and sends `{ refreshToken }` on refresh/logout; cookie transport sends `x-beautyspa-csrf: 1` on refresh/logout. `logout()` clears the store even if the call fails.

- [ ] **Step 1: Write failing tests** (scripted fake `FetchLike` that records calls):
  - `otpVerify` in body transport: request has `x-token-transport: body`; store then holds the access and refresh tokens.
  - cookie transport `refresh()`: `credentials: "include"`, header `x-beautyspa-csrf: 1`, no body token, no `x-token-transport`.
  - authed `GET /v1/me` → 401, refresh → 200, retry → 200: exactly 3 calls, the retry carries the new bearer.
  - two concurrent authed requests both get 401 → only one refresh call is made; both resolve.
  - refresh returns 401 → `onSessionExpired` called once, store cleared, request rejects with `ApiError` status 401.
  - a 409 problem response → `ApiError` with `problem.code === "SLOT_TAKEN"`; a 502 with HTML body → `ApiError` with code `INTERNAL`.
  - a 200 body failing the schema → rejects (ZodError).
  - `logout()` clears the store when the server returns 500.
  - `createCookieTokenStore().getRefreshToken()` resolves null.
- [ ] **Step 2: Run** `pnpm --filter @beautyspa/api-client test` · Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm install && pnpm turbo run lint typecheck test build` · Expected: PASS (whole repo; the platform lint rule covers the new package).
- [ ] **Step 5: Commit** — `feat(api-client): typed auth client with pluggable token store and single-flight refresh`

---

## Finish

- [ ] Final branch review (`reviewer-opus`): whole diff vs this plan and the spec pages listed above.
- [ ] Update `docs/handoff.md` (done, carried items: plan 04 anonymization must free `phone_e164`; plan 03 employee CRUD uses `StaffLinksService.issue` for invites; plan 06/07 pages `/[locale]/staff/invite` and `/staff/reset`) and this plan index row → merged.
- [ ] Push, open PR, CI green, merge to `main`.
