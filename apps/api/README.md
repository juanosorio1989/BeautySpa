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
