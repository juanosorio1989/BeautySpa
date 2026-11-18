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
- Workers: BullMQ queues `notifications` and `maintenance` (hold sweeper). Run as
  a separate process from the same app (`api` and `worker` entrypoints).
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
- Staff panel at `/[locale]/staff/...`, mobile-first: day agenda, quick
  booking, walk-in, client search. Desktop gets a multi-column calendar of the
  same data.

## Authentication (approach B)

| Who | How |
|---|---|
| Client | Phone + OTP via Twilio Verify (channel WhatsApp, fallback SMS). First verification silently creates a `customer`. |
| Staff | Email + password (argon2id) + TOTP 2FA, mandatory for all staff who log in **(call)**. |

Staff lifecycle **(call)**:
- Technicians who never log in: `can_login = false`, no credentials; they still
  have schedules and appointments.
- First OWNER: CLI `pnpm --filter api create-owner` prints a one-time invite link.
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
  `family`. Reuse of a rotated or revoked token (including two concurrent
  refreshes with the same token) revokes the whole family and is audited as
  `auth.refresh_reuse`.
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
    `api.example.com`).
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

```
NotificationService.send(intent)  ->  ChannelRouter  ->  Provider (interface)
                                                         ├─ WhatsAppTwilioProvider
                                                         ├─ SmsTwilioProvider   (flag: SMS_REMINDERS_ENABLED)
                                                         ├─ EmailResendProvider
                                                         └─ ConsoleProvider     (dev/test)
```

- `Provider.send(message) -> { providerMessageId } | error`; status arrives via
  webhook and updates `notification_log`.
- Router order: WhatsApp (if consent) → SMS (if enabled and consent) → email (if
  present and consent). Fall through on send error or `failed` status webhook.
- Twilio is the single vendor for WhatsApp, SMS, and Verify **(call)**: one
  account, one webhook format; Meta Cloud API can be a later provider.
- Templates are code-defined per `{templateKey, locale}` and mapped to
  approved WhatsApp template SIDs via config.
- Scheduled reminders are BullMQ delayed jobs with deterministic `jobId`
  (`appt:{id}:r24`, `appt:{id}:r2`): reschedule = remove + re-add; cancel =
  remove. The job re-reads the appointment before sending and skips if it is no
  longer `booked`.
- Retries: 5 attempts, exponential backoff; final failure logged and falls to
  next channel.

## PWA

- Web manifest (EN/ES names), icons, `display: standalone`.
- Service worker (Serwist): precache app shell; `NetworkFirst` for
  `GET /v1/me/appointments` and staff `GET /v1/staff/agenda?date=today`, cached
  for offline read-only viewing with an "offline, last updated at" banner.
- No push notifications.
