# Plan 06 — Web: public site and booking

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A bilingual Next.js site where a client sees the salon's services, team and location, books one to four services through the approved flow (hold → phone code → confirm), and manages their appointments and profile — all through the existing API.

**Architecture:** New `apps/web` (Next.js App Router, next-intl). Public pages are server components that fetch public reads through `api-client` with a revalidating fetch; booking, login and the client area are client components using one browser `api-client` (cookie token store, Web Locks refresh lock). UI strings live in a new platform-agnostic `packages/i18n`. Three small API additions support the flow.

**Tech Stack:** Next.js (latest stable major at install time, App Router, React 19), next-intl, Tailwind CSS + shadcn/ui, `next/font`, Vitest + Testing Library (jsdom), Playwright; API side NestJS 11, Prisma 6, Zod 3.

**Spec:** `docs/superpowers/specs/2026-11-21-web-public-booking-design/` (all pages and `mockups/`), parent `docs/superpowers/specs/2026-11-17-mvp-design/` (`architecture.md` Web/Auth, `flows.md` online booking and cancel/reschedule, `api.md` Public/Client).

**Branch:** `feat/mvp-06-web`

## Routing

Main session: Opus 5.5 (orchestrates, does not implement normal tasks).

| Task | What | Implementer | Reviewer | Why |
|---|---|---|---|---|
| 1 | API: booking settings in `GET /public/locations` | implementer-sonnet | reviewer-opus | read-only, shape fixed |
| 2 | API: `consentSource` on `PATCH /me` | **implementer-opus** | reviewer-opus | consent evidence (production data) |
| 3 | API: `DELETE /holds/:holdId` | **implementer-opus** | reviewer-opus | booking write (production data) |
| 4 | `api-client`: public, booking, me methods | implementer-sonnet | reviewer-opus | interfaces listed |
| 5 | `packages/i18n` + `apps/web` scaffold, theme, layout, locale routing | implementer-sonnet | reviewer-opus | setup, conventions listed |
| 6 | Web data layer: API clients, session, errors, formatting, phone | implementer-sonnet | reviewer-opus | signatures listed |
| 7 | Public pages and SEO | implementer-sonnet | reviewer-opus | screens listed |
| 8 | Booking store, step 1 (services) and step 2 (time, hold) | implementer-sonnet | reviewer-opus | flow fully specified |
| 9 | Step 3 (details, OTP, confirm), step 4 (done), login | implementer-sonnet | reviewer-opus | flow fully specified, uses existing auth client |
| 10 | Client area: appointments, cancel, reschedule, repeat, profile | implementer-sonnet | reviewer-opus | flow fully specified |
| 11 | E2E smoke, CI job, docs, plan index | implementer-sonnet | reviewer-opus | test + config + docs |

Production-data branch (tasks 2–3): **two independent final branch reviews** (`reviewer-opus`, fresh context each, no shared conclusions).

## Global Constraints

- Everything from plans 01–04 still holds for the API (strict TS, problem+json, `{ code }` errors, auth decorator on every handler, `orgId` on every query, `Clock` for time, docs in the same commit).
- No business rule in web: availability, prices, the cancel window and "any" professional come from the API. Web may hide a button as a hint; the API decides.
- `packages/*` (including `packages/i18n` and `api-client`) import no DOM, Next.js, NestJS or Node modules (`eslint.platform.mjs`). Browser-only things (`navigator.locks`, `fetch`) are passed in from `apps/web`.
- Every UI string is in both `packages/i18n/src/en.ts` and `es.ts`; none hard-coded in components. Locales `en`, `es`; URL locale wins.
- Prices: `Intl.NumberFormat(locale, { style: "currency", currency: "USD" })` from cents. Dates/times: `Intl.DateTimeFormat` with `timeZone` = the location's `timezone`, locales `en-US` / `es-US`.
- Mockup tokens: plum `#7A2E5A` (hover `#5C2143`, tint `#F6E9F0`), ink `#1F1A17`, muted `#5E534D`, cream `#FBF8F5`, card `#FFFFFF`, border `#E6DDD7` / `#DCD2CC`, success `#1E6B45` on `#E5F3EC`, warning `#6B3D00` on `#FFF4E5`; Inter body, Space Grotesk headings; touch targets ≥ 44 px, primary buttons 52 px; WCAG AA.
- No WhatsApp consent UI; the only consent channel offered is `EMAIL`. No "Add to calendar", no manage-link pages (plan 05).
- `sessionStorage` / Web Locks access is wrapped so the app works without them.
- Each task ends green: `pnpm format:check && pnpm turbo run lint typecheck test build`; API tasks also `pnpm --filter @beautyspa/api test:int`.

