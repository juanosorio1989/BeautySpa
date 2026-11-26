# Architecture

## Monorepo (Turborepo + pnpm, TypeScript everywhere)

```
apps/
  web/        Next.js App Router: public site, booking, client area, staff panel, PWA
  api/        NestJS REST API, /v1, OpenAPI; BullMQ workers in the same codebase
  mobile/     reserved — README only (see roadmap.md)
packages/
  contracts/     Zod schemas + inferred types for every request/response
  api-client/    typed fetch client built on contracts; pluggable token storage
  availability/  pure slot engine (no I/O)
  datetime/      timezone/DST helpers (wall time <-> UTC per location)
  i18n/          shared message catalogs (en, es) for UI strings used on web and mobile
  config/        tsconfig, eslint, vitest presets
docker-compose.yml   postgres 16, redis 7, mailpit
```

**Rule:** `packages/*` (except `config`) must not import DOM, Next.js, NestJS,
or Node-only APIs. Enforced by an eslint `no-restricted-imports` rule and by a
CI check that type-checks them with `lib: ["ES2022"]` (no DOM).

## API (NestJS)

Modules: `auth`, `tenancy` (organization, location, settings), `catalog`
(services, levels, resources), `staff` (employees, working hours, time off),
`availability`, `appointments` (holds, booking, status), `customers`,
`notifications`, `audit`, `webhooks`.

- Validation and OpenAPI both come from `packages/contracts` via `nestjs-zod`.
  One source of truth: the same schema validates the request, documents it, and
  types the client.
- Prisma for data access. Range types and exclusion constraints are written in
  raw SQL inside Prisma migrations (see data-model.md).
- Workers **(plan 05)**: BullMQ queues `notifications` and `maintenance` on the
  same Redis DB as `REDIS_URL` (producers share one dedicated ioredis connection
  with `maxRetriesPerRequest: null`; `apps/api/src/queue/`). The API process only
  produces jobs (`Queue`, never a `Worker`): `QueueBookingEvents` adds a `send`
  job per booking event after commit (job id
  `send|<appointmentId>|<templateKey>|<manageVersion>`; BullMQ 5 rejects `:` in
  custom ids). A separate process from the same codebase consumes them:
  `apps/api/src/worker.ts` (`WorkerModule`, a Nest application context, no HTTP),
  run with `pnpm --filter @beautyspa/api worker:dev` (watch) or `worker:start`
  (`dist-worker/worker.js`). `pnpm dev` runs only web and api, so in dev the worker must
  also run, or expired holds are not swept.
- Hold sweeper **(call, plan 04; moved in plan 05)**: `HoldSweeper.sweep()`
  (`apps/api/src/booking/hold-sweeper.ts`) has no timer of its own. At start the
  worker upserts the job scheduler `sweep-holds` on queue `maintenance` every
  `HOLD_SWEEP_INTERVAL_MS` (default 60000; `0` removes the scheduler, and tests
  use 0), and `MaintenanceProcessor` runs `sweep()` for each job; likewise
  `scan-reminders` every `REMINDER_SCAN_INTERVAL_MS`. Each sweep takes the org
  booking lock per organization and writes one `appointment.hold_release`
  audit row per organization that had holds released (`actorType "SYSTEM"`,
  `after: { released: n }`); booking writes that release expired holds write the
  same row (`releaseExpiredHoldsAudited`). An organization whose sweep fails is
  logged and skipped; the others still run.
- Booking writes **(call, plan 04)**: each booking write transaction takes the
  organization's booking lock first (`lockOrgBookings`, a transaction-scoped
  Postgres advisory lock), so writes of one organization are serialized and a
  race ends as a validation failure (409 `SLOT_TAKEN`). The exclusion constraints
  stay the final guard (see data-model.md).
- Booking events **(call, plan 04)**: booking services report `booked`, `changed`
  and `cancelled` through the `BookingEvents` port
  (`apps/api/src/booking/booking-events.ts`), only after the write transaction
  commits and through `notifyAfterCommit`, which logs and swallows errors so a
  notification failure never fails the request. The API binds it to
  `QueueBookingEvents` (plan 05), which adds a notification `send` job through
  `enqueueBounded` (gives up after 2 s with `QUEUE_TIMEOUT`, so Redis being down
  never hangs a response); `LoggingBookingEvents` stays for unit tests.
- Time **(call, plan 04)**: booking code reads the current time only from the
  injectable `Clock` (`CLOCK` token, `{ now(): number }` in epoch ms, default
  `Date.now`, provided by the global `CommonModule`), never `Date.now()`, so
  integration tests pin and advance `now`.
- Tenancy **(call)**: every tenant-owned row has `organization_id`. In the MVP
  the API resolves the organization from config (`DEFAULT_ORG_SLUG`); a request
  scope carries `orgId` and every repository query filters by it. Postgres RLS
  is deferred to the multi-salon phase.
- Location **(call)**: public and staff endpoints accept an optional
  `locationId`; when absent, the API uses the organization's only active
  location (error if it has more than one). The Expo app can pass it later
  without API changes.

