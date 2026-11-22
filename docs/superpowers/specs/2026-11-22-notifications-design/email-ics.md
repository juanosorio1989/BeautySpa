# Email and `.ics`

## Templates

Code-defined in `apps/api/src/notifications/templates/` **(call)**: one module
per template key, texts in `en.ts` / `es.ts`, a render function
`(ctx) → { subject, text, html, push: { title, body } }`. `ctx`: customer name,
salon name and phone, location address and timezone, start (formatted with
`Intl.DateTimeFormat` in the location timezone and customer locale), services
in segment order with professional names, manage URL, `confirmed`.

Content per template: greeting, what happened (booked / reminder / changed /
cancelled), date and time, services and professional, address, manage link
("Confirm or cancel"; cancelled emails link to booking again instead), salon
phone. HTML **(call)**: one simple table layout with inline styles, no images,
no tracking pixels; plain text always included.

Customer-visible values only (an appointment's `notes` are customer-visible;
staff `cancelReason` is not and never appears). User-provided strings are
HTML-escaped.

## Mailer change

`MailMessage` gains `html?: string` and `attachments?: { filename; content:
string; contentType }[]`. `ResendMailer` maps them to Resend's `html` and
`attachments` (`content` base64). `ConsoleMailer` logs subject, recipient and
attachment names only. `send` returns `{ id?: string }` (Resend's `id`) so the
log row gets `providerMessageId`; existing callers ignore it.

## `.ics`

Hand-written generator (`notifications/ics.ts`, RFC 5545, CRLF, line folding at
75 octets, text escaping) **(call)**: small and fully testable; no dependency.

- `UID:appointment-<id>@beautyspa` stable per appointment; `SEQUENCE` =
  `manage_version`; `DTSTAMP` = now (UTC).
- `DTSTART`/`DTEND` in UTC (`Z`): first segment start, last segment end
  (customer-facing end, without cleanup buffer).
- `SUMMARY`: "{services} — {salon}"; `LOCATION`: address; `DESCRIPTION`:
  professional(s), salon phone, manage URL.
- Email attachments: confirmed and changed → `METHOD:REQUEST` with
  `ORGANIZER` = `EMAIL_FROM` address and `ATTENDEE;RSVP=FALSE` = customer email,
  `STATUS:CONFIRMED`; cancelled → `METHOD:CANCEL`, `STATUS:CANCELLED`, same
  UID, higher `SEQUENCE`. Reminders carry no attachment.
- Download from the manage page: `METHOD:PUBLISH`, no organizer/attendee.
- Filename `appointment.ics`, content type `text/calendar; method=REQUEST`
  (or `CANCEL`) for attachments.
