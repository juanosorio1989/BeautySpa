# Flows

## Online booking (client, mobile-first)

```
Services → Professional (per service, or "Any") → Date → Time slots
  → [hold 5 min] → Phone → Code (WhatsApp/SMS) → Name + consent (first time only)
  → Confirm → "You're booked" + WhatsApp confirmation
```

1. Client picks up to 4 services; for each, a professional or "Any".
2. Date strip (next `bookingHorizonDays`) and slot list from `GET /availability`.
3. Tapping a slot calls `POST /holds` → 5-minute countdown shown **(call)**. If
   the hold fails with `SLOT_TAKEN`, refresh slots with a friendly message.
4. Phone entry → `/auth/otp/start`; code entry → `/auth/otp/verify`.
   Returning clients are recognized and skip the name step.
5. First time: name and language. Next to the Confirm button, an unticked,
   clearly visible checkbox "Send me my confirmation and reminders on WhatsApp"
   (owner decision: optional, not required to book). Optional email field +
   checkbox. Returning clients see their saved choice.
   Verifying the phone by OTP is **not** consent to messages.
6. `POST /appointments { holdId }` → booked. Confirmation sent on consented
   channels; reminders scheduled. The success screen always shows the full
   confirmation. If the client gave no WhatsApp consent, it offers once:
   "Want reminders on WhatsApp? [Yes, send them]" → records consent
   (`source = BOOKING_FORM`) and sends the confirmation.
7. If the hold expired meanwhile: `HOLD_EXPIRED` → back to slots.

## Reception quick booking (staff, phone)

```
Agenda (today) → [+] → Find client by phone/name or "New: name + phone"
  → Services → Professional → Time (slots or manual pick from free times) → Save
```

- Goal: a booking in under ~30 seconds and ≤ 6 taps for a returning client.
- New client created by reception: no OTP; reception asks the client and ticks
  WhatsApp consent only if they agree (recorded with `source = RECEPTION` and the
  staff member's id). Meta accepts opt-in collected in person or by phone.
- Confirmation sent to the client like an online booking.

## Walk-in

`[Walk-in]` → client (optional) → services → API returns the first slot
starting now (or within the next slot interval) → booked with
`source = WALK_IN`, status `CHECKED_IN`.

## Day agenda (staff)

Mobile: one column per selected professional, swipe between them; tap an
appointment → check-in / complete / no-show / move / cancel. Desktop: all
professionals side by side, plus a resource view (chairs).

## Notifications

| Event | Template | When |
|---|---|---|
| Booked | `appointment.confirmed` | immediately |
| Reminder | `appointment.reminder_24h` | 24 h before (skipped if booked < 24 h before) |
| Reminder | `appointment.reminder_2h` | 2 h before (skipped if booked < 2 h before) |
| Changed | `appointment.changed` | on move/reschedule (reminders re-scheduled) |
| Cancelled | `appointment.cancelled` | on cancel by salon or client |

All include the manage link (confirm / cancel). Sent in the customer's
`locale`. Channel per the router in architecture.md. A client with no consented
channel gets nothing; reception sees a "no messages" badge on that appointment.

## Cancel / reschedule (client)

- Only the caller's own appointment (another customer's or another
  organization's id is 404, nothing changes), only while `BOOKED` (else 409
  `CONFLICT`), and only while `now <= startsAt - cancelWindowHours` of the
  appointment's location (default 24; equality allowed; `0` means until the
  start) **(call)**, else 409 `OUTSIDE_CANCEL_WINDOW`. After that, the UI shows
  the salon's phone.
- Both run in one transaction that takes the organization's booking lock first
  and locks the appointment row `FOR UPDATE`; `manage_version` increments
  (old manage links stop working); one audit row (`before` = the appointment
  before, `after` = after); the notification event runs after commit.
- Cancel: status `CANCELLED`, `cancelled_by = CUSTOMER`, optional reason,
  segments `occupies = false`, so the time shows again in availability.
- Reschedule **(call)**: availability is requested with
  `excludeAppointmentId`, so the client's own current time does not block the
  new one. The new plan must keep the same services (the same multiset of
  service ids; employees and times may change), else 400 `VALIDATION_FAILED`
  on `segments`. Confirming releases expired holds, re-validates the new plan with
  online rules (own segments excluded), deletes the old segments and inserts the
  new ones on the same appointment (stale `occupies = false` rows would stay
  inside the appointment otherwise; the audit row keeps the old plan in
  `before`). On any failure the whole transaction rolls back (`SLOT_TAKEN` when
  the time was taken) and the old time stays booked. No hold, because the client
  is already authenticated and there is no OTP delay. Staff "move" uses the same
  mechanism. Reminders re-scheduled.
- Repeat (`POST /me/appointments/:id/repeat`, any status, read-only) returns
  `{ locationId, services }` to prefill a new booking: services in segment
  order, inactive ones dropped; the same employee while still active, at the
  location, bookable online and qualified, else `"ANY"`.

## Hold lifecycle

`HELD` (expires in `holdMinutes`) → `BOOKED` on confirm, or released
(`occupies = false`, status `CANCELLED`, reason `HOLD_EXPIRED`) by the booking
transaction or the minute sweeper. Phase 2 payments reuse the same hold.
