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
- Frontend mockups approved: https://claude.ai/artifact/3zfpH45c9UxwhiMPDWGjNi (base for plans 06/07).

## Next

Write plan 03 (catalog, staff, schedules API) in `docs/superpowers/plans/2026-11-17-mvp/`, then execute it subagent-driven.

## Carried into later plans

- Plan 03: DB `CHECK` constraints for hours (`weekday` 0–6; `start < end` or end `00:00` meaning 24:00) on `working_hours`, `location_hours`, `time_off`, `location_closure`. Employee CRUD sends invites through `StaffLinksService.issue` / `POST /staff/employees/:id/invite`. Every new controller needs an auth decorator (the guard denies undecorated routes).
- Plan 03/04: repositories copy `organization_id` from the parent row; map `00:00` end times to the engine's `"24:00"`; `customer.name` may be null.
- Plan 04: move `pgCode` to `src/common` and map `23P01` to `SLOT_TAKEN`; store `blockEnd` from the validated plan; convert engine epoch-ms to ISO at the API edge. `DELETE /me` anonymization must free `customer.phone_e164` (OTP verify refuses a soft-deleted customer with 401).
- Plan 06 (web): use `api-client` with `createCookieTokenStore()` and `refreshLock: (fn) => navigator.locks.request("bs-refresh", fn)` so two tabs never refresh at once (a concurrent refresh is treated as token reuse and logs the user out). Decide whether one browser may hold a customer and a staff session at the same time (both use cookie `bs_refresh`). Pages `/[locale]/staff/invite?token=` and `/[locale]/staff/reset?token=`.
- Before any deploy: set `TRUST_PROXY=1` behind Railway/Fly (never `true`, which is now rejected); `OTP_PROVIDER=twilio`, `EMAIL_PROVIDER=resend`; configure Twilio Geo Permissions / Fraud Guard.
- Deferred minors from plan 02 reviews (non-blocking): Redis client has no `error` listener; `secrets.ts` ignores `export KEY=` forms; `base32Decode` accepts impossible lengths; `Encryptor` has no AAD and one key id (add a key ring when rotating); forgot-password and login audit timing differences; logout racing a refresh can log a false `auth.refresh_reuse`; `RateLimitService.peek` unused; CLI boot failure prints a stack; a few missing tests (listed in the PR description).
- Earlier deferred minors: eslint platform rule misses subpath imports; Postgres healthcheck `-h localhost`; mailpit image unpinned; no `.prettierignore`; no `engines.node`; `check-drift.sh` compares raw URLs; RFC 7807 titles from enum names.

## Open questions

- None.
