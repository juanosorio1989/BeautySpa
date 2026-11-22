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

## Development seed

`db:seed` is idempotent (natural keys; safe to run repeatedly) and refuses `NODE_ENV=production`.
Customers and appointments are demo data: never run it against a real database. It creates:

- Organization `demo-salon` and location "Main" (`America/New_York`, open Mon-Sat 09:00-19:00, default settings).
- 2 levels (Junior, Senior), 5 categories, 20 services (3 with Senior prices), 2 resource types with 5 resources
  (Chair 1-3, Cabin 1-2).
- 5 employees (`ana@`, `carmen@`, `luis@`, `sofia@`, `valeria@demo-salon.test`) working Tue-Sat 09:00-13:00 and 14:00-19:00.
  They have `canLogin = false`: they cannot log in until an owner invites them. `create-owner` is still needed for the first OWNER.
- 3 customers (+1718555010x) with 2 WhatsApp consents, and 3 `[seed]` appointments on the next Tue-Sat
  (recreated on each run).

## URLs

- API docs (Swagger UI): http://localhost:3001/v1/docs
- Web (public booking site): http://localhost:3000 (redirects `/` to `/en` or `/es` by `Accept-Language`)
- Mailpit: http://localhost:8025

## Commands

| Command | What it does |
|---|---|
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | static checks and unit tests (no database) |
| `pnpm format` / `pnpm format:check` | Prettier (`printWidth` 120); Markdown, the lockfile and migrations are ignored |
| `pnpm build` | build all packages |
| `pnpm --filter @beautyspa/api db:deploy` | apply migrations to `DATABASE_URL` |
| `pnpm --filter @beautyspa/api test:int` | integration tests against `DATABASE_URL_TEST` and `REDIS_URL_TEST` |
| `pnpm --filter @beautyspa/api secrets:gen` | add missing local secrets to `.env` (prints key names only) |
| `pnpm --filter @beautyspa/api db:drift` | fail if `schema.prisma` and migrations differ |
| `pnpm --filter @beautyspa/api create-owner --email <e> [--locale en\|es]` | create or reset the OWNER and print a 72 h invite link |

API and database details: [apps/api/README.md](../../apps/api/README.md).

## Web

`apps/web` is a Next.js (App Router) site with `next-intl` (`/en`, `/es`) and Tailwind. UI strings live in
`packages/i18n` (`en.ts` and `es.ts` must have the same keys; the parity test and `es: Messages` enforce it).
`pnpm dev` starts it on port 3000 next to the API (the scripts load the repo-root `.env`). Env keys (see `.env.example`):

| Key | Used by |
|---|---|
| `API_URL` | server-side calls to the API (`http://localhost:3001`) |
| `NEXT_PUBLIC_API_URL` | browser calls to the API |
| `NEXT_PUBLIC_SITE_URL` | public site origin (links, metadata) |

Nothing is prerendered at build, so `pnpm build` works with the API down. Public pages and the header render on first visit and are then revalidated every 60 s (ISR); if the API is unreachable the header shows no name and a page error shows `error.tsx` with a retry button. `pnpm dev` needs the API running.

Single app: `pnpm --filter @beautyspa/web dev|build|test|test:e2e`. `test:e2e` runs the Playwright smoke tests against
the API and a seeded test database; see [apps/web/e2e/README.md](../../apps/web/e2e/README.md). Colors are Tailwind theme tokens in
`apps/web/src/app/globals.css` (`plum`, `ink`, `cream`, ...); `components.json` is the shadcn config.

## CI

`.github/workflows/ci.yml` runs on pushes to `main` and on pull requests:

- `checks`: install with `--frozen-lockfile`, then `format:check`, lint, typecheck, unit tests, build.
- `integration`: Postgres 16 and Redis 7 services, creates `beautyspa_test`, builds the API,
  `db:deploy`, `test:int`, `db:drift`.
- `e2e`: Postgres and Redis services, `.env` from `.env.example` plus `secrets:gen`, Chromium via
  `playwright install --with-deps`, then `pnpm --filter @beautyspa/web test:e2e` (migrates and seeds the test
  database, builds the API and web, starts both, runs the specs). The Playwright report is uploaded on failure.
