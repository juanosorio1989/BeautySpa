# Build, testing and API additions

## New workspace pieces

- `apps/web`: Next.js (App Router, TypeScript strict), next-intl, Tailwind,
  shadcn/ui components copied in, `next/font`. Port 3000. Scripts `dev`,
  `build`, `start`, `lint`, `typecheck`, `test` (Vitest + Testing Library,
  jsdom), `test:e2e` (Playwright). Env: `API_URL`, `NEXT_PUBLIC_API_URL`,
  `NEXT_PUBLIC_SITE_URL` (in the root `.env.example`, no secrets).
- `packages/i18n`: `en.json`, `es.json` message catalogs plus a typed export;
  no DOM/Next imports (platform rule applies). A unit test fails when the two
  catalogs do not have the same keys.
- `pnpm dev` (turbo) runs API and web together.

## API additions (backend-only tasks, each with contract, integration test and `api.md` update)

1. `GET /public/locations` gains `booking: { bookingHorizonDays,
   cancelWindowHours, holdMinutes }` per location, read from the location
   settings (defaults when unset). Web needs the horizon for the date strip and
   the cancel window to hide Cancel/Change when it is surely too late. The API
   stays the decider for both.
2. `PATCH /me` accepts optional `consentSource: "PROFILE" | "BOOKING_FORM"`
   (default `PROFILE`), used for the consent rows that request writes; sending
   it without `consents` is 400. Consent evidence → Opus task.
3. `DELETE /holds/:holdId` (no auth, like `POST /holds`; the hold id is the
   capability): in one transaction with the org booking lock, a `HELD`
   appointment is released exactly like an expired hold, through the same
   writer in `appointment-writer.ts` (`CANCELLED`, `cancelledBy SYSTEM`, reason
   `HOLD_EXPIRED`, segments stop occupying), so a later `POST /appointments`
   with it answers `HOLD_EXPIRED` as today; audited
   (`appointment.hold_release`, actor `SYSTEM` with `after: { released: 1,
   by: "customer" }`). Already released or expired → 204 (idempotent);
   unknown or another org's → 404; booked → 409 `CONFLICT`. Shares the `POST
   /holds` rate limit. Booking write → Opus task.

## Testing

| Level | Scope |
|---|---|
| Unit (`packages/api-client`) | every new method: path, query encoding (repeated `services=`), body, schema parsing, error mapping |
| Unit (`packages/i18n`) | EN/ES key parity |
| Component (`apps/web`, Vitest) | booking store (persist/restore, prerequisites), phone formatting to E.164, countdown, error-code → message mapping, step components with a mocked client (hold 409 refetches, hold expired returns to step 2, first-time vs returning details) |
| E2E smoke (`apps/web`, Playwright, mobile viewport) | against the real API (`NODE_ENV=test`, `OTP_PROVIDER=fake`, code `000000`) and a seeded test database: book manicure + pedicure in `/es`, see Done, open My appointments, cancel it. Seeded staff work Tuesday to Saturday, so the test uses "Next day with times" instead of a fixed date. Second test: `/en` services page renders and links into booking |

CI: the existing `lint typecheck test build` job covers web unit tests and the
production build. A new `e2e` job (postgres + redis services, like the
integration job) migrates and seeds the test database, starts API and web
(`next start`), installs Chromium only, runs the smoke tests. Full e2e and
Lighthouse remain plan 08.

## Docs to update in the same commits

- `docs/development/README.md`: running web, env vars, e2e.
- Parent spec `architecture.md` (Web section: data paths, session, i18n
  package), `api.md` (public locations), plan index status.
- `docs/handoff.md` at the end.
