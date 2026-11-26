# Handoff

Updated: 2026-11-25

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
- Plan 06 — web public site and booking — merged (branch `feat/mvp-06-web`, two independent final reviews + fix round): next-intl EN/ES, SEO pages, booking flow with holds and OTP (hold countdown from device receipt time + `holdMinutes`; own hold released when returning to step 2), client area (`/me`), header Log out only signs out after the server confirms, staff cancel reasons hidden from customers, `OTP_CHANNELS` (default `sms`), Playwright e2e smoke tests and the CI `e2e` job.
- Plan 05 — notifications — branch `feat/mvp-05-notifications`, Tasks 1–12 implemented and reviewed per task; final branch reviews pending:
  - Channels: email (Resend; `console` in dev) with `.ics` invite (REQUEST/CANCEL), web push (VAPID; `console` in dev). SMS/WhatsApp stay pluggable for later.
  - BullMQ queues and a separate `worker` process (`pnpm dev:worker`): hold sweep (moved from the API), reminder scan, `send` / `deliver` jobs with `notification_log` rows (idempotent per appointment, key, channel, `manage_version`).
  - Signed manage links (`/[locale]/manage/<token>`): view, confirm, cancel, add to calendar; any version bump invalidates old links.
  - Push subscriptions, PWA manifest, push-only service worker, opt-in toggle; consent grant catches up missed confirmations.
- Frontend mockups approved: https://claude.ai/artifact/3zfpH45c9UxwhiMPDWGjNi (base for plans 06/07).

## Next

1. Plan 05: two independent final branch reviews, fix round, push, PR, merge. Then plan 07, 08. For PRs use `gh api` REST for edit/merge (`gh pr edit/merge` fail on a GraphQL deprecation).
2. Watch the first CI run of the `e2e` job on GitHub (never run there before plan 06 merged).

## Owner decisions (2026-11-21)

- Plan order: 06 before 05.
- Plan 05 notification channels: **email (Resend) + `.ics` calendar invite + web push (PWA)**. SMS (Twilio, Sole Proprietor A2P 10DLC) and the WhatsApp Business API wait until the business is incorporated; keep channels pluggable.
- Design calls are decided by Claude and recorded in the plan/ledger; the owner does not review them one by one.

## Owner to-dos (pending)

- Plan 05 before deploy: verify a sending domain in Resend and set `EMAIL_FROM` (`EMAIL_PROVIDER=resend`); run `secrets:gen` for `MANAGE_LINK_SECRET` and the VAPID pair, set `VAPID_SUBJECT` and `PUSH_PROVIDER=webpush`; the deploy must run the `worker` process next to the API; Resend free tier limits (100 emails/day, 3,000/month) cap volume.

- Twilio (2026-11-21): Verify service created (SMS + RCS, landline validation, geo permissions US only); credentials in the root `.env`, dev keeps `OTP_PROVIDER=console`. Real test passed: start → SMS delivered, verify → 200. The account can only send to verified caller IDs for now (error 21608).
- Twilio (2026-11-22): account upgraded out of trial (API: `type: Full`, `status: active`, checked 2026-11-23).
- Twilio (2026-11-23): test with an unverified US number failed: Verify start → HTTP 403 (API maps it to 503). Trust Hub shows **no compliance profile** ("Unlock Trust Hub with a compliance profile"), so the 2026-11-22 submission did not land. Then (2026-11-23) the owner created the Primary Compliance Profile "beauty spa app" (Individual): **Approved**. Retest (2026-11-25) with an unverified US number: SMS delivered. Verify works for any US number.
- No IRS EIN yet (business not incorporated): anything that needs an EIN (A2P 10DLC brand, WhatsApp Business API, business-type Twilio profiles) waits. Choose individual / sole-proprietor options where offered.
- Before deploy: Twilio's **Primary Compliance Profile** must be approved; without it Verify only sends to verified caller IDs (error 21608). A2P registration is not needed for Verify. Done: `OTP_CHANNELS` (default `sms`) skips the WhatsApp attempt; set `whatsapp,sms` once WhatsApp is enabled on the Verify service.
- Decide whether IP addresses count as personal data on account deletion: `audit_log.ip`, `refresh_token.ip` and `user_agent` are kept today.