## Review Focus

1. A browser in another timezone (e.g. `TZ=America/Los_Angeles`) must still see salon times in `America/New_York` — Task 6 test `formatTime uses the location zone, not the process zone`.
2. The date strip across a DST change (2026-11-01 in New York) must list each calendar day once — Task 8 test `dateStrip lists each local day once across DST`.
3. Reload during a hold: state comes back from `sessionStorage`; an already expired hold sends the client to step 2 with the expired message — Task 9 test `details with an expired stored hold returns to time`.
4. `?next=` on login must only accept a same-origin relative path (`/es/me`), never `//evil.com` or `https://…` — Task 9 test `safeNext rejects absolute and protocol-relative urls`.
5. A pasted phone like `+1 (718) 555-0123`, `1-718-555-0123` or `718.555.0123` must become `+17185550123`; letters or a non-10-digit number are rejected before calling the API — Task 6 test `toE164 normalizes common US formats`.

---

### Task 1: API — booking settings in public locations

**Files:**
- Modify: `packages/contracts/src/public.ts` (`PublicLocationSchema`), `packages/contracts/src/public.test.ts`
- Modify: `apps/api/src/public/public.controller.ts` (`listLocations`)
- Test: `apps/api/test/integration/public/public.int.test.ts`
- Docs: `docs/superpowers/specs/2026-11-17-mvp-design/api.md` (Public table row for `/public/locations`)

**Interfaces:**
- Produces: `PublicLocationSchema` gains `booking: z.object({ bookingHorizonDays: z.number().int(), cancelWindowHours: z.number().int(), holdMinutes: z.number().int() })`; type `PublicLocation["booking"]`.

- [ ] **Step 1: Failing tests.** Contract: `PublicLocationSchema` rejects an object without `booking`. Integration: `GET /v1/public/locations` returns `booking: { bookingHorizonDays: 60, cancelWindowHours: 24, holdMinutes: 5 }` for a location without settings (defaults from `DEFAULT_LOCATION_SETTINGS`), and the stored values after `PATCH /v1/staff/settings` sets `{ bookingHorizonDays: 30, cancelWindowHours: 12, holdMinutes: 7 }`.
- [ ] **Step 2: Run** `pnpm --filter @beautyspa/contracts test && pnpm --filter @beautyspa/api test:int -- public` → FAIL.
- [ ] **Step 3: Implement.** Read each location's merged settings the same way staff settings / `BookingContextService` do (reuse the existing settings reader; do not duplicate default merging) and add the three keys.
- [ ] **Step 4: Run** the same commands → PASS; full gate green.
- [ ] **Step 5: Commit** `feat(api): booking settings in public locations`.

### Task 2: API — `consentSource` on `PATCH /me` (Opus)

**Files:**
- Modify: `packages/contracts/src/customer.ts` (`MePatchSchema`), `packages/contracts/src/customer.test.ts`
- Modify: `apps/api/src/customers/me.service.ts` (`patch`)
- Test: `apps/api/test/integration/customers/me.int.test.ts`
- Docs: `api.md` (`GET/PATCH /me` row), parent `flows.md` step 5–6 (email instead of WhatsApp for now, source `BOOKING_FORM`)

**Interfaces:**
- Produces: `MePatchSchema` gains `consentSource: z.enum(["PROFILE", "BOOKING_FORM"]).optional()`; refine: `consentSource` without `consents` → issue on path `consentSource`. Default when absent: `"PROFILE"`.

