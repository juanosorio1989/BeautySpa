# Data, config and testing

## Migration

- `notification_channel` + `PUSH`.
- `appointment.times_set_at timestamptz not null` (backfill `created_at`).
- `notification_log.manage_version int not null` and a unique index on
  `(appointment_id, template_key, manage_version, channel)`.
- `push_subscription` table (see push.md).
- `audit` action `appointment.confirm` (string, no schema change).

## Env

| Key | Default | Notes |
|---|---|---|
| `MANAGE_LINK_SECRET` | — (required) | 32 random bytes base64, added by `secrets:gen` |
| `PUSH_PROVIDER` | `console` | `webpush` required in production; `fake` test only |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | — | required when `webpush`; `secrets:gen` generates the pair |
| `VAPID_SUBJECT` | — | required when `webpush` (`mailto:…`) |
| `REMINDER_SCAN_INTERVAL_MS` | `60000` | 0 = not scheduled (tests) |
| `DELIVERY_RECOVERY_INTERVAL_MS` | `600000` | orphaned `QUEUED` rows; 0 = not scheduled (tests) |
| `HOLD_SWEEP_INTERVAL_MS` | `60000` | now read by the worker |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | — | **(call)** not used; web fetches `/push/public-key` |

`.env.example` gets every key without values for secrets.

## Contracts

`packages/contracts`: `ManageView`, `ManageCancelInput`,
`PushSubscriptionInput`, `PushPublicKey`, `NotificationChannel` with `PUSH`.
`api-client`: `manage.get/confirm/cancel`, `calendarUrl(token)`,
`push.publicKey/subscribe/unsubscribe`.

## Testing

- Unit: token sign/verify (tamper, expiry, version), `.ics` output (golden
  files, folding, escaping, CANCEL), templates per locale (no staff reason,
  escaping), router channel selection, error-code sanitizing, reminder due
  predicate at edges (exactly 24 h, booked 23 h 59 m before, worker late).
- Integration (Postgres + Redis): book → confirmation log row + fake mailer
  capture with `.ics`; same event twice → one row; reschedule → changed + new
  reminders, old version skipped; staff cancel → cancelled `.ics` CANCEL;
  consent revoked between `send` and `deliver` → `SKIPPED`; manage endpoints
  (valid, stale after reschedule, expired, wrong signature all 404; cancel
  window; confirm idempotent); push subscribe/unsubscribe consent rows; push
  410 deletes subscription; hold sweep job keeps the advisory lock; deleted
  customer gets nothing.
- Web: unit tests for the manage page states and the push toggle; Playwright
  smoke: the e2e seeds an appointment, mints a token with the shared secret in
  the test process (no test-only endpoint), opens the manage page and cancels.

## Docs to update in the same branch

Parent spec `api.md` (manage, push endpoints), `architecture.md` (worker,
queues, providers), `flows.md` (no messages for walk-ins, reminder rules),
`data-model.md`, plans README, `docs/handoff.md`, `.env.example`, dev README
(how to run the worker, Mailpit).
