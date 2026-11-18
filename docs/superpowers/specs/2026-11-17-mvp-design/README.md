# BeautySpa MVP — Design

Status: draft for approval · Date: 2026-11-17

## Intent

A booking and salon-management SaaS for **Latino-owned salons in New York**
(nails, hair, personal care). The competition (Fresha, Booksy) is English-first
and SMS/email-first. Our edge: work the way this community already talks to its
salon — **WhatsApp and Spanish**, while serving English-speaking clients just as
well.

The MVP runs **one salon** (no pilot customer yet). If it proves sellable, we
scale to many salons. The data model is multi-tenant and multi-location from day
one so that step does not require a risky migration.

## Goals (MVP)

1. Clients book online in seconds: pick services, professional (or "any"),
   time; verify phone with a one-time code. **No account creation.**
2. Real-time availability that handles **parallel services** (mani + pedi with
   two technicians) and **limited resources** (pedicure chairs).
3. Double booking of an employee or resource is impossible, enforced by the
   database.
4. Reception enters phone, WhatsApp and walk-in appointments **fast from a
   phone**, so the online calendar stays the single source of truth.
5. WhatsApp confirmations and reminders (24 h and 2 h) with a link to confirm or
   cancel; email as fallback when the client gave one.
6. Bilingual UI (English / Spanish) on the public site, booking, and staff panel;
   messages sent in the client's language.
7. Installable PWA, mobile-first, with offline view of upcoming appointments.
8. API-first: all business logic in the API, so a future Expo app reuses it.

## Non-goals (MVP)

Payments/deposits, client technical file (formulas, photos, allergies,
consents), loyalty, packages, gift cards, coupons, waitlist, reviews,
commissions/tips, reports, campaigns, Google/Apple/email login for clients,
multi-salon onboarding and subscription billing, POS/inventory, push
notifications, native app.

## Anti-goals (failure even if it "works")

- Booking feels heavier than sending the salon a WhatsApp message.
- Reception finds it slower than their notebook, stops using it, and online
  availability becomes wrong.
- Any business rule lives only in the web frontend.
- A WhatsApp number gets flagged or banned for sending without opt-in.

## Constraints

- US market, New York: USD, `America/New_York` (DST), NY SHIELD Act. Salons are
  not HIPAA-covered, but sensitive data is still encrypted.
- WhatsApp business-initiated messages need Meta business verification and
  pre-approved templates (EN + ES). SMS marketing/reminders need Twilio A2P 10DLC
  registration (days to weeks). OTP via Twilio Verify does **not** need 10DLC.
- Code, API, and docs in English; UI strings in English and Spanish.
- No cloud resources are created without the owner's explicit approval.

## Approaches considered

| | Stack | Trade-off |
|---|---|---|
| A | NestJS + Prisma + Better Auth + Redis/BullMQ | Better Auth is session-token based; access + rotating refresh means working against its grain; NestJS integration is community-maintained. |
| **B (chosen)** | NestJS + Prisma + Redis/BullMQ + **small in-house token auth** | Exactly the auth the MVP needs (phone OTP, staff password + TOTP, access + rotating refresh) and identical on web and native. Cost: we own security-critical code, so it gets strict tests and review; Google/Apple added later. |
| C | Hono + Drizzle + pg-boss (no Redis) | Fewest moving parts, better range-type support; loses NestJS structure and departs far from the requested stack. |

The owner picked **B**.

## Pages

- [Architecture](architecture.md) — monorepo, apps, shared packages, auth, PWA
- [Data model](data-model.md) — tables, tenancy, constraints
- [Availability](availability.md) — slot engine, parallel services, resources
- [API](api.md) — `/v1` endpoints, errors, RBAC
- [Flows](flows.md) — online booking, reception, walk-in, notifications
- [Security & quality](security-quality.md) — security, privacy, testing, infra
- [Roadmap](roadmap.md) — later phases, multi-tenant, native app

## Decided by the owner

Sellable product for many salons; MVP for one salon; US / New York; Latino
salons; bilingual UI; WhatsApp primary; phone + OTP booking without account;
reception enters non-online bookings fast from mobile; parallel mani/pedi and
limited pedicure chairs; approach B; WhatsApp consent is optional at booking
(clear unticked checkbox + one-time offer on the success screen); the requested
stack otherwise.

## Calls made by the designer (check these)

Marked inline with **(call)**. Summary: tenancy columns now, RLS later; Twilio as
single vendor for WhatsApp, SMS, and Verify; SMS reminder provider built in MVP
but disabled by flag until 10DLC is approved; 5-minute hold; max 4 services per
appointment; "any" professional = least booked minutes that day; cancellation
window configurable per location (also applies to the manage link); staff 2FA
mandatory for all staff who log in; signed stateless manage links; reschedule and
staff move as one transaction with `excludeAppointmentId` (no hold); parallel
block of parallelizable services then the rest sequential, else fully
sequential; STAFF mode ignores lead time/horizon and allows audited
out-of-hours overrides; staff invite/reset/recovery-code lifecycle and
`create-owner` CLI; optional `locationId` on endpoints; "from $X" price for
"Any".

## Left to the builder

Component library details inside shadcn/ui, service-worker library (Serwist
suggested), exact folder layout inside each app, logging library, lint rules,
visual design within WCAG AA.