- [ ] **Step 1: Failing tests.** Contract: `{ consentSource: "BOOKING_FORM" }` alone fails; `{ consents: { EMAIL: true }, consentSource: "BOOKING_FORM" }` passes; `"RECEPTION"` fails. Integration: `PATCH /v1/me { email, consents: { EMAIL: true }, consentSource: "BOOKING_FORM" }` → `GET /v1/me/export` `consentHistory` last row `{ channel: "EMAIL", granted: true, source: "BOOKING_FORM" }`; without `consentSource` the row is `PROFILE`; `{ name: "X", consentSource: "BOOKING_FORM" }` → 400 `VALIDATION_FAILED`; the audit row still has only `after: { fields }`.
- [ ] **Step 2: Run** contracts test and `test:int -- me` → FAIL.
- [ ] **Step 3: Implement** in `MeService.patch`: pass `input.consentSource ?? "PROFILE"` to `recordConsents`; update its doc comment.
- [ ] **Step 4: Run** → PASS; full gate green.
- [ ] **Step 5: Commit** `feat(api): consent source on PATCH /me`.

### Task 3: API — `DELETE /holds/:holdId` (Opus)

**Files:**
- Modify: `apps/api/src/booking/appointment-writer.ts` (new `releaseHold`), `apps/api/src/booking/holds.service.ts` (new `release`), `apps/api/src/booking/holds.controller.ts`
- Test: `apps/api/test/integration/booking/holds.int.test.ts`
- Docs: `api.md` (Public table: new row), parent `flows.md` Hold lifecycle (released by the client going back), RBAC matrix row in `apps/api/test/integration/rbac-matrix.int.test.ts` (public)

**Interfaces:**
- Produces: `DELETE /v1/holds/:holdId` (`@Public()`, `IdPipe`) → 204. `releaseHold(tx, orgId: string, holdId: string, now: Date): Promise<"released" | "already" | "booked">` (`"already"` = not `HELD` and cancelled; `"booked"` = any other status); unknown or other org → `NotFound`.
- Consumes: `lockOrgBookings`, `releaseExpiredHoldsAudited`, `BOOKING_TX_OPTIONS`, the `holds:ip:` rate-limit key and `PER_IP` of `HoldsService`.

- [ ] **Step 1: Failing tests** in `holds.int.test.ts`: (a) create a hold, `DELETE` → 204; `GET /v1/availability` for that date shows the slot again; `POST /v1/appointments { holdId }` with a customer token → 409 `HOLD_EXPIRED`; audit has `appointment.hold_release` with `actorType "CUSTOMER"`, `entityId` = holdId, `after: { released: 1 }`. (b) second `DELETE` → 204, no second audit row. (c) booked hold → 409 `CONFLICT`. (d) random uuid → 404; non-uuid → 400. (e) the 31st hold-or-release call from one IP in 10 min → 429.
- [ ] **Step 2: Run** `test:int -- holds` → FAIL.
- [ ] **Step 3: Implement.** Transaction with `BOOKING_TX_OPTIONS`: rate limit (same key as `create`), `lockOrgBookings`, `releaseExpiredHoldsAudited`, `SELECT … FOR UPDATE` the appointment by id + org, then `releaseHold` updates it exactly like `releaseExpiredHolds` (status `CANCELLED`, `cancelledBy "SYSTEM"`, `cancelReason "HOLD_EXPIRED"`, `cancelledAt` now, segments `occupies = false`); audit only on `"released"`; `"booked"` → `conflict()` from `common/http-errors`.
- [ ] **Step 4: Run** → PASS; full gate green.
- [ ] **Step 5: Commit** `feat(api): release a hold early`.

### Task 4: `api-client` — public, booking and me methods

**Files:**
- Create: `packages/api-client/src/resources.ts`, `packages/api-client/src/resources.test.ts`
- Modify: `packages/api-client/src/client.ts` (`ApiClient` gains groups), `packages/api-client/src/index.ts`

**Interfaces:**
- Produces (all bodies typed `z.input<Schema>`, responses parsed with the contract schema):
  ```ts
  interface PublicApi { locations(): Promise<PublicLocation[]>; services(q?: { locationId?: string }): Promise<PublicServicesResponse>; employees(q?: { locationId?: string }): Promise<PublicEmployee[]>; }
  interface BookingApi { availability(q: { locationId?: string; services: ServiceChoice[]; date: string; excludeAppointmentId?: string }): Promise<Slot[]>; createHold(b: HoldInput): Promise<Hold>; releaseHold(holdId: string): Promise<void>; book(b: BookInput): Promise<Appointment>; }
  interface MeApi { get(): Promise<Me>; patch(b: MePatch): Promise<Me>; appointments(): Promise<MyAppointments>; cancel(id: string, b?: CancelInput): Promise<Appointment>; reschedule(id: string, b: RescheduleInput): Promise<Appointment>; repeat(id: string): Promise<Repeat>; export(): Promise<CustomerExport>; remove(): Promise<void>; }
  interface ApiClient { request; auth; public: PublicApi; booking: BookingApi; me: MeApi }
  ```
