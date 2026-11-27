# Handoff

Updated: 2026-11-27 (plan 07a final-review fix wave done; merge pending)

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
- Plan 05 — notifications — merged (PR #7; two independent final reviews, fix round F1–F11, follow-ups F6a–F6d and R1–R6, all re-reviewed):
  - Channels: email (Resend; `console` in dev) with `.ics` invite (REQUEST/CANCEL), web push (VAPID; `console` in dev). SMS/WhatsApp stay pluggable for later.
  - BullMQ queues and a separate `worker` process (`pnpm dev:worker`): hold sweep (moved from the API), reminder scan, `send` / `deliver` jobs with `notification_log` rows (idempotent per appointment, key, channel, `manage_version`).
  - Signed manage links (`/[locale]/manage/<token>`): view, confirm, cancel, add to calendar; any version bump invalidates old links.
  - Push subscriptions, PWA manifest, push-only service worker, opt-in toggle; consent grant catches up missed confirmations.
- Plan 07a — staff panel, reception — implemented on branch `feat/mvp-07a-staff-reception` (two final reviews and their fix wave done; merge pending): staff login with password + TOTP/recovery/enrollment, invite and reset pages, day agenda (polling, timezone-correct cards, check in / complete / no-show / move / cancel, 409 "changed" handling), quick booking with client search/create and "same as last time", walk-in, clients list and detail with private notes, role guard, `noindex`. 7 API additions: `GET /staff/me`; `GET /staff/booking-catalog` (with popular services); agenda extension (employees with working ranges, referenced services and resources); `reachable` (agenda customers and `StaffCustomer`) and search `lastVisit`; customer detail and appointments reads (`GET /staff/customers/:id`, `/:id/appointments`); availability `override=true` with per-slot `outsideHours`; staff-only private notes (`GET`/`PUT /staff/customers/:id/notes`, encrypted). Playwright `staff.spec.ts` (owner books, checks in, completes; employee sees only her column) with the test-only fixture `apps/api/scripts/e2e-staff.ts` (refuses unless `NODE_ENV=test`; run by `e2e/prepare.sh`).
- Plan 07a final-review fix wave (F1–F11, `.superpowers/sdd/07a-staff-reception/final-fix-findings.md`): override availability keeps the normal plan at normal starts (no off-duty "Any" pick → 409 loop); `StaffCustomer.reachable` drives the quick-booking footer (push counts); `CustomerSummary.deleted` hides an anonymized customer's phone and client link; EMPLOYEE search gets `lastVisit: null`; staff login: wrong-password copy, "Sign-in timed out" + Start over for an expired `mfaToken`, enrollment load error retry; customer notice says staff sign-in signs the client out; agenda sheet closes for good when its appointment leaves the agenda and on a date change (notice cleared); agenda 403 → staff login with `customer=1`; staff login `next` keeps the query string; new-client email consent tick disabled until an email is typed.
- Frontend mockups approved: https://claude.ai/artifact/3zfpH45c9UxwhiMPDWGjNi (base for plans 06/07).

## Next

1. Plan 07a: all reviews passed (two independent final reviews + fix wave re-review); push, PR and merge. Remaining 07a minors are listed under "Carried into later plans".
2. Then plan 07b (owner admin: catalog, employees, hours, time off, closures, settings); write/verify its plan first. Carried items are listed below under "Plan 07".
3. Then plan 08. For PRs use `gh api` REST for edit/merge (`gh pr edit/merge` fail on a GraphQL deprecation).
4. CI `e2e` job passed on GitHub for the first time (PR #7, 2026-11-25).
5. Local note: chaining lint+typecheck+build+test+test:int in one shell once got the int run SIGKILLed (exit 137, likely memory); run `pnpm test:int` on its own.

## Owner decisions (2026-11-21)

- Plan order: 06 before 05.
- Plan 05 notification channels: **email (Resend) + `.ics` calendar invite + web push (PWA)**. SMS (Twilio, Sole Proprietor A2P 10DLC) and the WhatsApp Business API wait until the business is incorporated; keep channels pluggable.
- Design calls are decided by Claude and recorded in the plan/ledger; the owner does not review them one by one.

## Owner decisions (2026-11-27)

- Plan 07 split: **07a reception** (spec `docs/superpowers/specs/2026-11-27-staff-reception-design/`), then **07b owner admin**.
- IP retention: on account deletion clear `refresh_token.ip` and `user_agent` of that customer; keep `audit_log.ip` for 90 days only (scheduled purge). Implement in plan 08 (release hardening).
- Domain: owner buys `bellacita.app` (Cloudflare Registrar); Resend sending domain and `EMAIL_FROM=BellaCita <citas@bellacita.app>` follow.

## Owner to-dos (pending)

- Plan 05 before deploy: verify a sending domain in Resend and set `EMAIL_FROM` (`EMAIL_PROVIDER=resend`); run `secrets:gen` for `MANAGE_LINK_SECRET` and the VAPID pair, set `VAPID_SUBJECT` and `PUSH_PROVIDER=webpush`; the deploy must run the `worker` process next to the API; Resend free tier limits (100 emails/day, 3,000/month) cap volume.

- Twilio (2026-11-21): Verify service created (SMS + RCS, landline validation, geo permissions US only); credentials in the root `.env`, dev keeps `OTP_PROVIDER=console`. Real test passed: start → SMS delivered, verify → 200. The account can only send to verified caller IDs for now (error 21608).
- Twilio (2026-11-22): account upgraded out of trial (API: `type: Full`, `status: active`, checked 2026-11-23).
- Twilio (2026-11-23): test with an unverified US number failed: Verify start → HTTP 403 (API maps it to 503). Trust Hub shows **no compliance profile** ("Unlock Trust Hub with a compliance profile"), so the 2026-11-22 submission did not land. Then (2026-11-23) the owner created the Primary Compliance Profile "beauty spa app" (Individual): **Approved**. Retest (2026-11-25) with an unverified US number: SMS delivered. Verify works for any US number.
- No IRS EIN yet (business not incorporated): anything that needs an EIN (A2P 10DLC brand, WhatsApp Business API, business-type Twilio profiles) waits. Choose individual / sole-proprietor options where offered.
- Before deploy: Twilio's **Primary Compliance Profile** must be approved; without it Verify only sends to verified caller IDs (error 21608). A2P registration is not needed for Verify. Done: `OTP_CHANNELS` (default `sms`) skips the WhatsApp attempt; set `whatsapp,sms` once WhatsApp is enabled on the Verify service.

## Carried into later plans

- Plan 07a leftover: the enroll step's "Back to sign in" link is a no-op on `/staff/login` (use an `onBack` that calls `startOver`; "Try again" works).

- Plan 06 (web): `api-client` with `createCookieTokenStore()` and `refreshLock: (fn) => navigator.locks.request("bs-refresh", fn)`; decide whether one browser may hold a customer and a staff session (both use cookie `bs_refresh`); pages `/[locale]/staff/invite?token=` and `/[locale]/staff/reset?token=`; post-booking consent offer via `PATCH /me { consents }`; the public employees list can include professionals with empty `serviceIds` (decide whether to hide them). Appointment `notes` are customer-visible (R11); a staff-written `cancelReason` is not (customer responses show `null`).
- From plan 07a (to 07b/08): FK index on `customer.private_notes_updated_by`; quick booking "today" is frozen at mount (a page left open past midnight); client detail shows no name for services that are now inactive (add `services` to `StaffCustomerAppointments`); agenda hour ticks assume whole-hour UTC offsets. Ledger minors that can wait (`.superpowers/sdd/07a-staff-reception/deferred-minors.md`), by area: API — popularity counts segments and lacks an id tiebreak, employee `serviceIds` can list inactive services, unbounded `lastVisits` read, missing scoping/edge int tests (popularity, cross-org reachability, time-off override, notes clear-path audit), small JSDoc fixes; web — duplicated customer/service label logic, timeline widened by hidden columns, unused i18n keys, `usePolling` may double-fire on tab return, device-timezone fallback when `locations()` fails, move-sheet date strip, booking-context retry has no busy state, rejected `?date=` still applies `?time=` prefill, password errors under the confirm field, whitespace email enables sign-in; tests — no user-event, fake-timer resets outside `afterEach`, e2e midnight/23:00 edges, flaky "otp resend timing" web test under load.
- Plan 07: show override and `NO_SHOW` rules; deactivating an employee leaves their future appointments (surface them) (staff-only customer notes: endpoint added in plan 07a Task 5); `PATCH /staff/employees/:id { profile }` replaces the whole profile; `api-client` methods for plan 03/04 endpoints.
- Deferred from plan 05 final reviews (ledger in plan 05, "Final review rulings"): D1 two adjacent events can both send at one `manageVersion` (return the version from the write transaction; changes `BookingEvents`); D2 `POST /manage/:token/cancel` validates the body before the rate limit; D4 partial index `notification_log (created_at) WHERE status = 'QUEUED'` for orphan recovery; D5 `deliver` can send a recovered `confirmed`/`reminder` after the appointment started (skip with `too_late`). Test nit: manual BullMQ `Worker` in `orphans`/`reminders` int tests leaves its passed-in Redis connection open.
- Plan 05 R1–R6 re-review test nits (non-blocking): order tests for push drop before logout/delete don't prove the `await` (mock records on call; record after a tick); `push.test.ts` `vi.restoreAllMocks()` and `page.test.tsx` `dropImpl` reset belong in `afterEach`/`beforeEach`; R5 once-per-session tested with one endpoint only.
- Open: availability by date range (one `date` per call today).
- Before first production deploy: never leave zero active OWNERs (lock the org's OWNER rows, 409 on zero); access tokens stay valid up to 15 min after revocation; `TRUST_PROXY=1` behind Railway/Fly; `EMAIL_PROVIDER=resend`.
- Deferred nits from plan 06 final re-review (non-blocking): `cancel-sheet.tsx` `unmounting` ref never reset, so under React strict mode (dev only) the native dialog `onClose` sync never fires — reset it at the start of the effect and ignore close events when the dialog is open again; `profile-form.tsx` `languageTouched` not reset after save (cosmetic). Header quiet `ensure()` costs one refresh request (401) per anonymous page load. Customer `Appointment` contract has no `cancelledBy`; web hides system cancel codes.
- Deferred minors from plan 04 reviews (non-blocking): `/me/appointments` loads all rows then slices (no SQL limit); export reads are not one snapshot; `revokedAt`/consent `changedAt` don't come from `Clock`; customer search runs one consent query per result (≤ 20); `ReplacePlanTarget` carries the org id twice; RBAC `tokenFor` matches by literal path; unit-test output has a stack trace from an existing e2e test; test gaps: sweeper timer lifecycle, walk-in where local date ≠ UTC date, 50-row past cap, 20-row search cap, concurrent double-book of one hold, multi-service reschedule reorder.
- Deferred minors from plans 02–03 (non-blocking): Redis client has no `error` listener; `secrets.ts` ignores `export KEY=`; `base32Decode` accepts impossible lengths; `Encryptor` has no AAD and one key id; forgot-password/login timing differences; logout racing refresh can log a false `auth.refresh_reuse`; `RateLimitService.peek` unused; CLI boot failure prints a stack; duplicated range helpers in contracts; `TimezoneSchema` case; `mapUnique` labels any unique violation as email; redundant queries in plan 03 services; eslint platform rule misses subpath imports; Postgres healthcheck `-h localhost`; mailpit image unpinned; no `engines.node`; `check-drift.sh` compares raw URLs; RFC 7807 titles from enum names; no availability test fails if the lower-bound prune in `plan.ts` is disabled.

## Open questions

- None.
