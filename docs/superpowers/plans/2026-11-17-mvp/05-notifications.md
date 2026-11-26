# Plan 05 — Notifications

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clients get a confirmation, 24 h and 2 h reminders, and change/cancel messages by email (with an `.ics` invite) and web push, each with a signed link to confirm or cancel without logging in.

**Architecture:** `BookingEvents` gets a BullMQ adapter that enqueues `send` jobs; a new `worker` process (Nest application context) re-reads the appointment, routes to consented channels, writes one idempotent `notification_log` row per channel and delivers through pluggable providers. A repeatable `maintenance` job scans for due reminders every minute and runs the hold sweep (moved out of the API). Manage links are stateless HMAC tokens served by new `/manage/*` endpoints and a web page; push uses VAPID with a minimal manifest and a push-only service worker.

**Tech Stack:** NestJS 11, Prisma 6, BullMQ 5 (`bullmq`), `web-push` 3, Zod 3, Next.js + next-intl, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-22-notifications-design/` (all pages); parent `docs/superpowers/specs/2026-11-17-mvp-design/` (`flows.md` Notifications, `api.md` Manage link).

**Branch:** `feat/mvp-05-notifications`

## Routing

Main session: Opus 5.5 (orchestrates, does not implement normal tasks).

| Task | What | Implementer | Reviewer | Why |
|---|---|---|---|---|
| 1 | Schema migration, contracts `PUSH`, `times_set_at`, confirm reset on move | **implementer-opus** | reviewer-opus | schema/migration + booking writes |
| 2 | Env keys, `secrets:gen`, manage-link token | **implementer-opus** | reviewer-opus | secrets |
| 3 | `.ics` generator and message templates (EN/ES) | implementer-sonnet | reviewer-opus | pure functions, outputs fixed |
| 4 | Mailer: html, attachments, message id | implementer-sonnet | reviewer-opus | small interface change |
| 5 | Queues, worker entrypoint, hold sweep job, `QueueBookingEvents` | **implementer-opus** | reviewer-opus | production writes (hold release) + new process |
| 6 | Pipeline: `send` / `deliver`, router, email provider, log rows | **implementer-opus** | reviewer-opus | production data, idempotency |
| 7 | Reminder scan | implementer-sonnet | reviewer-opus | predicate fully specified |
| 8 | Manage API (view, confirm, cancel, calendar) | **implementer-opus** | reviewer-opus | booking write, public token auth |
| 9 | Push API + provider + consent-grant catch-up | **implementer-opus** | reviewer-opus | consent evidence, deletion |
| 10 | `api-client` + web manage page | implementer-sonnet | reviewer-opus | screens specified |
| 11 | Web push: manifest, service worker, toggle | implementer-sonnet | reviewer-opus | screens specified |
| 12 | E2E smoke, dev scripts, docs, plan index, handoff | implementer-sonnet | reviewer-opus | test + config + docs |

Production-data branch (tasks 1, 5, 6, 8, 9): **two independent final branch reviews** (`reviewer-opus`, fresh context each, no shared conclusions).

## Global Constraints

- Everything from plans 01–04/06 still holds: strict TS, problem+json `{ code }` errors, an auth decorator on every handler, `orgId` on every query, time only from `Clock`, docs in the same commit, English code/docs.
- Every booking write takes `lockOrgBookings` first (also in the worker) and runs with `BOOKING_TX_OPTIONS`.
- A notification failure never fails or changes an HTTP response (`notifyAfterCommit` stays the only call site).
- Never log or store a phone, email or provider response body in `notification_log.error` or logs: error codes only (`resend_<status>`, `resend_timeout`, `push_<status>`, `push_none`, `render_failed`, `unknown`), max 200 chars.
- Template keys exactly: `appointment.confirmed`, `appointment.reminder_24h`, `appointment.reminder_2h`, `appointment.changed`, `appointment.cancelled`.
- Channels sent in this plan: `EMAIL`, `PUSH`. `SMS`/`WHATSAPP` stay in enums, are never selected.
- Message texts in EN and ES; dates with `Intl.DateTimeFormat` in the location `timezone`, locales `en-US` / `es-US`.
- `packages/*` stay platform-agnostic (no DOM/Node/Nest imports).
- Each task ends green: `pnpm format:check && pnpm turbo run lint typecheck test build`; API tasks also `pnpm --filter @beautyspa/api test:int`.

## Review Focus

1. Customer reschedules twice quickly: jobs for versions 1 and 2 both run; only version 2 sends `appointment.changed` — Task 6 test `stale manageVersion sends nothing`.
2. Booking made 23 h 59 m before the start gets no 24 h reminder; one made exactly 24 h before gets it — Task 7 tests `reminder due predicate edges`.
3. A manage link from before a reschedule, a tampered link and an expired link all answer the same 404 — Task 8 test `stale, tampered and expired tokens are indistinguishable`.
4. Client opts into email on the success page after booking: the confirmation still arrives exactly once — Task 9 test `consent grant after booking sends one confirmation`.
5. A customer name with `<script>` or `&` renders escaped in HTML email and `.ics` text is escaped (`,` `;` `\` newlines) — Task 3 tests `html escapes customer strings` and `ics escapes text`.

---

### Task 1: Schema migration, contracts `PUSH`, `times_set_at`, confirm reset

**Files:**
- Modify: `apps/api/prisma/schema.prisma`; Create: `apps/api/prisma/migrations/<timestamp>_notifications/migration.sql`
- Modify: `packages/contracts/src/customer.ts` (+ test), `apps/api/src/customers/consents.ts`, `apps/api/src/customers/me.service.ts` (`ALL_REVOKED`)
- Modify: `apps/api/src/booking/appointments.service.ts`, `staff-appointments.service.ts`, `my-appointments.service.ts`, `walk-in.service.ts`
- Test: `apps/api/test/integration/booking/times-set-at.int.test.ts`, `apps/api/test/integration/schema-integrity.int.test.ts`

**Interfaces:**
- Produces: Prisma `NotificationChannel.PUSH`; `Appointment.timesSetAt: Date`; `NotificationLog.manageVersion: number` with unique `(appointmentId, templateKey, manageVersion, channel)` named `notification_log_dedupe`; model `PushSubscription { id, organizationId, customerId, endpoint @unique, p256dh, auth, createdAt, lastSuccessAt? }` (`push_subscription`, `onDelete: Cascade` from customer is **not** used — rows are deleted explicitly); contracts `ChannelSchema = z.enum(["WHATSAPP","SMS","EMAIL","PUSH"])`, `ConsentsSchema` gains `PUSH: z.boolean()`.

- [ ] **Step 1: Failing tests.** `times-set-at.int.test.ts` (pin `Clock`): `book sets timesSetAt to now`; `staff create and walk-in set timesSetAt`; `customer reschedule sets timesSetAt and clears confirmedByCustomerAt`; `staff move sets timesSetAt and clears confirmedByCustomerAt`; `cancel keeps timesSetAt and confirmedByCustomerAt`. Schema test: `notification_log_dedupe rejects a duplicate row` (two inserts with the same 4 keys → unique violation `P2002`). Contracts test: `ConsentsSchema requires PUSH`.
- [ ] **Step 2:** Run `pnpm --filter @beautyspa/api test:int -- times-set-at schema-integrity` → FAIL.
- [ ] **Step 3: Migration.** `ALTER TYPE notification_channel ADD VALUE 'PUSH'`; `appointment.times_set_at timestamptz(3)` added nullable, `UPDATE appointment SET times_set_at = created_at`, then `NOT NULL`; `notification_log.manage_version int NOT NULL DEFAULT 0` + unique index; `push_subscription` table with FKs to organization and customer (`ON DELETE RESTRICT`), index on `customer_id`. Generate with `prisma migrate dev --create-only`, edit the SQL, check `pnpm --filter @beautyspa/api db:drift` passes.
- [ ] **Step 4: Code.** Write paths set `timesSetAt: new Date(now)` where they set status (`BOOKED` on confirm, staff create, walk-in) and, together with `manageVersion: { increment: 1 }` on reschedule/move, also `confirmedByCustomerAt: null`. `CHANNELS` in `consents.ts` and `currentConsents` default gain `PUSH`; `ALL_REVOKED` gains `PUSH: false`. Fix every `Consents` literal the compiler flags (web included: profile form shows only EMAIL; PUSH is passed through untouched).
- [ ] **Step 5:** Tests + full green command → PASS. Update `docs/superpowers/specs/2026-11-17-mvp-design/data-model.md` (new column, table, index) and `flows.md` (move clears confirmation).
- [ ] **Step 6: Commit** `feat(api): notification schema, times_set_at, PUSH channel`.

### Task 2: Env keys, `secrets:gen`, manage-link token

**Files:**
- Modify: `apps/api/src/config/env.ts`, `apps/api/test/env.test.ts`, `apps/api/test/support/test-env.ts`, `apps/api/scripts/secrets.ts`, `apps/api/test/secrets.test.ts`, `.env.example`, `turbo.json` (`passThroughEnv` for dev: new keys)
- Create: `apps/api/src/notifications/manage-token.ts`, `manage-token.test.ts`

**Interfaces:**
- Produces: `Env` keys `MANAGE_LINK_SECRET: string` (base64, decodes to ≥ 32 bytes, required), `PUSH_PROVIDER: "console" | "webpush" | "fake"` (default `console`; `fake` only in test; production requires `webpush`), `VAPID_PUBLIC_KEY?`, `VAPID_PRIVATE_KEY?`, `VAPID_SUBJECT?` (all three required when `webpush`; subject must start with `mailto:` or `https:`), `REMINDER_SCAN_INTERVAL_MS: number` (default 60000, ≥ 0).
- Produces in `manage-token.ts`:
  - `interface ManageClaims { appointmentId: string; manageVersion: number; exp: number }` (`exp` epoch seconds)
  - `signManageToken(secret: string, claims: ManageClaims): string` — `base64url(JSON {a,v,e}) + "." + base64url(HMAC-SHA256(key, payloadPart))`, key = base64-decoded secret.
  - `verifyManageToken(secret: string, token: string, nowMs: number): ManageClaims | null` — null on bad shape, bad JSON, wrong types, signature mismatch (`timingSafeEqual`, length checked first), or `nowMs >= exp * 1000`.
  - `manageUrl(webOrigin: string, locale: string, token: string): string` → `${webOrigin}/${locale}/manage/${token}`.

- [ ] **Step 1: Failing tests** in `manage-token.test.ts`: `round trips claims`; `rejects a flipped payload byte`; `rejects a flipped signature byte`; `rejects another secret`; `rejects at exp exactly` (`nowMs = exp*1000` → null; `exp*1000 - 1` → claims); `rejects garbage` (`""`, `"a"`, `"a.b.c"`, non-JSON payload, `v` as string). `env.test.ts`: `requires MANAGE_LINK_SECRET`; `rejects a short MANAGE_LINK_SECRET`; `webpush requires VAPID keys`; `production requires PUSH_PROVIDER=webpush`; `fake push only in test`. `secrets.test.ts`: `generates MANAGE_LINK_SECRET and a VAPID pair` (public key base64url 65 bytes uncompressed P-256 point, private 32 bytes).
- [ ] **Step 2:** `pnpm --filter @beautyspa/api test -- manage-token env secrets` → FAIL.
- [ ] **Step 3: Implement.** VAPID pair in `defaultGenerators()` with `node:crypto` `generateKeyPairSync("ec", { namedCurve: "prime256v1" })`, exported as JWK, `x`/`y`/`d` → raw public `0x04||x||y` base64url and private `d` base64url (both generated by one closure call so they match: generate on `VAPID_PUBLIC_KEY`, cache for `VAPID_PRIVATE_KEY`). `test-env.ts` passes a throwaway `MANAGE_LINK_SECRET` and `PUSH_PROVIDER: "fake"`. `.env.example` lists every new key, secrets empty.
- [ ] **Step 4:** Tests + green command → PASS.
- [ ] **Step 5: Commit** `feat(api): manage-link token and notification env`.

### Task 3: `.ics` generator and message templates

**Files:**
- Create: `apps/api/src/notifications/ics.ts`, `ics.test.ts`, `apps/api/src/notifications/templates/{types.ts,render.ts,en.ts,es.ts,render.test.ts}`

**Interfaces:**
- Produces `ics.ts`:
  - `interface IcsEvent { uid: string; sequence: number; dtstamp: Date; start: Date; end: Date; summary: string; location: string; description: string; url: string; status: "CONFIRMED" | "CANCELLED" }`
  - `buildIcs(event: IcsEvent, opts: { method: "REQUEST" | "CANCEL" | "PUBLISH"; organizerEmail?: string; attendeeEmail?: string }): string`
- Produces `templates/types.ts`:
  - `type TemplateKey = "appointment.confirmed" | "appointment.reminder_24h" | "appointment.reminder_2h" | "appointment.changed" | "appointment.cancelled"`
  - `interface MessageContext { locale: "en" | "es"; customerName: string | null; salonName: string; salonPhone: string | null; locationName: string; address: string; timezone: string; start: Date; end: Date; services: { name: string; employeeName: string }[]; manageUrl: string; bookUrl: string; confirmed: boolean }`
  - `interface RenderedMessage { subject: string; text: string; html: string; push: { title: string; body: string; url: string } }`
- Produces `render.ts`: `renderMessage(key: TemplateKey, ctx: MessageContext): RenderedMessage`; `escapeHtml(s: string): string`.

- [ ] **Step 1: Failing tests.** `ics.test.ts`: `REQUEST golden file` (compare to inline expected string: `BEGIN:VCALENDAR`, `VERSION:2.0`, `PRODID:-//BeautySpa//Booking//EN`, `METHOD:REQUEST`, `UID:appointment-<id>@beautyspa`, `SEQUENCE:2`, `DTSTART:20261201T150000Z`, `ORGANIZER:mailto:…`, `ATTENDEE;RSVP=FALSE:mailto:…`, `STATUS:CONFIRMED`, CRLF line ends, ends with `END:VCALENDAR\r\n`); `CANCEL has STATUS:CANCELLED and METHOD:CANCEL`; `PUBLISH has no ORGANIZER or ATTENDEE`; `ics escapes text` (`a,b;c\d` + newline → `a\,b\;c\\d\n`); `folds lines over 75 octets` (no line > 75 octets incl. multibyte `ñ`, continuation lines start with one space). `render.test.ts`: for each key × locale, subject non-empty and text contains the formatted local time (`2026-12-01T15:00Z` in `America/New_York`, en → `10:00 AM`), service and employee names and `manageUrl`; `cancelled links to bookUrl, not manageUrl`; `reminder_2h asks to confirm only when not confirmed`; `html escapes customer strings` (`customerName: "<b>&"` → html contains `&lt;b&gt;&amp;`, not `<b>`); `push body under 120 chars`; `null customer name uses a neutral greeting`.
- [ ] **Step 2:** `pnpm --filter @beautyspa/api test -- ics render` → FAIL.
- [ ] **Step 3: Implement.** `.ics`: per spec `email-ics.md`; `DESCRIPTION` = description + `\n` + url. Templates: texts per key in `en.ts`/`es.ts` as functions of `ctx`; one shared HTML shell (table, inline styles, plum `#7A2E5A` button for the manage link, no images). Copy is yours to write within: greeting, what happened, when, what/who, where, link line ("Confirm or cancel: …" / "Book again: …"), salon phone line when present.
- [ ] **Step 4:** Tests + green command → PASS.
- [ ] **Step 5: Commit** `feat(api): ics generator and notification templates`.

### Task 4: Mailer html, attachments and message id

**Files:**
- Modify: `apps/api/src/mail/{mailer.ts,resend.mailer.ts,console.mailer.ts,resend.mailer.test.ts}`; callers in `apps/api/src/auth/staff/staff-links.service.ts` only if types require.

**Interfaces:**
- Produces: `interface MailAttachment { filename: string; content: string; contentType: string }`; `MailMessage { to; subject; text; html?: string; attachments?: MailAttachment[] }`; `Mailer.send(msg): Promise<{ id?: string }>`. Resend body adds `html` and `attachments: [{ filename, content: base64(utf8 content), content_type }]`; returns `{ id }` from the JSON response (missing → `{}`).

- [ ] **Step 1: Failing tests** in `resend.mailer.test.ts`: `sends html and base64 attachments`; `returns the message id`; `missing id returns empty`; existing error tests keep passing (`Resend send failed: 429` never includes the body). Console mailer: `logs subject and attachment names, never the body`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run + green command → PASS.
- [ ] **Step 5: Commit** `feat(api): mailer html, attachments and message id`.

### Task 5: Queues, worker entrypoint, hold sweep job, `QueueBookingEvents`

**Files:**
- Modify: `apps/api/package.json` (dep `bullmq@^5`; scripts `worker:dev`: `dotenv -e ../../.env -- nest start --watch --entryFile worker`, `worker:start`: `dotenv -e ../../.env -- node dist/worker.js`), `apps/api/src/booking/{booking.module.ts,hold-sweeper.ts,hold-sweeper.test.ts,booking-events.ts}`
- Create: `apps/api/src/queue/{queue.module.ts,queue-names.ts}`, `apps/api/src/notifications/{queue-booking-events.ts,notifications.module.ts}`, `apps/api/src/worker/{worker.module.ts,maintenance.processor.ts}`, `apps/api/src/worker.ts`
- Test: `apps/api/test/integration/notifications/queue-events.int.test.ts`, `apps/api/test/integration/worker/maintenance.int.test.ts`

**Interfaces:**
- Produces `queue-names.ts`: `NOTIFICATIONS_QUEUE = "notifications"`, `MAINTENANCE_QUEUE = "maintenance"`; `interface SendJob { appointmentId: string; templateKey: TemplateKey; manageVersion: number; channels?: ("EMAIL" | "PUSH")[] }`; `interface DeliverJob { logId: string }`; `sendJobId(j: SendJob, suffix?: string): string` → `send|<id>|<key>|<v>` (+ `|<suffix>`; BullMQ 5 rejects `:` in custom ids); default job options: `send` attempts 3 backoff exponential 10 000 ms; `deliver` attempts 5 backoff exponential 30 000 ms; `removeOnComplete: { age: 86400 }`, `removeOnFail: { age: 604800 }`.
- Produces `queue.module.ts` (global): providers `NOTIFICATIONS_QUEUE_TOKEN` and `MAINTENANCE_QUEUE_TOKEN` (`Queue` instances on a dedicated ioredis connection from `REDIS_URL` with `maxRetriesPerRequest: null`), closed on shutdown.
- Produces `QueueBookingEvents extends BookingEvents` (in `NotificationsModule`, bound in `BookingModule` instead of `LoggingBookingEvents`, which stays for unit tests): each method reads `{ manageVersion, source, customerId }` of the appointment; skips when `source = WALK_IN` or `customerId` null; adds `send` with `templateKey` `appointment.confirmed` / `.changed` / `.cancelled` and job id `sendJobId(...)`.
- Produces `HoldSweeper` without timer (`sweep(): Promise<number>` unchanged, `OnApplicationBootstrap` removed) and `MaintenanceProcessor` in the worker: BullMQ `Worker` on `maintenance` handling `sweep-holds` → `HoldSweeper.sweep()` and `scan-reminders` → `ReminderScanner.scan()` (Task 7; until then a stub that returns 0). On start it calls `queue.upsertJobScheduler("sweep-holds", { every: HOLD_SWEEP_INTERVAL_MS })` when > 0 (and `removeJobScheduler` when 0), same for `scan-reminders` with `REMINDER_SCAN_INTERVAL_MS`.
- Produces `worker.ts`: `NestFactory.createApplicationContext(WorkerModule)`, `enableShutdownHooks()`. `WorkerModule` imports Config, Prisma, Redis, Common, Audit, Mail, Queue, and the notification processors (Task 6).

- [ ] **Step 1: Failing tests.** `queue-events.int.test.ts`: `online booking enqueues send for appointment.confirmed with the current manageVersion` (inspect `queue.getJob(id)`); `reschedule enqueues appointment.changed at version 1`; `staff cancel enqueues appointment.cancelled`; `walk-in enqueues nothing`; `a queue failure does not fail the booking` (override the queue token with one whose `add` rejects → 201). `maintenance.int.test.ts`: `sweep-holds job releases expired holds under the org lock` (run the processor handler with a fake job; asserts released hold + audit row); `scheduler registered at worker start with the configured interval` (`getJobSchedulers()`); `interval 0 removes the scheduler`. `hold-sweeper.test.ts`: drop timer tests, keep sweep tests.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** as in Interfaces. Update `architecture.md` (worker process, queues, sweeper moved).
- [ ] **Step 4:** tests + green command → PASS; manual: `pnpm --filter @beautyspa/api worker:dev` starts and logs both schedulers.
- [ ] **Step 5: Commit** `feat(api): bullmq queues, worker process, hold sweep job`.

### Task 6: Pipeline — `send`, router, `deliver`, email provider

**Files:**
- Create: `apps/api/src/notifications/{message-context.service.ts,router.ts,router.test.ts,providers/channel-provider.ts,providers/email.provider.ts,providers/fake-push.provider.ts,error-code.ts,error-code.test.ts,notifications.processor.ts}`
- Modify: `apps/api/src/worker/worker.module.ts`, `apps/api/src/notifications/notifications.module.ts`
- Test: `apps/api/test/integration/notifications/pipeline.int.test.ts`

**Interfaces:**
- Consumes: `SendJob`, `DeliverJob` (Task 5), `renderMessage` (Task 3), `buildIcs`, `signManageToken`, `manageUrl` (Task 2), `Mailer` (Task 4), `currentConsents` (Task 1).
- Produces:
  - `interface ChannelProvider { readonly channel: "EMAIL" | "PUSH"; readonly name: string; send(msg: RenderedMessage, target: DeliveryTarget): Promise<{ providerMessageId?: string }> }` with `interface DeliveryTarget { customerId: string; email: string | null; templateKey: TemplateKey; ics?: { content: string; method: "REQUEST" | "CANCEL" } }`; token `CHANNEL_PROVIDERS` (array).
  - `EmailProvider` (name `resend` or `console` from `EMAIL_PROVIDER`): sends subject/text/html; attaches `appointment.ics` (`text/calendar; method=<METHOD>`) when `target.ics`.
  - `errorCode(err: unknown): string` — maps `Resend send failed: <n>` → `resend_<n>`, `…timeout` → `resend_timeout`, `PushError(status)` → `push_<status>`, `PushError(none)` → `push_none`, else `unknown`; never returns input text otherwise; max 200 chars.
  - `selectChannels(consents: Consents, reach: { email: boolean; push: boolean }, only?: ("EMAIL"|"PUSH")[]): ("EMAIL"|"PUSH")[]` (pure).
  - `MessageContextService.load(appointmentId: string, nowMs: number): Promise<LoadedAppointment | null>` returning status, manageVersion, source, customer (`id, email, locale, deletedAt, name`), first start / last customer-facing end, services in segment order with employee display names, location (name, address one line, phone, timezone), org name; and `toContext(a, manageUrl, bookUrl): MessageContext`. `bookUrl` = `${WEB_ORIGIN}/${locale}/book`.
  - `NotificationsProcessor` (worker): `handleSend(job: SendJob): Promise<void>`, `handleDeliver(job: DeliverJob, attemptsMade: number, maxAttempts: number): Promise<void>`; a BullMQ `Worker` on `notifications` dispatching by job name.

`handleSend` rules (spec `notifications.md` Flow): stop silently when the appointment is missing, `manageVersion` ≠ job, customer null/deleted, or status does not fit (`BOOKED` for confirmed/changed/reminders, `CANCELLED` for cancelled). Channels = `selectChannels(...)` (`push` reach = at least one `push_subscription`). Per channel `createMany` … `skipDuplicates` is not enough to learn which row is new: insert one row at a time catching `P2002` (skip). Each new row: `status QUEUED`, `provider` = provider name, `locale`, `manageVersion`, `customerId`, `appointmentId`, `templateKey`; then `deliver` job id `deliver|<logId>`.

`handleDeliver` rules: load row; status `SENT`/`SKIPPED`/`FAILED` → return. Re-check consent for the row's channel → revoked → `SKIPPED`. Re-load appointment; version changed or status unfit → `SKIPPED` with error `stale`. Render (failure → `FAILED`, `render_failed`, no retry). `.ics` for EMAIL: confirmed/changed → `REQUEST`, cancelled → `CANCEL` (sequence = manageVersion, organizer = address part of `EMAIL_FROM`), reminders none. Manage token `exp` = first start in seconds. Success → `SENT`, `sentAt`, `providerMessageId`, `attempts + 1`. Error → `attempts + 1`, `error = errorCode(err)`, status `FAILED` when `attemptsMade + 1 >= maxAttempts` else stays `QUEUED`; rethrow.

- [ ] **Step 1: Failing tests.** `router.test.ts`: `selects consented reachable channels`; `email consent without email skips EMAIL`; `only restricts channels`; `never selects SMS or WHATSAPP`. `error-code.test.ts`: cases above incl. `an Error whose message contains an email maps to unknown`. `pipeline.int.test.ts` (fake mailer capturing via `MAILER` override, fake push provider recording calls, `Clock` pinned, call processor methods directly): `confirmed email carries REQUEST ics and manage link`; `same send twice writes one row and one email`; `stale manageVersion sends nothing`; `cancelled email carries CANCEL ics with higher SEQUENCE`; `no consent writes no row`; `consent revoked between send and deliver marks SKIPPED`; `provider error retries then FAILED with resend_500` (attemptsMade 4 of 5); `push consented with subscription delivers on PUSH too`; `deleted customer gets nothing`; `staff cancelReason never appears in the email`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** tests + green command → PASS; manual with Mailpit: `EMAIL_PROVIDER` console prints; document in dev README that Mailpit is unused until SMTP (Resend only).
- [ ] **Step 5: Commit** `feat(api): notification send/deliver pipeline with email`.

### Task 7: Reminder scan

**Files:**
- Create: `apps/api/src/notifications/{reminder-due.ts,reminder-due.test.ts,reminder-scanner.ts}`
- Modify: `apps/api/src/worker/maintenance.processor.ts` (replace stub)
- Test: `apps/api/test/integration/notifications/reminders.int.test.ts`

**Interfaces:**
- Produces `reminder-due.ts`: `REMINDERS = [{ key: "appointment.reminder_24h", offsetMs: 86_400_000, lateMs: 7_200_000 }, { key: "appointment.reminder_2h", offsetMs: 7_200_000, lateMs: 0 }] as const`; `isReminderDue(r, a: { startsAt: Date; timesSetAt: Date }, nowMs: number): boolean` = `start - offset <= now && start - offset >= timesSetAt && now < start - late`.
- Produces `ReminderScanner.scan(): Promise<number>` — for each reminder one SQL query (Prisma `$queryRaw`) selecting up to 500 appointments: `status = 'BOOKED'`, `customer_id IS NOT NULL`, `source <> 'WALK_IN'`, first-segment start (`min(starts_at)` of segments) satisfying the predicate, and `NOT EXISTS` a `notification_log` row with same appointment, key and `manage_version`; ordered by start ascending. Enqueues `send` with `sendJobId`. Returns the count enqueued.

- [ ] **Step 1: Failing tests.** `reminder-due.test.ts` `reminder due predicate edges`: start S; 24 h: `now = S-24h, timesSetAt = S-24h` → true; `timesSetAt = S-24h+1min` → false; `now = S-2h` → false; `now = S-2h-1ms` → true; 2 h: `now = S` → false. `reminders.int.test.ts`: `scan enqueues due 24h reminder once` (scan twice → one job); `rescheduled appointment gets reminders for the new version only`; `cancelled appointment gets none`; `already logged reminder is not re-enqueued`; `walk-in gets none`; `2h reminder not sent after the start`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** tests + green → PASS. Update `flows.md` reminder rules (late limits, walk-ins excluded).
- [ ] **Step 5: Commit** `feat(api): reminder scan`.

### Task 8: Manage API

**Files:**
- Create: `apps/api/src/manage/{manage.module.ts,manage.controller.ts,manage.service.ts}`, `packages/contracts/src/manage.ts` (+ test, export from index)
- Modify: `apps/api/src/booking/my-appointments.service.ts` (extract cancel core), `apps/api/src/app.module.ts`
- Test: `apps/api/test/integration/manage/manage.int.test.ts`, `apps/api/test/integration/rbac-matrix.int.test.ts` (public entries)

**Interfaces:**
- Produces contracts: `ManageViewSchema = z.object({ appointment: AppointmentSchema, location: z.object({ name, addressLine: z.string(), phone: z.string().nullable(), timezone }), canCancel: z.boolean(), canConfirm: z.boolean() })`; `ManageCancelInputSchema = CancelInputSchema`.
- Produces in booking: `cancelByCustomer(tx, deps: { audit: AuditService; now: Date }, args: { orgId: string; customerId: string; appointmentId: string; reason: string | null; ip: string | null }): Promise<AppointmentRow>` (exported from `my-appointments.service.ts` or a new `customer-cancel.ts`), used by both `MyAppointmentsService.cancel` and manage cancel; same errors (`OUTSIDE_CANCEL_WINDOW`, `CONFLICT`), same audit `appointment.cancel` with actor CUSTOMER.
- Produces endpoints (all `@Public()`, rate limit `manage:ip:<ip>` 30 per 60 s, headers `Cache-Control: no-store`, `Referrer-Policy: no-referrer`): `GET /v1/manage/:token` → `ManageView`; `POST /v1/manage/:token/confirm` → `ManageView` (sets `confirmedByCustomerAt` when null, audit `appointment.confirm` only when it changed; not `BOOKED` → 409 `CONFLICT`); `POST /v1/manage/:token/cancel` `{ reason? }` → `ManageView`, then `events.cancelled` via `notifyAfterCommit`; `GET /v1/manage/:token/calendar.ics` → `text/calendar; charset=utf-8`, `Content-Disposition: attachment; filename="appointment.ics"`, `METHOD:PUBLISH`.
- Token check `ManageService.resolve(token)`: `verifyManageToken` + appointment in org + same `manageVersion` + customer present and not deleted + status ≠ `HELD`; any failure → `NotFoundException({ code: "NOT_FOUND" })`. `canCancel` uses the same window function as the customer cancel.

- [ ] **Step 1: Failing tests.** `manage.int.test.ts`: `view returns appointment, location and flags`; `stale, tampered and expired tokens are indistinguishable` (same status, body); `confirm sets confirmedByCustomerAt once and audits once`; `confirm on cancelled is 409`; `cancel inside window cancels, bumps manageVersion and enqueues appointment.cancelled`; `old token 404 after cancel`; `cancel outside window is 409 OUTSIDE_CANCEL_WINDOW`; `calendar.ics is PUBLISH with no-store`; `deleted customer token is 404`; `rate limit 31st request is 429`; `staff cancelReason is null in the view`. `my-appointments` cancel tests still pass unchanged.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement; update `api.md` Manage link section. **Step 4:** tests + green → PASS.
- [ ] **Step 5: Commit** `feat(api): manage link endpoints`.

### Task 9: Push API, provider, consent-grant catch-up

**Files:**
- Create: `apps/api/src/push/{push.module.ts,push.controller.ts,push.service.ts}`, `apps/api/src/notifications/providers/web-push.provider.ts` (+ unit test), `apps/api/src/notifications/consent-catch-up.ts`, `packages/contracts/src/push.ts` (+ test)
- Modify: `apps/api/package.json` (dep `web-push@^3`, dev `@types/web-push`), `apps/api/src/customers/me.service.ts` (patch → catch-up; remove → delete subscriptions), `notifications.module.ts` / `worker.module.ts` provider binding by `PUSH_PROVIDER`
- Test: `apps/api/test/integration/push/push.int.test.ts`, `apps/api/test/integration/notifications/catch-up.int.test.ts`

**Interfaces:**
- Produces contracts: `PushSubscriptionInputSchema = z.object({ endpoint: z.string().url().max(2048).startsWith("https://"), keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }), consentSource: z.enum(["PROFILE","BOOKING_FORM"]).optional() })`; `PushUnsubscribeInputSchema = z.object({ endpoint: z.string().url() })`; `PushPublicKeySchema = z.object({ publicKey: z.string() })`.
- Produces endpoints: `GET /v1/push/public-key` (public; `{ publicKey: VAPID_PUBLIC_KEY }` when set, else 404 `NOT_FOUND`); `POST /v1/me/push-subscriptions` (customer) → 204: in one transaction `assertLiveCustomer(lock)`, upsert by `endpoint` (sets `customerId`, `organizationId`, keys), `recordConsents({ PUSH: true }, source)`; audit `customer.update` `fields: ["consents.PUSH"]` only when consent changed; after commit catch-up when changed. `DELETE /v1/me/push-subscriptions` `{ endpoint }` → 204: delete the caller's row (other customers' endpoint → no-op 204); none left → `recordConsents({ PUSH: false }, "PROFILE")`. Rate limit 20 per hour per customer on both.
- Produces `WebPushProvider` (channel `PUSH`, name `webpush`): sends `JSON.stringify(msg.push)` to every subscription of `target.customerId` with `TTL: 86400`, `urgency: "high"` for `appointment.reminder_2h` else `normal`. 404/410 → delete that row. Any success → update `lastSuccessAt`, return. All failed → throw `PushError(lastStatus)`; no subscriptions → `PushError("none")`. `FakePushProvider` (test) records calls; `ConsolePushProvider` logs title only.
- Produces `enqueueConsentCatchUp(deps: { prisma; queue; now: Date }, customerId: string, channel: "EMAIL" | "PUSH", consentRowId: string): Promise<number>` — for the customer's `BOOKED` appointments with first start > now and no `notification_log` row on that channel at the current version for `appointment.confirmed` or `appointment.changed`: add `send` `{ templateKey: "appointment.confirmed", channels: [channel] }` with job id suffix `grant|<channel>|<consentRowId>`. Called after commit by `MeService.patch` for each channel that changed to granted (`recordConsents` must return the new row ids: change its return to `{ channel, id }[]` and adapt callers), and by push subscribe.
- `MeService.remove`: delete the customer's `push_subscription` rows inside the anonymization transaction.

- [ ] **Step 1: Failing tests.** `push.int.test.ts`: `subscribe stores row and grants PUSH once`; `subscribe twice same endpoint keeps one row, one consent row`; `endpoint of another customer moves to caller`; `unsubscribe last row revokes PUSH`; `unsubscribe someone else's endpoint is a no-op`; `non-https endpoint is 400`; `DELETE /me removes subscriptions`. `web-push.provider.test.ts` (mock `web-push.sendNotification`): `410 deletes the subscription and tries the next`; `all fail throws push_<status>`; `no subscriptions throws push_none`; `2h reminder uses urgency high`. `catch-up.int.test.ts`: `consent grant after booking sends one confirmation` (book without consent → `PATCH /me {EMAIL:true, email}` → run send/deliver → one email; patch false then true again → still one email); `catch-up skips appointments already confirmed on that channel`; `catch-up ignores past and cancelled appointments`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement; update `api.md` (push endpoints, `/me` consents incl. PUSH). **Step 4:** tests + green → PASS.
- [ ] **Step 5: Commit** `feat(api): web push subscriptions and consent catch-up`.

### Task 10: `api-client` and web manage page

**Files:**
- Modify: `packages/api-client/src/{resources.ts,resources.test.ts,index.ts}`, `packages/i18n/src/{en.ts,es.ts}`
- Create: `apps/web/src/app/[locale]/manage/[token]/page.tsx` (+ `page.test.tsx`), `apps/web/src/components/manage/manage-view.tsx` (+ test)

**Interfaces:**
- Produces `api-client`: `ManageApi { get(token): Promise<ManageView>; confirm(token): Promise<ManageView>; cancel(token, b?: In<typeof ManageCancelInputSchema>): Promise<ManageView>; calendarUrl(token): string }` (token `encodeURIComponent`-ed, no auth header); `PushApi { publicKey(): Promise<PushPublicKey>; subscribe(b): Promise<void>; unsubscribe(b): Promise<void> }`; both on the client object as `manage` and `push`.
- Page: server `page.tsx` only sets `robots: noindex` metadata and renders client `ManageView` with the token. States (spec `manage-link.md`): loading; invalid (404) → "This link is no longer valid" + link to `/{locale}/me` and nothing else; loaded → summary (reuse `AppointmentSummary` if it fits, else same formatting helpers), Confirm button when `canConfirm` (then "Confirmed" badge), Cancel via the existing `cancel-sheet` pattern when `canCancel`, else for `BOOKED` the `call-salon` component with `location.phone`; "Add to calendar" `<a href={calendarUrl}>`; "Reschedule" → `/{locale}/login?next=/{locale}/me`. Cancelled → status text + "Book again" link. Errors via `useErrorText`.

- [ ] **Step 1: Failing tests.** `resources.test.ts`: `manage.get calls GET /manage/<encoded>`; `calendarUrl encodes the token`; `push.subscribe posts body`. `manage-view.test.tsx`: `shows confirm when canConfirm and confirmed after click`; `shows cancel sheet when canCancel`; `shows call salon when not cancellable`; `invalid link message on 404`; `add to calendar link points at calendarUrl`; `i18n parity` test keeps passing.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** green command → PASS.
- [ ] **Step 5: Commit** `feat(web): manage link page`.

### Task 11: Web push — manifest, service worker, toggle

**Files:**
- Create: `apps/web/public/manifest.webmanifest`, `apps/web/public/sw.js`, `apps/web/public/icons/{icon-192.png,icon-512.png,maskable-512.png,apple-touch-icon.png}` (solid plum `#7A2E5A` placeholders until the owner has a logo, written by `apps/web/scripts/gen-icons.mjs` with `node:zlib` only — a minimal PNG encoder, no new dependency; commit the PNGs and the script), `apps/web/src/lib/push.ts` (+ test), `apps/web/src/components/push-toggle.tsx` (+ test)
- Modify: `apps/web/src/app/[locale]/layout.tsx` (manifest + apple-touch-icon links via `metadata`), `apps/web/src/app/[locale]/book/done/[appointmentId]/page.tsx`, `apps/web/src/components/me/profile-form.tsx` (or profile page), `packages/i18n/src/{en.ts,es.ts}`

**Interfaces:**
- Produces `lib/push.ts`: `type PushSupport = "unsupported" | "needs-install" | "denied" | "available" | "subscribed"`; `getPushSupport(): Promise<PushSupport>` (no `serviceWorker`/`PushManager`/`Notification`, or `api.push.publicKey()` 404 → unsupported; iOS UA without `navigator.standalone` / `display-mode: standalone` → needs-install; `Notification.permission === "denied"` → denied; existing subscription → subscribed); `enablePush(api, consentSource: "PROFILE" | "BOOKING_FORM"): Promise<PushSupport>` (register `/sw.js`, request permission from the tap, subscribe with `applicationServerKey` from `api.push.publicKey()` decoded base64url → `Uint8Array`, `api.push.subscribe`); `disablePush(api): Promise<void>` (unsubscribe browser + API).
- `sw.js`: `push` → `self.registration.showNotification(title, { body, data: { url }, icon: "/icons/icon-192.png" })`; `notificationclick` → close, focus a client whose URL equals `data.url` else `clients.openWindow(data.url)`; only same-origin URLs are opened (else `/`). No fetch handler.
- `PushToggle({ consentSource })`: renders nothing for `unsupported`; hint text for `needs-install`; help text for `denied`; button "Notify me on this device" / "Turn off notifications on this device".
- Manifest: `name` "BeautySpa", `short_name` "BeautySpa", `start_url` "/", `display` "standalone", `theme_color` "#7A2E5A", `background_color` "#FBF8F5", icons 192/512 + maskable.

- [ ] **Step 1: Failing tests.** `push.test.ts` (stub globals): `unsupported without PushManager`; `needs-install on iOS Safari not standalone`; `denied when permission denied`; `enablePush subscribes with decoded key and posts BOOKING_FORM`; `disablePush unsubscribes both`. `push-toggle.test.tsx`: one test per state. A small node test `sw.js opens only same-origin urls` (load the file in a fake `self` with `vm`).
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** green command → PASS; manual in Chrome desktop: enable on `/en/me/profile`, send a test via worker with `PUSH_PROVIDER=webpush` and real VAPID keys → notification shows; click opens manage page.
- [ ] **Step 5: Commit** `feat(web): pwa manifest and web push opt-in`.

### Task 12: E2E smoke, dev scripts, docs, handoff

**Files:**
- Create: `apps/web/e2e/manage.spec.ts`, `apps/web/e2e/manage-token.ts`
- Modify: root `package.json` (script `"dev:worker": "pnpm --filter @beautyspa/api worker:dev"`), `docs/development/README.md` (run `pnpm dev` and `pnpm dev:worker`; VAPID keys from `secrets:gen`; testing push in Chrome), `docs/superpowers/plans/2026-11-17-mvp/README.md` (row 05 → link to this file, status; row 08 notes the push-only service worker exists), `docs/handoff.md`

**Interfaces:**
- Consumes: the booking flow of `booking.spec.ts` (copy its steps in English or extract a shared helper `e2e/book.ts` used by both specs); the done page URL `/en/book/done/<appointmentId>`.
- Produces `e2e/manage-token.ts`: `mintManageToken(appointmentId: string, manageVersion = 0): string` — same format as Task 2 (`node:crypto` HMAC with `process.env.MANAGE_LINK_SECRET`, loaded by the existing `dotenv` in `test:e2e`), `exp` = now + 1 day (the API checks only `exp > now`, so it need not equal the start).

- [ ] **Step 1: Write** `manage.spec.ts` `client confirms then cancels from a manage link`: book through the UI in English on the third day (as `booking.spec.ts` does, so the 24 h window allows cancel), read `appointmentId` from the done URL, open `/en/manage/<mintManageToken(id)>`, see the service name, tap "Confirm I'll be there" → "Confirmed", cancel → "Cancelled"; reload the same URL → "This link is no longer valid" (cancel bumped the version).
- [ ] **Step 2:** `pnpm --filter @beautyspa/web test:e2e` → PASS (no worker needed: the manage page uses only the API; queued jobs stay in Redis unprocessed). CI needs no change (`secrets:gen` fills `MANAGE_LINK_SECRET`).
- [ ] **Step 3: Docs** as listed; handoff: done, next (plan 07), owner to-dos (verify a sending domain in Resend and set `EMAIL_FROM`; `secrets:gen` for VAPID and `MANAGE_LINK_SECRET`; deploy must run the `worker` process next to the API; Resend free tier limits).
- [ ] **Step 4:** full green command + `test:int` → PASS.
- [ ] **Step 5: Commit** `test(web): manage link e2e; docs for notifications`.

## Final review rulings (2026-11-25)

Two independent final reviews (A, B). Fix round F1–F11; deferred items D1–D3.

| Id | Finding | Ruling | Implementer |
|---|---|---|---|
| F1 | Push send has no timeout; a tarpit endpoint fills all notification slots (A, B) | `timeout: 10_000` in web-push options; unit test asserts it | implementer-opus |
| F2 | Push endpoint accepts any https host (blind SSRF) (A, B) | Contract allowlist: `fcm.googleapis.com`, `updates.push.services.mozilla.com`, `*.push.apple.com`, `*.notify.windows.com`, https only, no port, no IP literals; unsubscribe endpoint `.max(2048)` | implementer-opus |
| F3 | Reminder scan: failed/completed `send` job id blocks re-add for its whole window; customers with no channel crowd the 500 batch (A, B) | SQL also requires a sendable channel (EMAIL consent granted and email present, or PUSH consent granted and ≥1 subscription); before adding, if a job with the id exists in state `failed` or `completed`, remove it, then add | implementer-opus |
| F4 | `push_none` retried 5 times (A) | `PushError("none")` → row `SKIPPED`, error `push_none`, no retry | implementer-opus |
| F5 | PUSH consent granted with zero subscriptions (endpoint moved, 404/410 delete) blocks catch-up on a new device (A, B) | On subscribe, when the customer had zero rows before, run the PUSH consent catch-up even if consent did not change (catch-up stays idempotent) | implementer-opus |
| F6 | `QUEUED` row orphaned with no `deliver` job (B) | Maintenance job every 10 min: `QUEUED` rows older than 1 h → if no waiting/active/delayed `deliver|<id>` job, remove any finished one and re-add; rows older than 24 h → `FAILED`, error `orphaned` | implementer-opus |
| F7 | `DELETE /me` awaits each cancelled enqueue in sequence (B) | Run the adds with `Promise.all` | implementer-opus |
| F8 | Service worker not active when `subscribe()` runs (Chrome first tap fails) (B) | Subscribe on `await navigator.serviceWorker.ready`; unit test | implementer-sonnet |
| F9 | Toggle trusts the browser subscription only (A, B) | When the browser already has a subscription, `enablePush`/load path re-POSTs it (idempotent) and the toggle shows "subscribed" only when `me.consents.PUSH` is true | implementer-sonnet |
| F10 | Shared device keeps the previous customer's pushes (manage-link bearer URLs) after logout (B) | Customer logout calls `disablePush()` (best effort, never blocks logout) before signing out | implementer-sonnet |
| F11 | `dev` and `worker:dev` share `dist` with `deleteOutDir` (A, B); spec says `pnpm dev` runs the worker (A) | `worker:dev` builds with `tsconfig.worker.json` (`outDir: dist-worker`), `worker:start` runs `dist-worker/worker.js`; `.gitignore` adds it; fix `notifications.md:89`; dev README and Docker/deploy notes updated | implementer-sonnet |

Deferred (recorded in handoff):
- D1: two adjacent events can both send at one `manageVersion` (version read after commit); needs the version returned from the write transaction → changes `BookingEvents`; plan 07 or later.
- D2: `POST /manage/:token/cancel` validates the body before the rate limit and headers; low impact, no data returned.
- D3: none else.