- `public.*`, `createHold`, `releaseHold`: `auth: false`. `availability`: `auth: true` (sends the bearer when present; anonymous works). `me.*`, `book`: `auth: true`.

- [ ] **Step 1: Failing tests** (fake `fetch` recording calls, like `client.test.ts`): `availability encodes repeated services and optional params` → URL `…/v1/availability?services=s1%3AANY&services=s2%3Ae1&date=2026-12-01` (+ `excludeAppointmentId` only when given); `releaseHold sends DELETE /v1/holds/<id> and resolves on 204`; `me.cancel posts {} when no body`; `public.services adds locationId only when given`; `a 409 SLOT_TAKEN problem rejects with ApiError code SLOT_TAKEN`; one test per remaining method asserting method + path.
- [ ] **Step 2: Run** `pnpm --filter @beautyspa/api-client test` → FAIL.
- [ ] **Step 3: Implement** `createResources(request)` in `resources.ts` returning the three groups; `createApiClient` spreads them in. Query strings via `URLSearchParams` (`append` per service as `"<serviceId>:<employeeId>"`).
- [ ] **Step 4: Run** → PASS; gate green.
- [ ] **Step 5: Commit** `feat(api-client): public, booking and me methods`.

### Task 5: `packages/i18n` and `apps/web` scaffold

**Files:**
- Create: `packages/i18n/` (`package.json` like `packages/contracts`, `tsup`, `eslint.config.mjs` using `eslint.platform.mjs`, `src/en.ts`, `src/es.ts`, `src/index.ts`, `src/parity.test.ts`)
- Create: `apps/web/` (Next.js App Router, `src/app/[locale]/layout.tsx`, `src/app/[locale]/page.tsx` placeholder, `src/i18n/routing.ts`, `src/i18n/request.ts`, `src/middleware.ts`, `src/components/site-header.tsx`, `src/components/locale-switch.tsx`, Tailwind config with the tokens, `components.json` for shadcn, `vitest.config.mts`, `eslint.config.mjs`, `.env` keys documented)
- Modify: `.env.example` (`API_URL=http://localhost:3001`, `NEXT_PUBLIC_API_URL=http://localhost:3001`, `NEXT_PUBLIC_SITE_URL=http://localhost:3000`), `turbo.json` if web outputs need listing (`.next/**`, excluding `.next/cache/**`)

**Interfaces:**
- Produces: `@beautyspa/i18n` exports `en`, `es`, `type Messages` (deep string shape of `en`; `es: Messages` so missing keys fail typecheck), `LOCALES = ["en", "es"] as const`, `type Locale`, `DEFAULT_LOCALE = "en"`. Namespaces: `common`, `nav`, `home`, `services`, `team`, `location`, `booking`, `login`, `me`, `profile`, `errors`, `seo`. Later tasks add keys to both files.
- Produces: `routing` (next-intl `defineRouting({ locales: LOCALES, defaultLocale: "en" })`), locale-aware `Link`, `redirect`, `usePathname`, `useRouter` from `src/i18n/navigation.ts`; `SiteHeader` (location name prop, nav: Services, Team, Location, My appointments; `LocaleSwitch` keeps the current path).

- [ ] **Step 1: Failing tests.** `parity.test.ts`: `en and es have the same keys` (deep key lists equal). Web: `locale-switch.test.tsx` — on `/es/services` the EN link points to `/en/services`; `site-header.test.tsx` renders the four nav labels from the catalog.
- [ ] **Step 2: Run** `pnpm --filter @beautyspa/i18n test && pnpm --filter @beautyspa/web test` → FAIL.
- [ ] **Step 3: Implement.** Scaffold with the official Next.js creator (TypeScript, App Router, `src/`, Tailwind, ESLint), package name `@beautyspa/web`, port 3000 in `dev`/`start`; next-intl middleware redirects `/` by `Accept-Language`; `<html lang>` = locale; fonts via `next/font/google` (Inter, Space Grotesk) as CSS variables; tokens as Tailwind theme colors named `plum`, `plum-hover`, `plum-tint`, `ink`, `muted`, `cream`, `card`, `line`, `line-strong`, `ok`, `ok-bg`, `warn`, `warn-bg`. Scripts `dev`, `build`, `start`, `lint`, `typecheck`, `test`.
- [ ] **Step 4: Run** tests → PASS; `pnpm --filter @beautyspa/web build` succeeds; `pnpm dev` serves `/en` and `/es` with the header.
- [ ] **Step 5: Docs + commit.** `docs/development/README.md`: running web, env keys. Commit `feat(web): scaffold web app and i18n catalogs`.