## Web (Next.js)

- Routes prefixed by locale: `/en/...`, `/es/...` (next-intl), with `hreflang`.
  Default by `Accept-Language`, then the user's saved locale.
- Public pages (home, services, team, location) are server-rendered from the API
  for SEO. Booking and staff panel are client-heavy.
- **No business logic in web.** Server components and client code only call the
  API through `packages/api-client`.
- Data paths: public reads (services, team, location) happen on the server
  (`apps/web/src/lib/api/server.ts`, `fetch` with `revalidate: 60`, ISR; the layout and
  pages are not prerendered at build, so the build works with the API down). Everything
  per customer (availability, holds, booking, `/me`) runs in the browser through
  `lib/api/browser.ts` (`api-client` with the cookie token store).
- Session: the access token lives in memory; the `bs_refresh` cookie is refreshed on
  load, and concurrent tabs share one refresh through the Web Locks API
  (`navigator.locks`, passed into `api-client` as `refreshLock`; works without it).
  The booking selection and hold live in `sessionStorage` (wrapped, optional).
- `packages/i18n` holds the EN/ES catalogs; `es` is typed as `Messages`, so a missing
  key fails typecheck. Web and a future mobile app share it; it imports no DOM or Next.js.
- E2E smoke tests (Playwright, `apps/web/e2e`) run against the real API with the fake OTP.
- Staff panel at `/[locale]/staff/...`, mobile-first: day agenda, quick
  booking, walk-in, client search. Desktop gets a multi-column calendar of the
  same data.

## Authentication (approach B)

| Who | How |
|---|---|
| Client | Phone + OTP via Twilio Verify, over the channels from `OTP_CHANNELS` (default `sms`). First verification silently creates a `customer`. |
| Staff | Email + password (argon2id) + TOTP 2FA, mandatory for all staff who log in **(call)**. |

Staff lifecycle **(call)**:
- Technicians who never log in: `can_login = false`, no credentials; they still
  have schedules and appointments.
- First OWNER: CLI `pnpm --filter @beautyspa/api create-owner --email <e> [--locale en|es]`
  creates the OWNER, or for an existing OWNER with that email clears password,
  TOTP, recovery codes and sessions; either way it prints a fresh 72 h invite
  link. It refuses an email that belongs to a non-owner.
- OWNER invites staff by email (Resend): single-use link, 72 h, to set a password
  and enroll TOTP. Password reset: same mechanism, 1 h link.
- Lost TOTP device: one of 10 recovery codes issued at enrollment, or the OWNER
  resets another staff member's 2FA (audited). An OWNER without codes is
  recovered with the CLI.

Tokens (identical for web and native):
- **Access token**: JWT, EdDSA (Ed25519), 15 min, `iss: beautyspa-api`,
  `aud: beautyspa`, header `kid`; claims `sub`, `typ` (`customer`/`staff`),
  `org`, `role` (`typ: customer` always has role `CUSTOMER`).
- **Refresh token**: opaque random 256-bit, stored as SHA-256 only, 30 days
  (clients) / 12 h (staff). **Rotates on every use**; each belongs to a
  `family`. Reuse of a rotated token (including two concurrent refreshes with
  the same token) revokes the whole family and is audited as
  `auth.refresh_reuse`. A token revoked by logout is simply refused (401).
- **Refresh lifetime is absolute per login** **(call)**: a rotated token
  inherits `expires_at` from the token it replaces, so refreshing never extends
  a session. Clients re-verify by OTP after 30 days; staff log in again after
  12 h (one shift). A refresh for a soft-deleted customer or a staff user with
  `active = false` or `can_login = false` is refused and revokes all of that
  subject's sessions.
- **Transport** **(call)**:
  - Web: access token in memory; refresh token only in cookie `bs_refresh`
    (`HttpOnly; SameSite=Lax; Path=/v1/auth`, `Secure` per `COOKIE_SECURE`,
    `Domain` per `COOKIE_DOMAIN`), never in the JSON body. Requires web and
    API under the same registrable domain (`app.example.com`,
    `api.example.com`). A refresh whose token came from the cookie always
    answers with a cookie, even if `x-token-transport: body` is sent, and
    CORS does not allow that header, so page script can never read a refresh
    token.
  - Native (future): a request with header `x-token-transport: body` gets the
    refresh token in the JSON body (`refreshToken`) and no cookie; it is
    stored in SecureStore and sent back as `{ refreshToken }`.
  - Cookie-based `/auth/refresh` and `/auth/logout` require header
    `x-beautyspa-csrf: 1` (403 otherwise): a custom header forces a CORS
    preflight, which only `WEB_ORIGIN` passes. A body token needs no CSRF
    header (browsers never send it on their own).
- `api-client` takes a `TokenStore` interface (memory+cookie on web, SecureStore
  on native) and refreshes once on 401.

## Notifications

Plan 05 replaced the original sketch (WhatsApp/SMS router with fallback,
delayed reminder jobs); details in `specs/2026-11-22-notifications-design/`.

