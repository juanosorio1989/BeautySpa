# Routes and screens

All routes live under `/[locale]` (`en`, `es`). `/` redirects by
`Accept-Language` (next-intl middleware), default `en`. Every page has a header
with the location name (accessible name `nav.home` when it is empty), an EN/ES
switch (keeps the current path and query, e.g. the login `next`) and a link to
"My appointments".

| Route | Rendering | Content | API |
|---|---|---|---|
| `/[locale]` | server shell + client booking step 1 | Mockup 1: "What are we doing today?", category chips, service list (name, duration, "can be done at the same time" for `parallelizable`, `fromPriceCents` as "from $X" when it differs from `priceCents`), sticky footer with count, total duration hint, total from-price, Continue | `GET /public/services`, `GET /public/locations` |
| `/[locale]/services` | server | Services grouped by category, description, duration, price; each has "Book" → `/[locale]?service=<id>` preselected | `GET /public/services` |
| `/[locale]/team` | server | Professionals with a non-empty `serviceIds`: photo (or initials), name, level, bio, services they do | `GET /public/employees`, `GET /public/services` |
| `/[locale]/location` | server | Address, phone (tap to call), weekly hours in the location timezone, map link (plain `https://maps.google.com/?q=` link, no embed) | `GET /public/locations` |
| `/[locale]/book/time` | client | Mockup 2 | see booking-flow.md |
| `/[locale]/book/details` | client | Mockup 3 (adapted) | see booking-flow.md |
| `/[locale]/book/done/[appointmentId]` | client | Mockup 4 (adapted) | see booking-flow.md |
| `/[locale]/me` | client, needs session | My appointments: upcoming cards (date, time range, services + professional, total, Cancel, Change time), past list (status badge, Book again); a cancel reason shows only when it is the customer's own text (the API sends `null` for staff reasons; system codes such as `HOLD_EXPIRED` are never shown) | `GET /me/appointments` |
| `/[locale]/me/appointments/[id]/reschedule` | client, needs session | Same time picker as mockup 2, services fixed, employees prefilled from the appointment (changeable), "Confirm new time"; if one of its services is no longer public, a "call the salon" message instead of the picker | `GET /availability?excludeAppointmentId=`, `POST /me/appointments/:id/reschedule` |
| `/[locale]/me/profile` | client, needs session | Name, email, language (the page language switches only when the language control was used in that edit), email consent switch, "Download my data", "Delete my account" (confirm screen typing nothing extra: a second explicit button) | `GET/PATCH /me`, `GET /me/export`, `DELETE /me` |
| `/[locale]/login` | client | Phone → code, then back to `?next=` (only same-origin relative paths) | `/auth/otp/start`, `/auth/otp/verify` |

"Needs session": on load the page tries `refresh()`; no session → redirect to
`/[locale]/login?next=<path>`.

## SEO (basic)

- Server pages set `<title>`, description, `alternates.languages` (`hreflang`
  en/es + `x-default`), canonical URL from `NEXT_PUBLIC_SITE_URL`.
- `robots.txt` allows public pages, disallows `/*/book/`, `/*/me`, `/*/login`;
  those route groups also send `robots: { index: false }` from their own server
  `layout.tsx`.
  `sitemap.xml` lists the four public pages in both locales.
- Public reads are fetched with `next: { revalidate: 60 }`.
- `<html lang>` follows the locale.

## Formatting

- Prices: `Intl.NumberFormat(locale, { style: "currency", currency: "USD" })`
  from cents.
- Dates and times: `Intl.DateTimeFormat` with `timeZone` = the location
  timezone (never the browser's), locale `en-US` / `es-US`.
- Localized text (`LocalizedTextSchema`): page locale, falling back to the other
  language when empty.

## Visual system

Tokens from the mockups as Tailwind theme values: plum `#7A2E5A` (hover
`#5C2143`, tint `#F6E9F0`), ink `#1F1A17`, muted text `#5E534D`, cream ground
`#FBF8F5`, card `#FFFFFF`, border `#E6DDD7` / `#DCD2CC`, success `#1E6B45` on
`#E5F3EC`, warning `#6B3D00` on `#FFF4E5`. Fonts Inter (body) and Space Grotesk
(headings) via `next/font/google`. Touch targets ≥ 44 px; primary buttons 52 px;
sticky bottom action bar on booking steps; desktop centers a 480 px column for
booking and a wider container for public pages.
