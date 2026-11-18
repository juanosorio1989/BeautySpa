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

- Allowed until `cancelWindowHours` before start (default 24 **(call)**). After
  that, the UI shows the salon's phone.
- Reschedule **(call)**: availability is requested with
  `excludeAppointmentId`, so the client's own current time does not block the
  new one. Confirming runs one transaction: old segments `occupies = false`,
  new segments inserted on the same appointment, re-validated; on conflict the
  whole transaction rolls back (`SLOT_TAKEN`). No hold, because the client is
  already authenticated and there is no OTP delay. Staff "move" uses the same
  mechanism. `manage_version` increments; reminders re-scheduled.

## Hold lifecycle

`HELD` (expires in `holdMinutes`) → `BOOKED` on confirm, or released
(`occupies = false`, status `CANCELLED`, reason `HOLD_EXPIRED`) by the booking
transaction or the minute sweeper. Phase 2 payments reuse the same hold.