### Task 6: Web data layer

**Files:**
- Create in `apps/web/src/lib/`: `api/server.ts`, `api/browser.ts`, `session/session-provider.tsx`, `session/use-session.ts`, `errors.ts`, `format.ts`, `phone.ts`, `localized.ts`; tests beside each (`*.test.ts[x]`)

**Interfaces:**
- `revalidatingFetch(seconds: number): FetchLike` — calls `fetch(url, { ...init, next: { revalidate: seconds } })`.
- `getServerApi(): Pick<ApiClient, "public">` — `createApiClient({ baseUrl: process.env.API_URL, transport: "cookie", tokenStore: createCookieTokenStore(), fetch: revalidatingFetch(60) })`. Server-only module (`import "server-only"`).
- `getBrowserApi(): ApiClient` — module singleton; `baseUrl: process.env.NEXT_PUBLIC_API_URL`, `transport: "cookie"`, `createCookieTokenStore()`, `fetch: window.fetch.bind(window)`, `refreshLock: (fn) => navigator.locks ? navigator.locks.request("bs-refresh", fn) : fn()`, `onSessionExpired` → session provider sets signed out.
- `SessionProvider` / `useSession(): { status: "loading" | "signedIn" | "signedOut"; ensure(): Promise<boolean>; signedIn(): void; logout(): Promise<void> }` — `ensure()` calls `auth.refresh()` once (shared promise); 401/403 → signed out; `logout()` calls `auth.logout()` then clears the booking store key `bs-booking` from `sessionStorage`.
- `errorMessageKey(err: unknown): string` — `ApiError` → `errors.<code>`; network `TypeError` → `errors.network`; else `errors.generic`. `fieldErrors(err): Record<string, string>` from `problem.errors`.
- `formatPrice(cents: number, locale: Locale): string`; `formatDate(iso: string, tz: string, locale: Locale, style: "long" | "short"): string`; `formatTime(iso: string, tz: string, locale: Locale): string`; `formatTimeRange(startIso, endIso, tz, locale): string`. Intl locale `en-US` / `es-US`.
- `toE164(input: string): string | null` (US only: strip non-digits, accept 10 digits or 11 starting with `1`, else null); `formatUsPhone(digits: string): string` → `(718) 555-0123` as typed.
- `localized(text: { en: string; es: string } | null, locale: Locale): string` — falls back to the other language when empty.

- [ ] **Step 1: Failing tests:** `formatTime uses the location zone, not the process zone` (set `process.env.TZ = "America/Los_Angeles"`; `2026-11-19T16:00:00Z` in `America/New_York` → `11:00 AM` / es `11:00 a. m.`); `formatPrice 6500 → $65.00`; `toE164 normalizes common US formats` (the five inputs from Review Focus 5, plus `"abc"` and `"555-0123"` → null); `errorMessageKey maps SLOT_TAKEN, network and unknown`; `localized falls back to en when es is empty`; `ensure() refreshes once for concurrent callers and reports signedOut on 401`; `revalidatingFetch passes next.revalidate`.
- [ ] **Step 2: Run** `pnpm --filter @beautyspa/web test` → FAIL.
- [ ] **Step 3: Implement** the listed functions; mount `SessionProvider` in `[locale]/layout.tsx`; add `errors.*` keys for every `ErrorCode` plus `generic`, `network` in both catalogs (copy per `session-and-data.md` table).
- [ ] **Step 4: Run** → PASS; gate green.
- [ ] **Step 5: Commit** `feat(web): api clients, session, formatting`.

### Task 7: Public pages and SEO

