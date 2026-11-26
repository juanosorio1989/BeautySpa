# Plan 05 — Notifications — Design

Status: approved by owner 2026-11-22 · Parent spec:
[`2026-11-17-mvp-design`](../2026-11-17-mvp-design/README.md)

## Intent

Clients who book should hear back without calling the salon: a confirmation,
reminders before the visit (fewer no-shows), and a message when the salon or
the client changes or cancels. Every message carries a link to confirm or
cancel without logging in. SMS and WhatsApp need an incorporated business
(A2P 10DLC / Meta), so the MVP ships **email (Resend) with a calendar invite
(`.ics`) and web push**, and keeps channels pluggable (owner decision
2026-11-21).

## Goals

1. Messages for `appointment.confirmed`, `appointment.reminder_24h`,
   `appointment.reminder_2h`, `appointment.changed`, `appointment.cancelled`,
   in the customer's locale (EN/ES), on every channel the customer consented to.
2. Email with an `.ics` invite that adds, updates and removes the calendar
   event.
3. Web push (VAPID) from a minimal PWA (manifest + push-only service worker),
   so iPhone users can get push after "Add to Home Screen".
4. Signed manage links: API `GET/POST /manage/:token…` and the web page
   `/[locale]/manage/[token]`.
5. BullMQ queues `notifications` and `maintenance` in a separate `worker`
   process; the hold sweeper moves there.

## Non-goals

- SMS, WhatsApp, the Twilio inbound webhook (STOP/BAJA): later, once the
  business is incorporated. The enum values stay; no provider is wired.
- Staff "no messages" badge and staff notification screens (plan 07).
- Offline pages and caching in the service worker (plan 08).
- Delivery/open tracking webhooks from Resend (status stays `SENT`).
- Marketing messages of any kind.

## Anti-goals

- A message sent without consent, or twice for the same event.
- A notification failure that fails or slows a booking request.
- A reminder for a time that no longer applies (cancelled or moved).
- A manage link that reveals whether an appointment exists when the token is
  wrong, or keeps working after cancel/reschedule.
- Phone numbers or emails in `notification_log.error` or logs.

## Constraints

- No EIN: only providers usable by an individual (Resend, web push) are wired.
- Booking writes already call `BookingEvents` after commit through
  `notifyAfterCommit`; plan 05 binds a real adapter there. Only booking-rule
  change: a reschedule/move clears `confirmed_by_customer_at` and sets a new
  `times_set_at` (reminders.md).
- Every booking write keeps taking `lockOrgBookings`, also from the worker.
- Times come from the injectable `Clock`.
- English code/docs; message texts EN/ES.

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **1 (chosen)** | Events enqueue a `send` job; the job re-reads the appointment at send time and fans out one `deliver` job per channel. Reminders come from a scan every minute (repeatable `maintenance` job) that finds due reminders. A unique key in `notification_log` makes every send idempotent. | No per-appointment delayed jobs to cancel or move; survives Redis data loss (state is in Postgres); one extra query per minute. |
| 2 | One delayed BullMQ job per reminder, removed/re-added on change and cancel | Exact timing, but jobs must be kept in sync with every write path; losing Redis loses reminders. |
| 3 | No queue: send inline after commit, `setInterval` for reminders | Fewer moving parts, but provider latency and retries land in the API process; contradicts the parent spec's worker design. |

Push in plan 05 rather than 08 (owner approved 2026-11-22): it needs a manifest
and service worker, so a minimal push-only one ships now; plan 08 extends it.

## Pages

- [Events, router and queues](notifications.md)
- [Reminders](reminders.md)
- [Manage link](manage-link.md)
- [Email and `.ics`](email-ics.md)
- [Web push](push.md)
- [Data, config and testing](data-config-testing.md)

Calls marked **(call)** are Claude's, recorded here per the owner's rule that
design calls are decided by Claude.
