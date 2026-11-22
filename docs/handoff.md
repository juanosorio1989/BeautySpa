# Handoff

Updated: 2026-11-21

## Done

- Plan 01 — foundation and availability engine — merged (PR #1).
- Plan 02 — auth — merged: customer phone OTP (Twilio Verify; `console`/`fake` in dev/test), staff password + TOTP + recovery codes, invites/reset, EdDSA access JWT + rotating refresh tokens, fail-closed RBAC guard, rate limiter, audit writer, `api-client`.
- Plan 03 — catalog, staff, schedules API — merged: OWNER CRUD for catalog/employees/schedules/settings, public reads, RBAC matrix, seeds (5 categories, 20 services, 3 chairs + 2 cabins, 5 employees).
- Chore — Prettier repo-wide + `pnpm format:check` in CI (PR #4).
- Plan 04 — booking API — branch `feat/mvp-04-booking` (see "Next" for merge status):
  - `GET /availability` (optional auth: staff token → STAFF mode), anonymous holds `POST /holds`, `POST /appointments` (confirm a hold after OTP), `GET /me/appointments`, customer cancel / reschedule / repeat.
  - Staff: create, move, status changes, walk-in, day agenda, customer search/create with consent records.
  - Customer `/me` profile, export, account deletion (anonymization; phone freed for a new signup).
  - Every booking write serializes per org with a Postgres advisory lock, re-validates the plan in the transaction, and keeps the exclusion constraints as the final guard. In-process hold sweeper (`HOLD_SWEEP_INTERVAL_MS`).
  - `BookingEvents` port (booked/changed/cancelled) is a logging no-op until notifications land.
  - Execution rulings R1–R16 are listed at the end of `docs/superpowers/plans/2026-11-17-mvp/04-booking.md`.
- Frontend mockups approved: https://claude.ai/artifact/3zfpH45c9UxwhiMPDWGjNi (base for plans 06/07).

## Next

1. If plan 04 is not merged yet: push `feat/mvp-04-booking`, open the PR, merge (use `gh api` REST for edit/merge — `gh pr edit/merge` fail on a GraphQL deprecation).
2. **Plan 06 (web: public site and booking) comes before plan 05** (owner decision 2026-11-21, so there is something to see in the browser first). Write it with brainstorming → writing-plans, from the approved mockups. Use `excludeAppointmentId` for reschedule; booking works without notifications.
3. Then plan 05 with the reduced scope below, then 07, 08.

## Owner decisions (2026-11-21)

- Plan order: 06 before 05.
- Plan 05 notification channels: **email (Resend) + `.ics` calendar invite + web push (PWA)**. SMS (Twilio, Sole Proprietor A2P 10DLC) and the WhatsApp Business API wait until the business is incorporated; keep channels pluggable.
- Design calls are decided by Claude and recorded in the plan/ledger; the owner does not review them one by one.

## Owner to-dos (pending)

- Twilio (2026-11-21): Verify service created (SMS + RCS, landline validation, geo permissions US only); credentials in the root `.env`, dev keeps `OTP_PROVIDER=console`. Real test passed: start → SMS delivered (WhatsApp attempt fails 400 first, then falls back to SMS), verify → 200. The account can only send to verified caller IDs for now (error 21608).
- Before deploy: get Twilio's **Primary Compliance Profile** (Trust Hub) approved; without it Verify only sends to verified caller IDs (error 21608). A2P registration is not needed for Verify. Optional: skip the WhatsApp attempt while that channel is off (saves a failed call per login).
- Decide whether IP addresses count as personal data on account deletion: `audit_log.ip`, `refresh_token.ip` and `user_agent` are kept today.

## Carried into later plans

- Plan 05: implement `BookingEvents`; move `HoldSweeper` to the BullMQ `maintenance` queue (the worker must keep taking `lockOrgBookings`); manage links using `manage_version`; `notification_log.error` must never echo the phone.
- Plan 06 (web): `api-client` with `createCookieTokenStore()` and `refreshLock: (fn) => navigator.locks.request("bs-refresh", fn)`; decide whether one browser may hold a customer and a staff session (both use cookie `bs_refresh`); pages `/[locale]/staff/invite?token=` and `/[locale]/staff/reset?token=`; post-booking consent offer via `PATCH /me { consents }`; the public employees list can include professionals with empty `serviceIds` (decide whether to hide them). Appointment `notes`/`cancelReason` are customer-visible (R11).
- Plan 07: show override and `NO_SHOW` rules; deactivating an employee leaves their future appointments (surface them); staff-only customer notes (`private_notes_enc`) have no endpoint yet; `PATCH /staff/employees/:id { profile }` replaces the whole profile; `api-client` methods for plan 03/04 endpoints.
- Open: availability by date range (one `date` per call today).
- Before first production deploy: never leave zero active OWNERs (lock the org's OWNER rows, 409 on zero); access tokens stay valid up to 15 min after revocation; `TRUST_PROXY=1` behind Railway/Fly; `EMAIL_PROVIDER=resend`.
- Deferred minors from plan 04 reviews (non-blocking): `/me/appointments` loads all rows then slices (no SQL limit); export reads are not one snapshot; `revokedAt`/consent `changedAt` don't come from `Clock`; customer search runs one consent query per result (≤ 20); `ReplacePlanTarget` carries the org id twice; RBAC `tokenFor` matches by literal path; unit-test output has a stack trace from an existing e2e test; test gaps: sweeper timer lifecycle, walk-in where local date ≠ UTC date, 50-row past cap, 20-row search cap, concurrent double-book of one hold, multi-service reschedule reorder.
- Deferred minors from plans 02–03 (non-blocking): Redis client has no `error` listener; `secrets.ts` ignores `export KEY=`; `base32Decode` accepts impossible lengths; `Encryptor` has no AAD and one key id; forgot-password/login timing differences; logout racing refresh can log a false `auth.refresh_reuse`; `RateLimitService.peek` unused; CLI boot failure prints a stack; duplicated range helpers in contracts; `TimezoneSchema` case; `mapUnique` labels any unique violation as email; redundant queries in plan 03 services; eslint platform rule misses subpath imports; Postgres healthcheck `-h localhost`; mailpit image unpinned; no `engines.node`; `check-drift.sh` compares raw URLs; RFC 7807 titles from enum names; no availability test fails if the lower-bound prune in `plan.ts` is disabled.

## Open questions

- IP retention on account deletion (see owner to-dos).
