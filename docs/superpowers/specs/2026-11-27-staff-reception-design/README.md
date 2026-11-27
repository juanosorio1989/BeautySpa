# Staff panel, part A: reception (plan 07a) — design

Status: draft, 2026-11-27. Builds on the MVP spec
(`../2026-11-17-mvp-design/`) and the web spec
(`../2026-11-21-web-public-booking-design/`).

## Intent

Give salon staff a web panel to run the day: sign in safely, see the day
agenda, book a phone client in about 30 seconds, take walk-ins, find clients,
and change appointment status. There is no specific salon yet: after the MVP
the owner will look for salons to try the app, so this panel is the core of
that demo. It must work on a phone, a tablet at the front desk and a desktop,
because we do not know which one a salon will use.

Plan 07 was split (owner decision, 2026-11-27): **07a = reception daily work
(this document)**, **07b = owner admin screens** (catalog, employees, working
hours, time off, closures, settings), written after 07a merges.

## Goals

- Staff sign-in with password + TOTP, first-time enrollment, recovery codes,
  invite acceptance and password reset pages.
- Day agenda (mockup 5): mobile one column per professional with swipe;
  tablet/desktop all professionals side by side.
- Appointment actions: check in, complete, no-show, move, cancel.
- Quick booking (mockup 6) and walk-in.
- Client search, new client by reception (with consent), client detail with
  staff-only private notes.
- Role-aware UI: OWNER and RECEPTION see everything above; EMPLOYEE sees only
  their own agenda and may only check in / complete their own appointments.
- Bilingual EN/ES like the public site.

## Non-goals (07a)

- Owner admin screens (07b), resource (chair) view of the agenda (07b),
  drag-and-drop moves, live updates over websockets, offline mode (plan 08),
  staff push notifications, reports, payments.

## Anti-goals

- A panel that is fast on desktop but painful on a phone.
- Silent double-booking: the API stays the only judge of conflicts, and every
  override is explicit and audited.
- Showing a staff member's private notes to customers, or to EMPLOYEE.

## Constraints

- Same Next.js app (`apps/web`), routes under `/[locale]/staff/...`, same
  `api-client`, i18n catalogs, Tailwind tokens and error mapping as plan 06.
- All business rules stay in the API (MVP spec); the panel only calls it.
- One session per browser stays as decided in plan 06: customer and staff share
  the `bs_refresh` cookie; the staff login shows a notice when a customer
  session is active (signing in as staff replaces it).
- `NO_SHOW` only once `now >= startsAt`; check in / complete only from the
  appointment's local day (plan 04 R13); EMPLOYEE status limits (plan 04
  design call 7: own appointment, `CHECKED_IN`/`COMPLETED` only).

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **A (chosen)** | Two plans: 07a reception, then 07b owner admin | Smaller branches and reviews; a demo-able panel after 07a. Two final reviews instead of one. |
| B | One plan 07 with everything | One branch and review; ~25+ tasks, late and expensive review findings (as seen in plans 04/05). |
| C | 07a plus a minimal admin | Earlier demo; admin screens must be redone before a real salon, small saving since the API exists. |

The owner picked **A**. The panel lives in the existing web app (a separate
app would duplicate i18n, client and styles for no gain).

## Pages

- [Screens and flows](screens.md)
- [API additions](api-additions.md)
- [Testing](testing.md)

## Decided by Claude (owner delegates design calls)

Listed in each page under "Calls"; the main ones: separate staff route group
with its own layout and nav; agenda refresh by polling (30 s while visible, and
on focus) instead of websockets; move via a sheet that reuses the slot picker
(no drag); out-of-hours booking only through an explicit "Book anyway"
confirmation, with the times computed by the server (`GET /availability`
with a staff-only `override=true`); names for agenda cards come inside the
agenda response; private notes as one encrypted text per customer.

## Left to the builder

Component structure, exact copy wording (both catalogs), loading skeletons,
icon choice, swipe implementation (CSS scroll-snap is fine).
