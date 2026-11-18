# Security, privacy, quality

## Security

- OWASP Top 10 baseline; `helmet` headers; strict CORS allowlist (web origin
  only); Zod validation on every input; Prisma parameterized queries only.
- Rate limiting (`RateLimitService`, Redis keys `rl:<scope>:<sha256 prefix of
  phone/email/IP>`, 429 `RATE_LIMITED`). Rate limiting is an in-house Redis
  fixed-window limiter instead of @nestjs/throttler: the limits are per
  phone/email as well as per IP, which the throttler's single tracker does not
  model.
  - OTP start: 3 per phone per 10 min, 10 per IP per hour; Twilio Verify fraud
    guard on; block premium/international ranges outside US by default.
  - OTP verify: 5 attempts per code.
  - Holds: 10 per IP per 10 min.
  - Staff login: 5 per email per 15 min, then lockout window.
- Twilio webhooks verify the `X-Twilio-Signature`.
- Secrets only in env vars (`.env` gitignored, `.env.example` committed with
  placeholders); `pnpm --filter @beautyspa/api secrets:gen` generates local
  secrets (Ed25519 JWT key, 32-byte encryption key) into `.env`, printing key
  names only. Config errors name the invalid keys, never their values.
- Audit log for every appointment create/move/cancel/status change, customer
  edits, catalog/staff/settings changes, and logins.

## Privacy

- Explicit, unticked consent per channel; history kept in
  `notification_consent`; inbound STOP/BAJA revokes WhatsApp/SMS.
- `GET /me/export` (JSON) and `DELETE /me` (anonymize name/phone/email/notes,
  keep appointment rows for the salon's records with the customer detached).
- Sensitive fields encrypted at the application level (see data-model.md).
- NY SHIELD Act: reasonable safeguards; breach-notification runbook noted in
  docs (phase 2).

## i18n and accessibility

- next-intl, locales `en` and `es`; all UI strings in catalogs, none hard-coded;
  dates/currency via `Intl` with the location timezone.
- WCAG AA: contrast, focus states, labels, 44 px touch targets, keyboard
  navigation on staff desktop views.

## Testing (TDD)

| Level | Tool | Scope |
|---|---|---|
| Unit | Vitest | `availability`, `datetime`, contracts, auth token logic, channel router |
| Integration | Vitest + real Postgres/Redis (docker compose in CI) | API modules, exclusion constraints, concurrent booking race (two parallel holds → one 409), token rotation and reuse detection |
| E2E | Playwright (mobile viewport) | online booking with fake OTP/WhatsApp providers; reception quick booking; walk-in; cancel via manage link; EN/ES switch |
| Perf/PWA | Lighthouse CI | mobile performance ≥ 90, PWA installable |

Dev/test use `ConsoleProvider` and a fake Verify (code `000000` only when
`NODE_ENV=test`).

## Infra and delivery

- Local: `docker compose up` (Postgres 16, Redis 7, Mailpit); `pnpm dev` runs
  web, api, worker. Seeds: one organization + location, categories, ~15
  services (nails, hair, brows) with EN/ES names, 4 employees on 2 levels, 3
  pedicure chairs, sample customers and appointments.
- Target hosting (created only after the owner approves): Vercel (web),
  Railway or Fly.io (api + worker), Neon (Postgres), managed Redis.
- GitHub Actions: lint, type-check, unit, integration, e2e, Lighthouse on PRs.
- Sentry on web and api. Structured JSON logs.
- README with local setup.
