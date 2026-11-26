# Web push

## Data

New enum value `NotificationChannel.PUSH`. New table `push_subscription`:
`id`, `organization_id`, `customer_id`, `endpoint` (unique), `p256dh`, `auth`,
`created_at`, `last_success_at?`. Deleted with the customer on `DELETE /me`
(the anonymization transaction deletes the rows).

## API

| Method | Path | Result |
|---|---|---|
| GET | `/push/public-key` | `{ publicKey }` (VAPID, public) |
| POST | `/me/push-subscriptions` | `{ endpoint, keys: { p256dh, auth }, consentSource? }` → 204. The endpoint must be `https://` on a known push service (`fcm.googleapis.com`, `updates.push.services.mozilla.com`, `*.push.apple.com`, `*.notify.windows.com`; no port, no IP literal), else 400: the worker POSTs to it. Upserts by endpoint (moves it to the caller if another customer had it) and records `PUSH granted: true` when the current consent is not already granted (source `PROFILE` default or `BOOKING_FORM`). |
| DELETE | `/me/push-subscriptions` | `{ endpoint }` (max 2048) → 204; removes the caller's row. Last one gone → `PUSH granted: false` (source `PROFILE`). |

`PATCH /me { consents: { PUSH: false } }` keeps rows but stops sends (router
checks consent). `GET /me` reports `PUSH` like `EMAIL`.

## Sending

`web-push` library with `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
`VAPID_SUBJECT` (`mailto:` of the salon). Payload JSON `{ title, body, url }`
(url = manage link), TTL 24 h for reminders/confirmations **(call)**, urgency
`high` for the 2 h reminder, request timeout 10 s (a slow push service never
holds a worker slot; a timeout counts as `push_0`). One `deliver` per channel sends to all the
customer's subscriptions; success when at least one succeeds. 404/410 from the
push service deletes that subscription (error code `push_410`). All failing →
error, retry. No subscription at all (`push_none`) → row `SKIPPED`, no retry.

## Web

- `public/manifest.webmanifest` (name, short name, `start_url: /`, `display:
  standalone`, theme color from the design tokens, 192/512 icons and a
  maskable icon — simple generated placeholders until the owner provides a
  logo) and `<link rel="manifest">` in the root layout, plus
  `apple-touch-icon`.
- `public/sw.js`: only `push` (show the notification) and `notificationclick`
  (focus an open tab on that URL or open it). No fetch handler.
- `lib/push.ts`: feature check, register `/sw.js`, `Notification.requestPermission()`
  from a user tap, `pushManager.subscribe({ userVisibleOnly: true,
  applicationServerKey })`, `POST /me/push-subscriptions`; unsubscribe mirrors it.
- UI **(call)**: a "Notify me on this device" toggle on the booking success
  page (next to the email offer, `consentSource: BOOKING_FORM`) and in profile.
  Hidden when unsupported. iOS Safari outside standalone mode shows a short
  hint: "Add this site to your Home Screen to get notifications". Permission
  denied → explains how to re-enable in browser settings.
