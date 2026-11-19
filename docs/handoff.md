# Handoff

Updated: 2026-11-18

## Done

- Plan 01 — foundation and availability engine — merged to `main` via PR #1.
- Plan 02 — auth — merged to `main` (branch `feat/mvp-02-auth`):
  - Customer phone OTP (Twilio Verify, WhatsApp → SMS fallback; `console`/`fake` providers for dev/test), US NANP numbers only.
  - Staff email + password (argon2id) + mandatory TOTP, 10 recovery codes, race-safe lockout.
  - Invite / password-reset links by email (console or Resend mailer), OWNER invite and reset-2FA endpoints, `create-owner` CLI.
  - EdDSA access JWT (15 min) + opaque rotating refresh tokens (absolute lifetime per login, family revoked on reuse); web uses cookie `bs_refresh`, native uses body transport.
  - Fail-closed RBAC guard (undecorated route → 403), Redis fixed-window rate limiter, audit writer, typed env + `secrets:gen`.
  - `@beautyspa/api-client` with `TokenStore`, single-flight refresh, optional `refreshLock` hook.
- Plan 03 — catalog, staff, schedules API — merged to `main` (branch `feat/mvp-03-catalog-staff`):
  - OWNER CRUD for categories, levels, resource types, resources, services with per-level prices; employees (profile, services, locations, invite, deactivate; role/email/access changes revoke refresh tokens and spend pending invite/reset links); working hours (replace per location) and time off; location settings, hours and closures; audit log read.
  - Public reads `/v1/public/locations|services|employees`; RBAC matrix test over every route; schedule/amount `CHECK` migration; shared helpers (`IdPipe`, `recordStaffAudit`, `assertInstantRange`, wall-time, db-errors, `LocationService`).
  - Business scope widened: the spa also offers facials, massages and body treatments in a limited number of treatment cabins (a resource type like pedicure chairs). Seed: 5 categories, 20 services, 3 chairs + 2 cabins, 5 employees.
- Frontend mockups approved: https://claude.ai/artifact/3zfpH45c9UxwhiMPDWGjNi (base for plans 06/07).

## Next

1. Chore PR: run Prettier across the repo and add `format:check` to lint/CI (formatting only; ~79 files).
2. Write plan 04 (booking API) in `docs/superpowers/plans/2026-11-17-mvp/`, then execute it subagent-driven.

## Carried into later plans

- Plan 04 (from plan 03): build the engine `Context` from `readLocationSettings` (in `locations/settings.service.ts` — import `LocationsModule` or move it to `common/`), `dayHoursFromRows`, and `PublicCatalogService.bookableEmployees` / `listedServices`. These apply ONLINE rules only (`bookableOnline`, `onlineBookable`); reception booking needs its own loader. `bookableEmployees.serviceIds` is unfiltered. Public `durationMin` is the base duration; slots must use the assigned employee's level duration. Closures have no range loader (query `location_closure` directly). A time-off row with null location applies to all locations.
- Plan 06: public employees list can include professionals whose listed `serviceIds` is empty; decide whether to hide them. `PATCH /staff/employees/:id { profile }` replaces the whole profile (send it in full).
- Plan 07: deactivating an employee leaves their future appointments in place — surface them. `api-client` methods for plan 03 endpoints come with plans 06/07.
- Before first production deploy: guard so demoting/deactivating an OWNER never leaves zero active OWNERs (lock the org's OWNER rows, re-read the caller's own row, 409 on zero). Access tokens stay valid up to 15 min after revocation.
- Deferred minors from plan 03 reviews (non-blocking): duplicated range/nonEmpty helpers in contracts; `TimezoneSchema` case; constraint tests pin by name only; `mapUnique` labels any unique violation as email; redundant queries (employee create location count, working-hours PUT, public employees list); a few test-precision gaps (seed weekday skip and snapshot values, audit row asserts).
- Plan 04: map `00:00` end times to the engine's `"24:00"` (use `dayHoursFromRows`); `customer.name` may be null.
- Plan 04: map `23P01` to `SLOT_TAKEN` (`pgCode` now lives in `src/common/db-errors.ts`); store `blockEnd` from the validated plan; convert engine epoch-ms to ISO at the API edge. `DELETE /me` anonymization must free `customer.phone_e164` (OTP verify refuses a soft-deleted customer with 401).
- Plan 06 (web): use `api-client` with `createCookieTokenStore()` and `refreshLock: (fn) => navigator.locks.request("bs-refresh", fn)` so two tabs never refresh at once (a concurrent refresh is treated as token reuse and logs the user out). Decide whether one browser may hold a customer and a staff session at the same time (both use cookie `bs_refresh`). Pages `/[locale]/staff/invite?token=` and `/[locale]/staff/reset?token=`.
- Before any deploy: set `TRUST_PROXY=1` behind Railway/Fly (never `true`, which is now rejected); `OTP_PROVIDER=twilio`, `EMAIL_PROVIDER=resend`; configure Twilio Geo Permissions / Fraud Guard.
- Deferred minors from plan 02 reviews (non-blocking): Redis client has no `error` listener; `secrets.ts` ignores `export KEY=` forms; `base32Decode` accepts impossible lengths; `Encryptor` has no AAD and one key id (add a key ring when rotating); forgot-password and login audit timing differences; logout racing a refresh can log a false `auth.refresh_reuse`; `RateLimitService.peek` unused; CLI boot failure prints a stack; a few missing tests (listed in the PR description).
- Earlier deferred minors: eslint platform rule misses subpath imports; Postgres healthcheck `-h localhost`; mailpit image unpinned; no `.prettierignore`; no `engines.node`; `check-drift.sh` compares raw URLs; RFC 7807 titles from enum names.

## Open questions

- None.
