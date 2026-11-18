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
pnpm --filter @beautyspa/api secrets:gen
pnpm --filter @beautyspa/api db:migrate
pnpm --filter @beautyspa/api db:seed
pnpm dev
```

The API scripts (`dev`, `start`, `db:*`, `test:int`) load the repo-root `.env` through `dotenv-cli`; variables already set in the shell (for example in CI) take precedence, and a missing `.env` is ignored.

`secrets:gen` fills `JWT_PRIVATE_KEY_B64` and `DATA_ENCRYPTION_KEY` in `.env` when they are missing or empty
(copying `.env.example` first if there is no `.env`). It never changes existing lines and prints only key names.
If your `.env` predates plan 02, also add `DEFAULT_ORG_SLUG=demo-salon` and `REDIS_URL_TEST=redis://localhost:6379/1`
(see `.env.example`).

`REDIS_URL_TEST` is the Redis database integration tests flush between cases: it must not be DB 0 and must differ
from `REDIS_URL` (the tests refuse otherwise).

The compose init script creates `beautyspa` and `beautyspa_test` only on an empty volume.
If your volume predates it (no `beautyspa_test`), run `docker compose down -v && docker compose up -d`.
This deletes all local dev data.

## First owner

After `db:seed`, create the first OWNER of the default organization (`DEFAULT_ORG_SLUG`):

```bash
pnpm --filter @beautyspa/api create-owner --email you@example.com --locale en
```

It prints `Owner created` and `Invite link (valid 72 h): ...`. Open the link to set a password and enroll TOTP.
Running it again for the same email prints `Owner reset`: it clears that OWNER's password, TOTP, recovery codes and
sessions and prints a new link (older links stop working). `--locale` is optional: a new OWNER defaults to `en`;
a reset keeps the stored locale unless you pass `--locale`. It refuses an email that belongs to a non-owner.
The link is a one-time credential: do not paste it into chats or tickets.

In development `EMAIL_PROVIDER=console`: invite and password reset emails are not sent, the API logs them
(recipient, subject and text with the link) to its console.

## URLs

- API docs (Swagger UI): http://localhost:3001/v1/docs
- Mailpit: http://localhost:8025

## Commands

| Command | What it does |
|---|---|
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | static checks and unit tests (no database) |
| `pnpm build` | build all packages |
| `pnpm --filter @beautyspa/api db:deploy` | apply migrations to `DATABASE_URL` |
| `pnpm --filter @beautyspa/api test:int` | integration tests against `DATABASE_URL_TEST` and `REDIS_URL_TEST` |
| `pnpm --filter @beautyspa/api secrets:gen` | add missing local secrets to `.env` (prints key names only) |
| `pnpm --filter @beautyspa/api db:drift` | fail if `schema.prisma` and migrations differ |
| `pnpm --filter @beautyspa/api create-owner --email <e> [--locale en\|es]` | create or reset the OWNER and print a 72 h invite link |

API and database details: [apps/api/README.md](../../apps/api/README.md).

## CI

`.github/workflows/ci.yml` runs on pushes to `main` and on pull requests:

- `checks`: install with `--frozen-lockfile`, then lint, typecheck, unit tests, build.
- `integration`: Postgres 16 and Redis 7 services, creates `beautyspa_test`, builds the API,
  `db:deploy`, `test:int`, `db:drift`.