**Files:**
- Create: `apps/web/src/app/[locale]/services/page.tsx`, `team/page.tsx`, `location/page.tsx`, `apps/web/src/app/robots.ts`, `apps/web/src/app/sitemap.ts`, `apps/web/src/lib/seo.ts`; components under `src/components/public/`; tests beside them
- Modify: `[locale]/layout.tsx` (header gets the location name from `getServerApi().public.locations()`)

**Interfaces:**
- `pageMetadata(locale: Locale, path: string, titleKey: string, descriptionKey: string): Promise<Metadata>` in `seo.ts` — title, description, `alternates.canonical` = `${NEXT_PUBLIC_SITE_URL}/${locale}${path}`, `alternates.languages` = `{ en, es, "x-default": /en… }`.
- Consumes: Task 6 `getServerApi`, `formatPrice`, `localized`; `routes-and-screens.md` table rows for services, team, location.

- [ ] **Step 1: Failing tests:** `ServicesList groups by category and shows "from $X" only when fromPriceCents differs from priceCents`; each service links to `/<locale>?service=<id>`; `TeamList hides employees with empty serviceIds`; `LocationHours renders weekly hours and a tap-to-call tel: link`; `pageMetadata sets hreflang en, es and x-default`; `robots disallows /*/book/, /*/me, /*/login`; `sitemap lists 8 urls (4 pages × 2 locales)`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** server pages per the spec table (map link `https://maps.google.com/?q=<encoded address>`, no embed; initials avatar when `photoUrl` null). Add catalog keys.
- [ ] **Step 4: Run** → PASS; `pnpm dev` with API running shows seeded data in both locales.
- [ ] **Step 5: Commit** `feat(web): public services, team and location pages`.

### Task 8: Booking store, step 1 and step 2

**Files:**
- Create: `apps/web/src/lib/booking/store.ts`, `apps/web/src/lib/booking/date-strip.ts`, `apps/web/src/lib/booking/slot-summary.ts`; `apps/web/src/components/booking/service-picker.tsx`, `time-picker.tsx`, `date-strip.tsx`, `slot-grid.tsx`, `booking-footer.tsx`; `apps/web/src/app/[locale]/page.tsx` (replace placeholder), `apps/web/src/app/[locale]/book/time/page.tsx`; tests beside each

**Interfaces:**
- `BookingState = { serviceIds: string[]; choices: ServiceChoice[]; date: string | null; slot: Slot | null; hold: Hold | null }`; `useBookingStore()` (React context or a small external store; persisted to `sessionStorage` key `bs-booking`, try/catch): `toggleService(id)` (max 4 → returns `"limit"`), `setChoice(serviceId, employeeId | "ANY")`, `setDate`, `setSlot`, `setHold`, `clearHold`, `prefill(services: ServiceChoice[])`, `reset()`.
- `dateStrip(todayIso: string, horizonDays: number): string[]` — local calendar dates `YYYY-MM-DD` from today through today + horizonDays − 1, by calendar arithmetic (no `+ 86_400_000`). `todayIn(tz: string, nowMs: number): string` (use `@beautyspa/datetime` if it has an equivalent).
- `slotSummary(slot: Slot, services: PublicService[], employees: PublicEmployee[], locale): { lines: { serviceName: string; employeeName: string; priceCents: number }[]; totalCents: number; parallel: boolean }` — `parallel` = any two segments overlap in time; unknown employee id → catalog `booking.time.yourProfessional`.
- `holdSlot(api, store, slot): Promise<"held" | "taken" | "error">` — reuse when `store.hold` is valid (`expiresAt > now`) and its segments equal `slot.segments`; otherwise `releaseHold` the old valid hold (errors ignored), then `createHold({ locationId, segments: slot.segments })`.

