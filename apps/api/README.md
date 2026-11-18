# @beautyspa/api

NestJS 11 REST API (CommonJS), served under `/v1`.

- `pnpm --filter @beautyspa/api dev` watch mode on `PORT` (default 3001); needs `DATABASE_URL`, `REDIS_URL`, `WEB_ORIGIN` (see `.env.example`).
- Docs: `/v1/docs` (Swagger UI), `/v1/openapi.json`. Generated from shared Zod contracts via `nestjs-zod`.
- Errors are RFC 7807 `application/problem+json` matching `ProblemSchema` (`src/common/problem.filter.ts`).
- Helmet security headers and CORS restricted to `WEB_ORIGIN`; all wiring lives in `src/bootstrap.ts` (`configureApp`).
- Tests: `pnpm --filter @beautyspa/api test` (Vitest + SWC for decorator metadata, config in `vitest.config.mts`; no database needed).

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
| `test:int` | integration tests (`vitest.int.config.mts`, `test/integration/**/*.int.test.ts`) against `DATABASE_URL_TEST` |

`test:int` applies pending migrations to `DATABASE_URL_TEST` (database name must contain `test` as a `_`-separated word, e.g. `beautyspa_test`, and differ from `DATABASE_URL`) and truncates all tables before each test. The drift check refuses a shadow database whose name lacks `shadow`/`test` or that equals `DATABASE_URL`.
If you edit an already-applied migration locally, reset the test database by hand:
`DATABASE_URL=$DATABASE_URL_TEST pnpm exec prisma migrate reset`.