```
API: QueueBookingEvents --send job--> queue `notifications` <--deliver job--+
                                        |                                  |
worker: NotificationsProcessor.handleSend (route, log rows) ---------------+
        NotificationsProcessor.handleDeliver (render, provider, update row)
                                        |
                  ChannelProvider: EmailProvider (Mailer) | push provider
```

- Code: `apps/api/src/notifications/` (`notifications.processor.ts`,
  `message-context.service.ts`, `router.ts`, `error-code.ts`, `providers/`,
  `templates/`, `ics.ts`, `manage-token.ts`). `NotificationDeliveryModule`
  (context loading and providers) and `NotificationsProcessor` (a BullMQ
  `Worker` on `notifications`, concurrency 5, started at bootstrap, closed on
  destroy; `maintenance` runs one job at a time) live
  only in `WorkerModule`; the API imports `NotificationsModule` (producer).
- `send` `{ appointmentId, templateKey, manageVersion, channels? }`: re-reads
  the appointment and stops silently (no row) when it is gone, its
  `manage_version` differs, the customer is null or deleted, it is a walk-in, or
  the status does not fit (`BOOKED`; `CANCELLED` for `appointment.cancelled`).
  `selectChannels` (pure) picks every consented channel the customer can
  receive on: `EMAIL` needs an email, `PUSH` a push subscription; never SMS or
  WhatsApp; `channels` limits it (consent catch-up). One `notification_log` row
  per channel, inserted one at a time (`QUEUED`, provider name, locale,
  version); a unique conflict on `(appointment_id, template_key,
  manage_version, channel)` means the channel was handled. A new row, or a
  conflicting row still `QUEUED`, gets a `deliver` job with id
  `deliver|<logId>` (added with `enqueueBounded`), so a retried `send` never
  loses or duplicates a delivery. The appointment (by id) is the root; later
  reads and writes use its organization.
- `deliver` `{ logId }`: only a `QUEUED` row is sent; reads are scoped to the
  row's organization. Skips (`SKIPPED` +
  reason in `error`) when the channel's consent was revoked
  (`consent_revoked`), the appointment changed (`stale`: version, status,
  customer deleted) or an email row has no address (`no_email`). Renders in
  the row's locale and the location timezone; the manage link token expires at
  the first segment start. EMAIL for confirmed/changed attaches
  `appointment.ics` `METHOD:REQUEST`, cancelled `METHOD:CANCEL`
  (`SEQUENCE` = `manage_version`, organizer = address part of `EMAIL_FROM`, or
  `no-reply@<WEB_ORIGIN host>` when unset); reminders carry none. Success →
  `SENT`, `sent_at`, `provider_message_id`, `attempts + 1`. A render failure →
  `FAILED` `render_failed`, no retry. A provider error → `attempts + 1`, error
  code, rethrow for the BullMQ retry; `FAILED` on the last of 5 attempts. Any
  other error before the send (database, Redis) is rethrown and, on the last
  attempt, marks the row `FAILED` first, so no row stays `QUEUED` after BullMQ
  gives up. If recording `SENT` fails after the provider accepted, the worker
  logs `sent_update_failed` and rethrows (not a provider error); the retry can
  send twice (at-least-once).
- Providers (`ChannelProvider { channel; name; send(rendered, target) }`, token
  `CHANNEL_PROVIDERS`): EMAIL = `EmailProvider` over `Mailer`
  (`EMAIL_PROVIDER` `resend` or `console`); PUSH by `PUSH_PROVIDER`: `fake`
  (tests, records calls), `console` (dev, logs the title only), `webpush`
  (`WebPushProvider`: every subscription of the customer, TTL 24 h, urgency
  `high` for the 2 h reminder; 404/410 deletes that subscription; success when
  one send succeeds, else `push_<last status>` (`push_0` = no HTTP response) or
  `push_none`; logs subscription ids, never endpoints).
- Consent catch-up (`notifications/consent-catch-up.ts`): after commit, an
  `EMAIL`/`PUSH` consent that turned granted (`PATCH /me`,
  `POST /me/push-subscriptions`) adds `send` jobs for `appointment.confirmed`
  limited to that channel, job id suffix `grant|<channel>|<consent row id>`;
  bounded and swallowed like `notifyAfterCommit`.
- Error codes in `notification_log.error` (`errorCode`, max 200 chars, built
  only from recognized shapes, never free error text, an email, a phone or a
  provider body): `resend_<status>`, `resend_timeout`, `push_<status>`,
  `push_none`, `render_failed`, `unknown`; skip reasons `stale`,
  `consent_revoked`, `no_email`. Logs carry log ids and codes only.
- Reminders: the worker's `scan-reminders` maintenance job adds `send` jobs.

## PWA

- Web manifest (EN/ES names), icons, `display: standalone`.
- Service worker (Serwist): precache app shell; `NetworkFirst` for
  `GET /v1/me/appointments` and staff `GET /v1/staff/agenda?date=today`, cached
  for offline read-only viewing with an "offline, last updated at" banner.
- No push notifications.
