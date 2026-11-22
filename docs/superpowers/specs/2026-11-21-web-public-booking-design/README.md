# Plan 06 — Web: public site and booking — Design

Status: draft for approval · Date: 2026-11-21 · Parent spec:
[`2026-11-17-mvp-design`](../2026-11-17-mvp-design/README.md)

## Intent

Give the owner something real to use in a browser before notifications exist
(owner moved plan 06 before plan 05 for this reason). First audience: the owner
testing the flow, and possibly a salon owner in a demo. Not yet real clients
finding the salon on Google (owner picked option A on 2026-11-21).

## Goals

1. New `apps/web` (Next.js App Router, next-intl, `/en` and `/es`).
2. Light public pages, server-rendered with basic SEO: home (= start booking),
   services, team, location.
3. The approved booking flow (mockups 1–4): services → professional and time →
   phone, code and details → confirmed.
4. Client area: my appointments (upcoming/past), cancel, reschedule, repeat,
   profile (name, email, language, email consent), export my data, delete my
   account.
5. Everything through the existing API via `packages/api-client`; no business
   rule in web.

## Non-goals (this plan)

- Manage-link pages (`/manage/:token`): the API arrives in plan 05; the pages go
  there.
- Notifications of any kind, "Add to calendar" (`.ics`, plan 05), web push.
- Staff panel, staff invite/reset pages (plan 07).
- Marketing content: hero photos, about text, gallery, reviews, editable CMS.
- PWA manifest/service worker, Lighthouse CI, full e2e suite (plan 08).

## Anti-goals

- Booking feels heavier than texting the salon (count taps; no account creation).
- Any business rule decided in web (availability, prices, cancel window, "any"
  professional): web only displays what the API returns and maps its errors.
- A refresh token readable by page script.

## Constraints

- Contracts in `packages/contracts` are the only source of shapes.
- Refresh cookie `bs_refresh` is `HttpOnly; Path=/v1/auth`, set by the API;
  web and API must share a registrable domain (dev: `localhost:3000` web,
  `localhost:3001` API, CORS allows `WEB_ORIGIN` only).
- WhatsApp messaging is deferred (owner decision 2026-11-21): the only consent
  channel offered is EMAIL. The OTP goes over the channels from `OTP_CHANNELS`
  (default `sms`; the API returns the `channel` used), so the code step has copy
  for both WhatsApp and SMS.
- English code and docs; UI strings EN/ES in catalogs, none hard-coded.

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **1 (chosen)** | Hybrid: public pages are server components fetching public reads; booking and client area are client components calling the API directly with `api-client` and the cookie token store | Matches the parent spec and the existing auth; SEO for public pages; no new backend. Two data paths (server fetch, browser fetch). |
| 2 | Pure client-side app | Simplest mental model; public pages reach crawlers empty and first load on a phone is slower. Fails goal 2. |
| 3 | Next.js as a backend-for-frontend holding sessions server-side | Could separate customer/staff sessions, but re-implements the tested auth and breaks "native app uses the same API as web". |

Claude picked 1 (owner delegated technical calls).

## Pages

- [Approved mockups](mockups/README.md) (copies in the repo)

- [Routes and screens](routes-and-screens.md)
- [Booking flow](booking-flow.md)
- [Session, data access and errors](session-and-data.md)
- [Build, testing and API additions](build-and-testing.md)

## Calls made by Claude (check these)

- Mockups adapted to no-WhatsApp messaging: the code step names the `channel`
  the API returns (WhatsApp or text); consent checkbox becomes optional email +
  "Email me my confirmation and reminders"; success-screen offer asks for email.
- Booking-time email consent is recorded with source `BOOKING_FORM` (as the
  parent spec requires) through a new optional `consentSource` on `PATCH /me`.
- Going back from Details releases the old hold through a new `DELETE
  /holds/:holdId` when the customer picks a different time.
- Step 2 and Done show exact prices from the slot's segments; "from" prices
  only on the services list.
- "Add to calendar" hidden until plan 05.
- One session per browser: a staff login (plan 07) replaces a customer session.
- Team page hides professionals with no listed service (`serviceIds` empty).
- Styling: Tailwind + shadcn/ui, mockup palette (plum `#7A2E5A`, ink `#1F1A17`,
  cream `#FBF8F5`) and fonts (Inter, Space Grotesk), mobile-first, WCAG AA.
- UI catalogs in a new `packages/i18n` (as the parent spec lists).
- Three small API additions (booking settings in public locations,
  `consentSource`, `DELETE /holds/:holdId`; see
  [build-and-testing.md](build-and-testing.md)).
- Booking state survives a page reload (sessionStorage), not a new tab.

## Left to the builder

Component breakdown, folder layout inside `apps/web`, exact copy within the
catalogs, loading skeleton visuals, choice of form/query helpers (if any).