## Carried into later plans

- Plan 06 (web): `api-client` with `createCookieTokenStore()` and `refreshLock: (fn) => navigator.locks.request("bs-refresh", fn)`; decide whether one browser may hold a customer and a staff session (both use cookie `bs_refresh`); pages `/[locale]/staff/invite?token=` and `/[locale]/staff/reset?token=`; post-booking consent offer via `PATCH /me { consents }`; the public employees list can include professionals with empty `serviceIds` (decide whether to hide them). Appointment `notes` are customer-visible (R11); a staff-written `cancelReason` is not (customer responses show `null`).
- Plan 07: show override and `NO_SHOW` rules; deactivating an employee leaves their future appointments (surface them); staff-only customer notes (`private_notes_enc`) have no endpoint yet; `PATCH /staff/employees/:id { profile }` replaces the whole profile; `api-client` methods for plan 03/04 endpoints.
- Deferred from plan 05 final reviews (ledger in plan 05, "Final review rulings"): D1 two adjacent events can both send at one `manageVersion` (return the version from the write transaction; changes `BookingEvents`); D2 `POST /manage/:token/cancel` validates the body before the rate limit; D4 partial index `notification_log (created_at) WHERE status = 'QUEUED'` for orphan recovery; D5 `deliver` can send a recovered `confirmed`/`reminder` after the appointment started (skip with `too_late`). Test nit: manual BullMQ `Worker` in `orphans`/`reminders` int tests leaves its passed-in Redis connection open.
- Plan 05 R1–R6 re-review test nits (non-blocking): order tests for push drop before logout/delete don't prove the `await` (mock records on call; record after a tick); `push.test.ts` `vi.restoreAllMocks()` and `page.test.tsx` `dropImpl` reset belong in `afterEach`/`beforeEach`; R5 once-per-session tested with one endpoint only.
- Open: availability by date range (one `date` per call today).
- Before first production deploy: never leave zero active OWNERs (lock the org's OWNER rows, 409 on zero); access tokens stay valid up to 15 min after revocation; `TRUST_PROXY=1` behind Railway/Fly; `EMAIL_PROVIDER=resend`.
- Deferred nits from plan 06 final re-review (non-blocking): `cancel-sheet.tsx` `unmounting` ref never reset, so under React strict mode (dev only) the native dialog `onClose` sync never fires — reset it at the start of the effect and ignore close events when the dialog is open again; `profile-form.tsx` `languageTouched` not reset after save (cosmetic). Header quiet `ensure()` costs one refresh request (401) per anonymous page load. Customer `Appointment` contract has no `cancelledBy`; web hides system cancel codes.
- Deferred minors from plan 04 reviews (non-blocking): `/me/appointments` loads all rows then slices (no SQL limit); export reads are not one snapshot; `revokedAt`/consent `changedAt` don't come from `Clock`; customer search runs one consent query per result (≤ 20); `ReplacePlanTarget` carries the org id twice; RBAC `tokenFor` matches by literal path; unit-test output has a stack trace from an existing e2e test; test gaps: sweeper timer lifecycle, walk-in where local date ≠ UTC date, 50-row past cap, 20-row search cap, concurrent double-book of one hold, multi-service reschedule reorder.
- Deferred minors from plans 02–03 (non-blocking): Redis client has no `error` listener; `secrets.ts` ignores `export KEY=`; `base32Decode` accepts impossible lengths; `Encryptor` has no AAD and one key id; forgot-password/login timing differences; logout racing refresh can log a false `auth.refresh_reuse`; `RateLimitService.peek` unused; CLI boot failure prints a stack; duplicated range helpers in contracts; `TimezoneSchema` case; `mapUnique` labels any unique violation as email; redundant queries in plan 03 services; eslint platform rule misses subpath imports; Postgres healthcheck `-h localhost`; mailpit image unpinned; no `engines.node`; `check-drift.sh` compares raw URLs; RFC 7807 titles from enum names; no availability test fails if the lower-bound prune in `plan.ts` is disabled.

## Open questions

- IP retention on account deletion (see owner to-dos).
