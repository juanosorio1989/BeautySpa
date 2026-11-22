# Reminders

Rule from flows.md: 24 h and 2 h before the start; skipped if booked (or
moved) less than that before.

## When the current times were set

New column `appointment.times_set_at` (timestamptz, not null; migration
backfills `created_at`) **(call)**. Set to `now` whenever an appointment's
times are fixed: hold confirmed (`POST /appointments`), staff create, walk-in,
customer reschedule, staff move. Without it a reminder scan cannot tell a
booking made 10 h before from one made a week before.

## Scan (`scan-reminders`, every minute)

For each kind `K` with offset `H` (24 h, 2 h):

```
status = BOOKED and customer_id is not null and source <> WALK_IN
and starts_at - H <= now            -- due
and starts_at - H >= times_set_at   -- booked at least H before
and now < starts_at - L(K)          -- not too late
and no notification_log row for (appointment, K, manage_version)
```

`L(24h) = 2 h` and `L(2h) = 0` **(call)**: after worker downtime a 24 h reminder
may still go out late, but never once the 2 h one is due; a 2 h reminder never
goes out after the start. `starts_at` is the first segment's start.

Each match enqueues `send` with the appointment's current `manageVersion`
(same job id scheme, so a scan that runs twice adds nothing). The `send`
handler applies all checks again. Scan batch **(call)**: at most 500 rows per
kind per run, oldest due first; the next minute picks up the rest.

A reschedule bumps `manage_version` and `times_set_at`, so the new time gets
its own reminders when they qualify, and stale jobs for the old version stop at
the version check.

## Confirmation by the client

The manage link's "Confirm" sets `confirmed_by_customer_at` (exists already).
**(call)** Reminders are still sent after confirmation (it is a reminder, not a
request); the 2 h reminder's text drops the "please confirm" line when
confirmed.

**(call, small booking-rule change)** Every write that increments
`manage_version` because of a new plan (customer reschedule, staff
`PATCH /staff/appointments/:id`, whether it changes times, professional or
services) also sets `times_set_at = now` and clears
`confirmed_by_customer_at`: the client confirms the new plan from the new
link. Cancel increments `manage_version` but touches neither.
