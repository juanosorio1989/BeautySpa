# Events, router and queues

## Which events send what

| Trigger (existing code path) | `BookingEvents` call | Template |
|---|---|---|
| `POST /appointments` (online), `POST /staff/appointments` | `booked` | `appointment.confirmed` |
| `POST /me/appointments/:id/reschedule`, `PATCH /staff/appointments/:id` | `changed` | `appointment.changed` |
| customer cancel (app or manage link), staff cancel | `cancelled` | `appointment.cancelled` |
| reminder scan | — | `appointment.reminder_24h`, `appointment.reminder_2h` |

**(call)** No messages for: walk-ins (source `WALK_IN`; the client is
present), status changes other than cancel (check-in, complete, no-show),
expired holds, and cancellations made by `DELETE /me` (the customer is
anonymized and has no channel).

## Consent granted after booking **(call)**

The success page offers email and push after `POST /appointments`, when
`booked` has already run and found no channel. So whenever a customer's
`EMAIL` or `PUSH` consent goes from not granted to granted (`PATCH /me`,
`POST /me/push-subscriptions`, staff customer update), the API enqueues a
catch-up: for each of the customer's `BOOKED` appointments starting in the
future that has no `notification_log` row on that channel at its current
`manage_version` for `appointment.confirmed` or `appointment.changed`, a
`send` job for `appointment.confirmed` limited to that channel (job field
`channels: ["EMAIL"]`, job id suffix `|grant|<channel>|<consent row id>`). The
log unique key still prevents a double send. The offer's wording ("your
confirmation and reminders") stays true.

`POST /me/push-subscriptions` also runs the `PUSH` catch-up when the consent
was already granted but the customer had no subscription before this one
(every device was deleted on 404/410, or the browser moved the endpoint):
without it a new device would never get the confirmations missed meanwhile.
Its job id suffix is `|grant|PUSH|<subscription row id>`.

## Flow

1. The API's `QueueBookingEvents` (replaces `LoggingBookingEvents`) adds a job
   `send` to queue `notifications` with `{ appointmentId, templateKey,
   manageVersion, channels? }`, where `manageVersion` is read right after commit. Job id
   `send|<appointmentId>|<templateKey>|<manageVersion>` (BullMQ drops duplicate
   ids). Enqueue errors are swallowed by `notifyAfterCommit` as today.
2. The worker's `send` handler loads the appointment with customer, segments,
   services, employees and location. It **stops silently** (debug log, no log
   row) when the appointment is gone, `manageVersion` differs from the job's,
   the customer is null or deleted, or the status does not fit the template:
   `BOOKED` for confirmed/changed/reminders, `CANCELLED` for cancelled.
3. The **router** picks channels: every channel whose latest consent row is
   `granted: true` and that the customer can receive on: `EMAIL` needs
   `customer.email`; `PUSH` needs at least one push subscription. **(call)** All
   consented channels, not a fallback chain: push is best-effort (may be
   disabled on the device), email is the record.
4. For each channel it inserts a `notification_log` row (`QUEUED`) under the
   unique key `(appointment_id, template_key, manage_version, channel)`.
   Insert conflict → that channel was already handled; skip it. Then it adds a
   `deliver` job `{ logId }` (job id `deliver|<logId>`; BullMQ 5 rejects `:` in custom job ids).
5. `deliver` renders the template (customer locale, location timezone), sends
   through the channel's provider, and updates the row: `SENT` +
   `providerMessageId` + `sentAt`, or on error `attempts + 1`, `error`, and
   rethrows so BullMQ retries. After the last attempt the row is `FAILED`.
   It re-checks consent first; revoked since → `SKIPPED`. A push send that
   finds no subscription left (`push_none`: all deleted on 404/410 since
   `send`) → `SKIPPED`, error `push_none`, no retry.

Orphaned rows: a `QUEUED` row can lose its `deliver` job (the enqueue after
the insert failed, or Redis lost it). The `recover-deliveries` maintenance job
(every 10 min) takes `QUEUED` rows older than 1 h, oldest first, 500 per run:
older than 24 h → `FAILED`, error `orphaned`; otherwise, when no
`deliver|<logId>` job is waiting, active or delayed, it removes a finished
(`completed`/`failed`) job with that id and adds the `deliver` job again. Re-queuing is at-least-once, like `deliver`
retries: a row left `QUEUED` after the provider accepted the message
(`sent_update_failed` on the last attempt) is sent again.

Retries **(call)**: `deliver` 5 attempts, exponential backoff from 30 s.
`send` 3 attempts, backoff 10 s. Completed jobs removed after 1 day, failed
after 7 days.

## Providers

`ChannelProvider { channel; send(rendered, target): Promise<{ providerMessageId?: string }> }`.

| Channel | Provider (`*_PROVIDER` env) | Dev/test |
|---|---|---|
| EMAIL | existing `Mailer` (`EMAIL_PROVIDER=resend`) extended with `html` and attachments | `ConsoleMailer`; tests use a capturing fake |
| PUSH | `WebPushProvider` (`PUSH_PROVIDER=webpush`) | `console` / `fake` |
| SMS, WHATSAPP | none wired; router never selects them | — |

`notification_log.error` **(call)**: a short code built by the provider
(`resend_429`, `resend_timeout`, `push_410`, `render_failed`…), max 200 chars,
never a provider response body, phone or email.

## Processes

- `apps/api/src/worker.ts`: a Nest application context (no HTTP) with
  `WorkerModule`: Prisma, Redis, Clock, Audit, Mail, notifications, booking
  writer helpers. Scripts `worker:dev` / `worker:start`.
- The API process only produces jobs (`Queue`, no `Worker`).
- Queue `maintenance`, repeatable jobs (upserted at worker start with
  `upsertJobScheduler`): `sweep-holds` every `HOLD_SWEEP_INTERVAL_MS` (0 = not
  scheduled), `scan-reminders` every `REMINDER_SCAN_INTERVAL_MS` (default
  60000), `recover-deliveries` every `DELIVERY_RECOVERY_INTERVAL_MS` (default
  600000 = 10 min). The in-process `HoldSweeper` timer is removed; its `sweep()` logic is
  reused by the job and still takes `lockOrgBookings` per org.
- BullMQ connection from `REDIS_URL` (separate ioredis connections with
  `maxRetriesPerRequest: null` as BullMQ requires).
- Dev: `pnpm dev` runs web and api only; the worker is `pnpm dev:worker` (builds into `dist-worker`, so it never clears the API's `dist`). CI integration tests run
  the handlers directly and through a real worker against the CI Redis.
