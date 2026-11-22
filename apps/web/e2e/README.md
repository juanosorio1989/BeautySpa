# Web e2e smoke tests

Playwright, Chromium only, mobile viewport (Pixel 7). The specs run against the real API and a production
build of the web app:

- `booking.spec.ts`: in `/es`, book Classic manicure + Spa pedicure, sign in with the fake OTP, see Done,
  open My appointments, cancel from the native dialog, see it under past as cancelled.
- `public.spec.ts`: `/en/services` lists the seeded services; Book opens `/en?service=<id>` preselected.

## Environment

`playwright.config.ts` starts both servers (it refuses to reuse running ones):

| Server | Port | Settings |
|---|---|---|
| API (`node apps/api/dist/main.js`) | 3101 | `NODE_ENV=test`, `OTP_PROVIDER=fake` (code `000000`), `DATABASE_URL=$DATABASE_URL_TEST`, `REDIS_URL=$REDIS_URL_TEST`, `WEB_ORIGIN=http://localhost:3100`, `HOLD_SWEEP_INTERVAL_MS=0` |
| Web (`next start`) | 3100 | `API_URL` and `NEXT_PUBLIC_API_URL` = `http://localhost:3101` (inlined at build) |

These are set explicitly, so the root `.env` values (`NODE_ENV=development`, `OTP_PROVIDER=console`) do not leak in.
The dev database is never touched.

## Run locally

```bash
docker compose up -d
pnpm install
pnpm --filter @beautyspa/api secrets:gen   # once, if .env has no keys
pnpm exec playwright install chromium      # once, from apps/web
pnpm --filter @beautyspa/web test:e2e
```

`test:e2e` loads the root `.env` (shell variables win), then `e2e/prepare.sh` migrates and seeds
`DATABASE_URL_TEST`, builds the API and the web app, and Playwright runs the specs. Ports 3100 and 3101 must be free.

Notes:

- The seeded staff work Tuesday to Saturday and the cancel window is 24 h, so the booking test picks the third day
  of the date strip and uses "Next day with times" when it is empty.
- The phone is `+1 718 555 01NN` with a random `NN` per run. The test database keeps customers between runs;
  a repeated number is treated as a returning customer.
- Failure traces are in `apps/web/test-results/` (`pnpm exec playwright show-trace <trace.zip>`).