- [ ] **Step 1: Failing tests:** `toggleService refuses a fifth service`; `store persists and restores from sessionStorage and works when sessionStorage throws`; `dateStrip lists each local day once across DST` (`dateStrip("2026-10-30", 5)` → `["2026-10-30","2026-10-31","2026-11-01","2026-11-02","2026-11-03"]`); `slotSummary marks overlapping segments as parallel and totals exact prices`; `holdSlot reuses a valid identical hold without calling the API`; `holdSlot releases a different valid hold before creating`; `time picker refetches slots and shows a notice on SLOT_TAKEN`; `empty day shows "next day with times", which queries following days up to 14 or the horizon`; `/book/time without services redirects to step 1`; `?service=<id> preselects it on step 1`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** step 1 per mockup 1 (category chips, service rows with duration, "can be done at the same time" for `parallelizable`, "from $X" when `fromPriceCents !== priceCents`, sticky footer count + from-total + Continue) and step 2 per mockup 2 (per-service chips "Any" + professionals whose `serviceIds` include it; date strip from `booking.bookingHorizonDays`, 7 visible, horizontal scroll; 3-column slot grid; footer with `slotSummary`; "Hold this time"). Availability refetches when choices or date change; 429 shows `errors.RATE_LIMITED`.
- [ ] **Step 4: Run** → PASS; manual: pick mani + pedi on a Tuesday, slots appear, holding goes to `/book/details` (placeholder until Task 9).
- [ ] **Step 5: Commit** `feat(web): booking services and time steps`.

### Task 9: Step 3 details, step 4 done, login

**Files:**
- Create: `apps/web/src/app/[locale]/book/details/page.tsx`, `book/done/[appointmentId]/page.tsx`, `[locale]/login/page.tsx`; components `hold-countdown.tsx`, `phone-step.tsx`, `code-step.tsx`, `details-form.tsx`, `email-offer.tsx`, `appointment-summary.tsx` under `src/components/booking/`; `apps/web/src/lib/safe-next.ts`; tests beside each

**Interfaces:**
- `safeNext(raw: string | null, locale: Locale): string` — returns `raw` only when it starts with `/` and not `//` or `/\`, else `/<locale>/me`.
- `useOtpLogin(): { start(phone: string): Promise<"whatsapp" | "sms">; verify(phone: string, code: string): Promise<void> }` — wraps `auth.otpStart` / `auth.otpVerify` with the page locale, then `useSession().signedIn()`.
- `AppointmentSummary({ appointment, services, employees, location, locale })` — shared with Task 10.
- Consumes: Task 8 store, Task 6 session/errors/phone, Task 4 `me.get`, `me.patch`, `booking.book`.

- [ ] **Step 1: Failing tests:** `countdown shows m:ss from hold.expiresAt and returns to time at 0 with the expired message`; `details with an expired stored hold returns to time`; `code label names the channel (whatsapp vs sms)`; `resend is disabled for 30 s`; `OTP_INVALID shows the inline code error`; `first-time customer must enter a name; email consent checkbox is disabled until an email is typed`; `confirm sends PATCH /me with only changed keys and consentSource BOOKING_FORM only with consents, then POST /appointments`; `returning signed-in customer skips phone and code and sees "Booking as <name>"`; `HOLD_EXPIRED on confirm returns to time`; `CONFLICT on confirm clears the hold, returns to time and links to my appointments`; `done page loads the appointment from me.appointments and shows the email offer only without EMAIL consent`; `email offer sends PATCH /me { email, consents: { EMAIL: true }, consentSource: "BOOKING_FORM" } and hides`; `safeNext rejects absolute and protocol-relative urls`; `login returns to next after verify`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** per `booking-flow.md` steps 3–4 and mockups 3–4 (adapted: no WhatsApp consent, email checkbox "Email me my confirmation and reminders", no calendar button). `+1` fixed prefix, `formatUsPhone` while typing, `toE164` before sending; six-digit input `inputmode="numeric" autocomplete="one-time-code"`; optional note (≤ 500 chars). After booking: `reset()` the store, go to done.
- [ ] **Step 4: Run** → PASS; manual end to end with `OTP_PROVIDER=console` (code in API log).
- [ ] **Step 5: Commit** `feat(web): booking details, confirmation and login`.

### Task 10: Client area

**Files:**
- Create: `apps/web/src/app/[locale]/me/page.tsx`, `me/appointments/[id]/reschedule/page.tsx`, `me/profile/page.tsx`; components `appointment-card.tsx`, `cancel-sheet.tsx`, `profile-form.tsx`, `delete-account.tsx` under `src/components/me/`; `apps/web/src/lib/me/window.ts`; tests beside each

**Interfaces:**
- `canChangeOnline(startsAtIso: string, cancelWindowHours: number, nowMs: number): boolean` — `nowMs <= startsAt - hours` (display hint only).
- Consumes: Task 9 `AppointmentSummary`, Task 8 `TimePicker` (prop `excludeAppointmentId` and fixed services; confirm calls `me.reschedule` instead of holding), Task 8 store `prefill`, Task 6 `useSession().ensure()`.

- [ ] **Step 1: Failing tests:** `signed-out visit redirects to /<locale>/login?next=/<locale>/me`; `upcoming cards show Cancel and Change time only when canChangeOnline`; `OUTSIDE_CANCEL_WINDOW shows the call-the-salon message with a tel: link`; `cancel sends the optional reason and moves the card to past`; `reschedule page queries availability with excludeAppointmentId and confirms with me.reschedule; SLOT_TAKEN refetches and keeps the old time`; `book again prefills the store and opens step 2, or step 1 when services is empty`; `profile saves only changed fields and the email consent switch sends consentSource PROFILE (default)`; `changing language in profile patches locale and switches the URL locale`; `download my data saves the export JSON as a file`; `delete account calls me.remove then auth.logout and lands home with the deleted notice`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** per `routes-and-screens.md` rows and `booking-flow.md` "Client area actions". Export download via `Blob` + object URL, filename `beautyspa-my-data.json`. Past items show status badge (`COMPLETED`, `CANCELLED`, `NO_SHOW`) and "Book again".
- [ ] **Step 4: Run** → PASS; manual: book, see it, change time, cancel, delete account.
- [ ] **Step 5: Commit** `feat(web): client area`.

### Task 11: E2E smoke, CI, docs

**Files:**
- Create: `apps/web/playwright.config.ts`, `apps/web/e2e/booking.spec.ts`, `apps/web/e2e/public.spec.ts`, `apps/web/e2e/README.md`
- Modify: `apps/web/package.json` (`test:e2e`), `.github/workflows/ci.yml` (new `e2e` job), `docs/development/README.md`, parent `architecture.md` (Web: data paths, session, `packages/i18n`), `docs/superpowers/plans/2026-11-17-mvp/README.md` (04 merged, 06 in progress → done at merge), `docs/handoff.md`

**Interfaces:**
- E2E environment: API on port 3101 with `NODE_ENV=test`, `OTP_PROVIDER=fake` (code `000000`), `DATABASE_URL=$DATABASE_URL_TEST` (migrated and seeded before the run), `WEB_ORIGIN=http://localhost:3100`, `HOLD_SWEEP_INTERVAL_MS=0`; web `next start` on 3100 with `API_URL`/`NEXT_PUBLIC_API_URL=http://localhost:3101` (built with that value). Playwright `webServer` starts both; mobile viewport (`devices["Pixel 7"]`), Chromium only.

