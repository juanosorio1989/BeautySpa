# Development

## Prerequisites

- Node 22 (`nvm use` reads `.nvmrc`)
- pnpm 10 (pinned by `packageManager`; `corepack enable` installs it)
- Docker (Postgres 16, Redis 7, Mailpit)

## First run

```bash
cp .env.example .env
docker compose up -d
pnpm install
pnpm --filter @beautyspa/api db:migrate
pnpm --filter @beautyspa/api db:seed
pnpm dev
```

The compose init script creates `beautyspa` and `beautyspa_test` only on an empty volume.
If your volume predates it (no `beautyspa_test`), run `docker compose down -v && docker compose up -d`.
This deletes all local dev data.

## URLs

- API docs (Swagger UI): http://localhost:3001/v1/docs
- Mailpit: http://localhost:8025

## Commands

| Command | What it does |
|---|---|
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | static checks and unit tests (no database) |
| `pnpm build` | build all packages |
| `pnpm --filter @beautyspa/api db:deploy` | apply migrations to `DATABASE_URL` |
| `pnpm --filter @beautyspa/api test:int` | integration tests against `DATABASE_URL_TEST` |
| `pnpm --filter @beautyspa/api db:drift` | fail if `schema.prisma` and migrations differ |

API and database details: [apps/api/README.md](../../apps/api/README.md).

## CI

`.github/workflows/ci.yml` runs on pushes to `main` and on pull requests:

- `checks`: install with `--frozen-lockfile`, then lint, typecheck, unit tests, build.
- `integration`: Postgres 16 and Redis 7 services, creates `beautyspa_test`, builds the API,
  `db:deploy`, `test:int`, `db:drift`.