- [ ] **Step 1: Write the specs.** `booking.spec.ts`: `/es` → pick Manicure + Pedicure spa → Continue → "next day with times" if the day is empty → first slot → Hold → phone `+1 718 555 01NN` (NN unique per run) → code `000000` → name → Confirm → Done shows both services → "See or change my appointments" → the appointment is in upcoming → Cancel → it is in past as cancelled. `public.spec.ts`: `/en/services` lists seeded services; clicking "Book" on one lands on `/en?service=<id>` with it selected.
- [ ] **Step 2: Run** `pnpm --filter @beautyspa/web test:e2e` locally (Docker up) → PASS (fix app bugs found, in this task).
- [ ] **Step 3: CI job `e2e`:** postgres + redis services as in the integration job; create the test DB; copy `.env.example` to `.env` and run `pnpm --filter @beautyspa/api secrets:gen`; build api + web; `db:deploy` + `db:seed` against the test DB; `npx playwright install --with-deps chromium`; `pnpm --filter @beautyspa/web test:e2e`; upload the Playwright report on failure.
- [ ] **Step 4: Docs** listed above; README in `apps/web/e2e/` explains the env and how to run locally.
- [ ] **Step 5: Run** the full gate, then commit `test(web): booking e2e smoke and CI job; docs`.

---

## Execution notes

- Ledger: `.superpowers/sdd/06-web-public-booking/progress.md`.
- Seeded staff work Tuesday–Saturday; manual checks pick one of those days.
- If the Next.js creator or next-intl major differs from what a step assumes, follow the installed version's documented API and record the versions in the ledger.
