# Plan 07a — Staff panel, part A: reception

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A bilingual, mobile-first staff panel in the web app where staff sign in with password + TOTP, run the day agenda, book phone clients and walk-ins, change appointment status, and keep private client notes — over the existing API plus seven small additions.

**Architecture:** API additions first (contracts → NestJS → integration tests → RBAC rows), then typed `api-client` methods, then client-only pages under `apps/web/src/app/[locale]/staff/` split into an `(auth)` route group (sign-in pages) and a `(panel)` group behind a staff gate that loads `GET /staff/me`. Business rules stay in the API; web keeps only pure display helpers (allowed actions, day window, gaps) with unit tests.

**Tech Stack:** NestJS 11, Prisma 6, Zod 3, Vitest, supertest; Next.js App Router + next-intl, Tailwind, Testing Library, Playwright; new web dependency `qrcode` (+ `@types/qrcode`).

**Spec:** `docs/superpowers/specs/2026-11-27-staff-reception-design/` (README, `screens.md`, `api-additions.md`, `testing.md`); mockups `docs/superpowers/specs/2026-11-21-web-public-booking-design/mockups/5-staff-agenda.html`, `6-staff-quick-booking.html`; parent `docs/superpowers/specs/2026-11-17-mvp-design/` (`flows.md` reception, walk-in, day agenda; `api.md` Staff).

**Branch:** `feat/mvp-07a-staff-reception` (exists; holds the spec commit).

## Routing

Main session: Opus 5.5 (orchestrates, does not implement normal tasks).

| Task | What | Implementer | Reviewer | Why |
|---|---|---|---|---|
| 1 | API: `GET /staff/me`, `GET /staff/booking-catalog` | implementer-sonnet | reviewer-opus | read-only, shapes fixed |
| 2 | API: agenda `includeCancelled`, `employees`, `services`, `resources` | implementer-sonnet | reviewer-opus | read-only, shapes fixed |
| 3 | API: `reachable`, search `lastVisit`, customer detail + appointments | implementer-sonnet | reviewer-opus | read-only, shapes fixed |
| 4 | API: `GET /availability?override=true` + `outsideHours` | **implementer-opus** | reviewer-opus | availability engine path |
| 5 | API: private customer notes (migration, encrypted) | **implementer-opus** | reviewer-opus | schema migration + customer data |
| 6 | `api-client`: staff methods | implementer-sonnet | reviewer-opus | interfaces listed |
| 7 | Web: staff shell, gate, i18n namespace, helpers | implementer-sonnet | reviewer-opus | signatures listed |
| 8 | Web: sign-in, enrollment, recovery, invite, reset, forgot | implementer-sonnet | reviewer-opus | flow fully specified, client exists |
| 9 | Web: day agenda, action sheet, move | implementer-sonnet | reviewer-opus | screens + pure helpers specified |
| 10 | Web: quick booking and walk-in | implementer-sonnet | reviewer-opus | flow fully specified |
| 11 | Web: clients list, client detail, notes | implementer-sonnet | reviewer-opus | screens specified |
| 12 | E2E staff fixtures + specs, docs, plan index | implementer-sonnet | reviewer-opus | test + docs |

Production-data branch (task 5: migration + encrypted customer data): **two independent final branch reviews** (`reviewer-opus`, fresh context each, no shared conclusions).

## Global Constraints

- Everything from plans 01–06 holds: strict TS, problem+json with `{ code }`, an auth decorator on every handler, `orgId` on every query, `Clock` for time in the API, docs in the same commit as code.
- No business rule in web. Web may hide a button as a hint; the API decides (409/403 are still handled).
- `packages/*` import no DOM, Next.js, NestJS or Node modules (`eslint.platform.mjs`).
- Every UI string in `packages/i18n/src/en.ts` and `es.ts` under a new `staff` namespace (parity test); none hard-coded.
- Times: `Intl.DateTimeFormat` with `timeZone` = the agenda/location `timezone`, locales `en-US`/`es-US`; prices from cents with `Intl.NumberFormat` USD. Reuse `apps/web/src/lib/format.ts` and `phone.ts`.
- Mockup tokens and touch targets as plan 06 (≥ 44 px, primary 52 px, WCAG AA). Breakpoint for side-by-side agenda columns: `min-width: 768px`.
- Staff pages are client components; robots `noindex` for `/[locale]/staff` (server `layout.tsx`) and `Disallow: /*/staff` in `robots.txt`.
- One session per browser (cookie `bs_refresh`), as decided in plan 06; no cookie change.
- New query-string booleans use `QueryBooleanSchema` (Task 2) — `"true"`/`"false"` only, default `false`.
- Each task ends green: `pnpm format:check && pnpm turbo run lint typecheck test build`; API tasks also run their int file alone: `pnpm --filter @beautyspa/api test:int -- <name>` (never chained with the full gate; exit 137 seen before).

## Review Focus

1. Agenda on the DST day 2026-11-01 (New York): the timeline must start at the employee's local 9:00 and list each hour once — Task 7 test `dayWindow on the DST day uses local working hours`.
2. A device in another timezone (`TZ=America/Los_Angeles`) must show salon times in `America/New_York` on agenda cards — Task 9 test `agenda card times use the agenda timezone`.
3. The refresh token expires mid-shift while polling: the panel must go to `/[locale]/staff/login?next=<current path>`, never the customer `/login` — Task 7 test `staff gate sends signed-out staff to staff login with next`.
4. Two receptionists act on the same appointment: the second action gets 409 `CONFLICT`; the sheet must show "This appointment changed" and refetch, not a generic error — Task 9 test `a 409 on an action shows changed and refetches`.
5. An appointment with no customer (walk-in) or an anonymized customer (deleted account, `name` null) must render "Walk-in client" / "Client" without crashing, and the client link is hidden for null — Task 9 test `cards without a customer or name use fallbacks`.

---

### Task 1: API — `GET /staff/me` and `GET /staff/booking-catalog`

**Files:**
- Create: `packages/contracts/src/staff-panel.ts` (+ `staff-panel.test.ts`), export from `packages/contracts/src/index.ts`
- Create: `apps/api/src/staff/staff-me.controller.ts`, `apps/api/src/staff/staff-me.service.ts`, `apps/api/src/booking/booking-catalog.controller.ts`, `apps/api/src/booking/booking-catalog.service.ts`; register in `staff.module.ts` / `booking.module.ts`
- Test: `apps/api/test/integration/staff/staff-me.int.test.ts`, `apps/api/test/integration/booking/booking-catalog.int.test.ts`, rows in `apps/api/test/integration/rbac-matrix.int.test.ts`
- Docs: `docs/superpowers/specs/2026-11-17-mvp-design/api.md` (Staff table, two rows)

**Interfaces:**
- Produces:
  ```ts
  StaffMeSchema = z.object({ id: IdSchema, name: z.string(), email: z.string(), role: StaffRoleSchema });
  BookingCatalogSchema = z.object({
    categories: z.array(z.object({ id: IdSchema, name: LocalizedTextSchema })),        // category sort order
    services: z.array(z.object({ id: IdSchema, categoryId: IdSchema, name: LocalizedTextSchema, durationMin: z.number().int(),
      priceCents: z.number().int(), parallelizable: z.boolean(), onlineBookable: z.boolean() })),   // active only, catalog order
    employees: z.array(z.object({ id: IdSchema, displayName: z.string(), levelId: IdSchema.nullable(), serviceIds: z.array(IdSchema) })),
    popularServiceIds: z.array(IdSchema).max(6),
  });
  ```
- `GET /v1/staff/me` (`@StaffAuth()` all roles) → `StaffMe`; `name` = `employee_profile.display_name`, else `email` (export `staffDisplayName(row): string` from `staff-me.service.ts`; Task 5 reuses it).
- `GET /v1/staff/booking-catalog?locationId=` (`@StaffAuth("OWNER","RECEPTION")`) → `BookingCatalog`; employees = active, with a profile, at the location (all, not only `bookableOnline`).

- [ ] **Step 1: Failing tests.** Contract: `StaffMeSchema` rejects role `"CUSTOMER"`. Int `staff-me`: OWNER with profile → `name` = display name; a staff user without profile → `name` = email; customer token → 403; no token → 401. Int `booking-catalog`: a service with `onlineBookable false` and an employee with `bookableOnline false` are included; an inactive service is not; `popularServiceIds` = the 6 services with most non-`HELD`, non-`CANCELLED` appointments whose start is in the last 90 days by `Clock` (ties by English name), fewer when fewer exist; EMPLOYEE → 403. RBAC rows: `["get","/staff/me",ALL]`, `["get","/staff/booking-catalog",OWNER_RECEPTION]`.
- [ ] **Step 2: Run** `pnpm --filter @beautyspa/contracts test` and `test:int -- staff-me booking-catalog rbac` → FAIL.
- [ ] **Step 3: Implement.** Popularity: one `groupBy` over `appointment_segment` joined to non-`HELD`/`CANCELLED` appointments of the org/location; reuse existing catalog readers for categories/services ordering.
- [ ] **Step 4: Run** → PASS; full gate green.
- [ ] **Step 5: Commit** `feat(api): staff me and booking catalog reads`.

### Task 2: API — agenda extension

**Files:**
- Modify: `packages/contracts/src/common.ts` (`QueryBooleanSchema`), `packages/contracts/src/booking.ts` (`AgendaQuerySchema`, `AgendaSchema`), tests
- Modify: `apps/api/src/booking/agenda.service.ts`
- Test: `apps/api/test/integration/booking/agenda.int.test.ts`
- Docs: `api.md` agenda row

**Interfaces:**
- Produces:
  ```ts
  QueryBooleanSchema = z.enum(["true", "false"]).transform((v) => v === "true");   // use with .default("false")
  AgendaQuerySchema += { includeCancelled: QueryBooleanSchema.default("false") }
  AgendaEmployeeSchema = z.object({ id: IdSchema, displayName: z.string(), active: z.boolean(),
    ranges: z.array(z.object({ start: IsoInstantSchema, end: IsoInstantSchema })) });
  AgendaSchema += { employees: z.array(AgendaEmployeeSchema),
    services: z.array(z.object({ id: IdSchema, name: LocalizedTextSchema })),
    resources: z.array(z.object({ id: IdSchema, name: z.string() })) }
  ```
- Consumes: `BookingContextService.load(..., { mode: "STAFF", now, date })` and `employeeFreeTime({ employee, location, date, busy: [], ignoreHours: false })` from `@beautyspa/availability` for `ranges` (working hours after time off, location hours and closures; no busy).

- [ ] **Step 1: Failing tests** in `agenda.int.test.ts`: (a) default excludes a cancelled appointment; `includeCancelled=true` includes it; `includeCancelled=yes` → 400. (b) `employees` lists active employees at the location with `ranges` matching their working hours for that local date (ISO instants), an employee on time off that day has `ranges: []`. (c) deactivate an employee who has a segment that day → still in `employees` with `active: false`, `ranges: []`, and their appointment is returned. (d) `services`/`resources` contain exactly the ids referenced by returned segments, including a service deactivated after booking. (e) EMPLOYEE gets `employees` = only self.
- [ ] **Step 2: Run** contracts test and `test:int -- agenda` → FAIL.
- [ ] **Step 3: Implement** in `AgendaService.day`: status filter adds `CANCELLED` when `includeCancelled`; build the three lists after the appointment query (one query each for referenced services/resources/inactive employees).
- [ ] **Step 4: Run** → PASS; full gate green.
- [ ] **Step 5: Commit** `feat(api): agenda carries employees, names and cancelled`.

### Task 3: API — reachability, last visit, customer detail

**Files:**
- Create: `apps/api/src/customers/reachability.ts` (+ unit test)
- Modify: `packages/contracts/src/booking.ts` (`CustomerSummarySchema`), `packages/contracts/src/customer.ts` (`StaffCustomerSearchResultSchema`, `StaffCustomerAppointmentsSchema`), `apps/api/src/booking/appointment-mapping.ts` (`toStaffAppointmentDto`), every caller of it (agenda, staff appointments, walk-in), `apps/api/src/customers/staff-customers.service.ts` + controller
- Test: `apps/api/test/integration/customers/staff-customers.int.test.ts`, `agenda.int.test.ts`, RBAC rows
- Docs: `api.md` Staff rows (`/staff/customers*`, `StaffAppointment.customer.reachable`)

**Interfaces:**
- Produces:
  ```ts
  CustomerSummarySchema += { reachable: z.boolean() }
  StaffCustomerSearchResultSchema = StaffCustomerSchema.extend({
    lastVisit: z.object({ date: IsoDateSchema, serviceIds: z.array(IdSchema) }).nullable() });
  StaffCustomerAppointmentsSchema = z.object({ upcoming: z.array(StaffAppointmentSchema), past: z.array(StaffAppointmentSchema) });
  // apps/api/src/customers/reachability.ts
  loadReachable(db: Prisma.TransactionClient | PrismaService, customerIds: string[]): Promise<Set<string>>;
  toStaffAppointmentDto(row: AppointmentRow, reachable: ReadonlySet<string>): StaffAppointment;
  ```
- `reachable` = `selectChannels(consents, { email: email !== null, push: hasSubscription }).length > 0` (reuse `selectChannels` from `notifications/router.ts` and `currentConsents` logic, but batched: one query per table for all ids).
- `GET /staff/customers?q=` returns `StaffCustomerSearchResult[]`; `lastVisit` = latest `COMPLETED`/`CHECKED_IN` appointment: local date in its location timezone, its segments' service ids in segment order. Batched (no per-row query, consents included).
- `GET /v1/staff/customers/:id` (OWNER, RECEPTION) → `StaffCustomer`; `GET /v1/staff/customers/:id/appointments` (OWNER, RECEPTION) → same split as `MyAppointmentsService` (`upcoming` = `BOOKED`/`CHECKED_IN` ending after now, ascending; `past` = the rest except `HELD`, descending) but `past` capped at **20**, staff DTOs (cancel reasons kept). Deleted (`deletedAt`) or other-org id → 404.

- [ ] **Step 1: Failing tests.** Unit `reachability`: email consent + email → reachable; email consent, no email → not; push consent + subscription → reachable; no consents → not. Int: agenda card of a customer with email consent has `reachable: true`, walk-in with null customer has `customer: null`; search returns `lastVisit` for a customer with a completed appointment and `null` for one with only a cancelled one; customer detail 200 / other-org 404 / deleted 404 / EMPLOYEE 403; appointments split with 25 past rows returns 20 newest; a staff cancel reason is present. RBAC rows for both new GETs (`OWNER_RECEPTION`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**; every `toStaffAppointmentDto` caller loads `loadReachable` for its customer ids first.
- [ ] **Step 4: Run** `test:int -- staff-customers agenda staff-appointments rbac` (alone) → PASS; full gate green.
- [ ] **Step 5: Commit** `feat(api): customer reachability, last visit and staff customer reads`.

### Task 4: API — availability override for staff (Opus)

**Files:**
- Modify: `packages/contracts/src/availability.ts` (`AvailabilityQuerySchema`, `SlotSchema`), tests
- Modify: `apps/api/src/booking/availability.service.ts`, `apps/api/src/booking/plan-mapping.ts` (`toSlotDto` if needed)
- Test: `apps/api/test/integration/booking/availability.int.test.ts`
- Docs: `api.md` `/availability` row; `docs/superpowers/specs/2026-11-17-mvp-design/availability.md` (override on reads)

**Interfaces:**
- Produces: `AvailabilityQuerySchema += { override: QueryBooleanSchema.default("false") }`; `SlotSchema += { outsideHours: z.boolean().optional() }` (present only on override responses).
- Behavior: `override=true` with a customer token or no token → 400 `VALIDATION_FAILED` path `override`. With a staff token: run `findSlots` twice on contexts loaded with `override: false` and `override: true` (`BookingContextService.load` already accepts `override`); return the override list, each slot `outsideHours = !normalStarts.has(slot.start)`.
- Consumes: `QueryBooleanSchema` (Task 2).

- [ ] **Step 1: Failing tests.** Contract: `override=true` parses to `true`, absent → `false`. Int: staff `override=true` for a day an employee works 9–17 returns a slot at 18:00 with `outsideHours: true` and a 10:00 slot with `outsideHours: false`; a time overlapping an existing appointment of that employee is still absent; on a closure day slots exist, all `outsideHours: true`; `POST /staff/appointments` with the 18:00 slot's segments and `override: true` → 201 and audit `after.override: true`; customer token + `override=true` → 400; anonymous → 400; responses without `override` have no `outsideHours` key.
- [ ] **Step 2: Run** `test:int -- availability` → FAIL.
- [ ] **Step 3: Implement** in `AvailabilityService.slots`.
- [ ] **Step 4: Run** → PASS; full gate green.
- [ ] **Step 5: Commit** `feat(api): staff availability override with outside-hours flag`.

### Task 5: API — private customer notes (Opus)

**Files:**
- Create: migration `apps/api/prisma/migrations/<timestamp>_customer_private_notes_meta/migration.sql`; modify `schema.prisma` (`Customer.privateNotesUpdatedAt DateTime? @map("private_notes_updated_at") @db.Timestamptz(3)`, `privateNotesUpdatedBy String? @map("private_notes_updated_by") @db.Uuid` → FK `staff_user(id)` `ON DELETE SET NULL`)
- Create: `apps/api/src/customers/customer-notes.controller.ts`, `customer-notes.service.ts`; contracts `CustomerNotesSchema`, `CustomerNotesInputSchema` in `staff-panel.ts`
- Modify: account deletion (the `DELETE /me` anonymization in `apps/api/src/customers/`) clears the three columns
- Test: `apps/api/test/integration/customers/customer-notes.int.test.ts`, `me.int.test.ts` (deletion), RBAC rows, `schema-integrity.int.test.ts` if it lists columns
- Docs: `api.md` (new rows; replace "endpoint in a later plan"), `data-model.md` (columns)

**Interfaces:**
- Produces:
  ```ts
  CustomerNotesSchema = z.object({ notes: z.string().nullable(), updatedAt: IsoInstantSchema.nullable(),
    updatedBy: z.object({ id: IdSchema, name: z.string() }).nullable() });
  CustomerNotesInputSchema = z.object({ notes: z.string().trim().max(2000).nullable()
    .transform((v) => (v === "" ? null : v)) });
  ```
- `GET /v1/staff/customers/:id/notes`, `PUT /v1/staff/customers/:id/notes` (OWNER, RECEPTION) → `CustomerNotes`; text encrypted with the existing `Encryptor` into `private_notes_enc`; `updatedBy.name` via `staffDisplayName` (Task 1). Audit `customer.notes`, `entity "customer"`, `before`/`after` = `{ changed: true }`, never the text. Customer export unchanged (notes excluded).

- [ ] **Step 1: Failing tests.** PUT then GET returns the text, `updatedAt` = clock, `updatedBy` = caller; the DB column `private_notes_enc` is not the plaintext and decrypts to it; `"   "` → `notes: null`; 2,001 chars → 400; other org → 404; EMPLOYEE → 403; audit row has no note text anywhere in `before`/`after`; `GET /me/export` has no notes; `DELETE /me` leaves all three columns null. RBAC rows (`get`/`put` `OWNER_RECEPTION`).
- [ ] **Step 2: Run** `test:int -- customer-notes me` → FAIL.
- [ ] **Step 3: Implement** migration (`pnpm --filter @beautyspa/api db:migrate --name customer_private_notes_meta`), service, controller.
- [ ] **Step 4: Run** → PASS; `bash apps/api/scripts/check-drift.sh` clean; full gate green.
- [ ] **Step 5: Commit** `feat(api): private customer notes`.

### Task 6: `api-client` — staff methods

**Files:**
- Modify: `packages/api-client/src/resources.ts`, `resources.test.ts`, `client.ts` (`ApiClient` type), `index.ts`

**Interfaces:**
- Produces (bodies `z.input<Schema>`, responses parsed, `auth: true`):
  ```ts
  interface StaffApi {
    me(): Promise<StaffMe>;
    agenda(q: { date: string; locationId?: string; employeeId?: string; includeCancelled?: boolean }): Promise<Agenda>;
    bookingCatalog(q?: { locationId?: string }): Promise<BookingCatalog>;
    availability(q: { services: ServiceChoice[]; date: string; locationId?: string; excludeAppointmentId?: string; override?: boolean }): Promise<Slot[]>;
    createAppointment(b: StaffAppointmentInput): Promise<StaffAppointment>;
    moveAppointment(id: string, b: StaffAppointmentPatch): Promise<StaffAppointment>;
    setStatus(id: string, b: StatusChange): Promise<StaffAppointment>;
    walkIn(b: WalkInInput): Promise<StaffAppointment>;
    searchCustomers(q: string): Promise<StaffCustomerSearchResult[]>;
    createCustomer(b: StaffCustomerCreate): Promise<StaffCustomer>;
    customer(id: string): Promise<StaffCustomer>;
    customerAppointments(id: string): Promise<StaffCustomerAppointments>;
    notes(customerId: string): Promise<CustomerNotes>;
    saveNotes(customerId: string, b: CustomerNotesInput): Promise<CustomerNotes>;
  }
  interface ApiClient { …existing; staff: StaffApi }
  ```
  Booleans are sent only when `true` (`includeCancelled=true`, `override=true`). Auth methods already exist (`auth.staffLogin`, `mfaEnrollStart`, `mfaEnrollConfirm`, `mfaVerify`, `mfaRecover`, `inviteAccept`, `passwordForgot`, `passwordReset`).

- [ ] **Step 1: Failing tests** (fake fetch like existing): `staff.availability sends override only when true`; `staff.agenda sends includeCancelled only when true`; `staff.searchCustomers encodes q`; `staff.saveNotes sends PUT with body`; `a 403 FORBIDDEN rejects with ApiError status 403 and keeps the tokens`; one method+path test for each remaining method.
- [ ] **Step 2: Run** `pnpm --filter @beautyspa/api-client test` → FAIL.
- [ ] **Step 3: Implement** `staff` group in `createResources`.
- [ ] **Step 4: Run** → PASS; gate green.
- [ ] **Step 5: Commit** `feat(api-client): staff methods`.

### Task 7: Web — staff shell, gate, helpers

**Files:**
- Create: `apps/web/src/app/[locale]/staff/layout.tsx` (server; `robots: { index: false }`), `apps/web/src/app/[locale]/staff/(panel)/layout.tsx` (client; `StaffGate` + top bar + menu), `apps/web/src/components/staff/staff-gate.tsx`, `staff-top-bar.tsx`, `role-guard.tsx`
- Create: `apps/web/src/lib/staff/use-staff.ts`, `day-window.ts`, `gaps.ts`, `use-polling.ts`, `use-media-query.ts` (+ tests each)
- Modify: `packages/i18n/src/en.ts`, `es.ts` (`staff` namespace), `apps/web/src/app/robots.ts` (`Disallow: /*/staff`)

**Interfaces:**
- Produces:
  ```ts
  // use-staff.ts
  StaffContext: React.Context<StaffMe | null>;  useStaff(): StaffMe;   // throws outside the gate
  // staff-gate.tsx: on mount session.ensure(); false → router.replace(`/${locale}/staff/login?next=${encodeURIComponent(path)}`);
  //   then api.staff.me(); ApiError 403 → same redirect plus `&customer=1`; network/5xx → LoadError with retry; success → provider.
  //   Also registers setSessionExpiredHandler → same redirect (polling 401 mid-shift).
  <RoleGuard allow={["OWNER","RECEPTION"]}>…</RoleGuard>   // else "not available for your role" + link to agenda
  dayWindow(employees: AgendaEmployee[], date: string, timeZone: string): { start: number; end: number };
     // min start / max end of ranges; none → local 09:00–19:00 of `date` in `timeZone`
  freeGaps(ranges: {start:number;end:number}[], busy: {start:number;end:number}[]): {start:number;end:number}[];
     // ranges minus busy, sorted, gaps < 15 min dropped
  usePolling(fn: () => void, intervalMs = 30_000): void;  // runs only while document visible; runs fn on visibilitychange→visible and window focus
  useMediaQuery(query: string): boolean;                   // SSR-safe false
  ```

- [ ] **Step 1: Failing tests:** `dayWindow on the DST day uses local working hours` (2026-11-01, New York, ranges 9:00–17:00 local → start = that instant); `dayWindow falls back to 9 to 19 local`; `freeGaps subtracts busy and drops short gaps`; `usePolling pauses while hidden and fires on focus` (fake timers, mocked `visibilityState`); `staff gate sends signed-out staff to staff login with next`; `staff gate redirects a customer session with customer=1`; `staff gate redirects when the session expires later`; `RoleGuard hides content from EMPLOYEE`; i18n parity passes.
- [ ] **Step 2: Run** `pnpm --filter @beautyspa/web test` → FAIL.
- [ ] **Step 3: Implement.** Top bar: location name (`getPrimaryLocation` is server-only; use `api.public.locations()` once), EN/ES `LocaleSwitch`, menu links Agenda (`/staff`), Clients (OWNER/RECEPTION), name + role, Log out (reuse `LogoutButton` behavior; on success go to `/[locale]/staff/login`).
- [ ] **Step 4: Run** → PASS; gate green.
- [ ] **Step 5: Commit** `feat(web): staff shell, gate and agenda helpers`.

### Task 8: Web — sign-in pages

**Files:**
- Create under `apps/web/src/app/[locale]/staff/(auth)/`: `login/page.tsx`, `invite/page.tsx`, `reset/page.tsx`, `forgot/page.tsx`; components `apps/web/src/components/staff/auth/staff-login-flow.tsx`, `enroll-step.tsx`, `recovery-codes.tsx`, `password-fields.tsx` (+ tests)
- Modify: `apps/web/package.json` (`qrcode`, `@types/qrcode`)

**Interfaces:**
- Consumes: `api.auth.*` staff methods, `session.signedIn()`, `safeNext` (`lib/safe-next.ts`; default `/${locale}/staff`), `useErrorText`.
- `StaffLoginFlow` steps: `credentials → (MFA_REQUIRED) code | (ENROLL_REQUIRED) enroll → recoveryCodes → done`; "Use a recovery code" → `mfaRecover` → its `ENROLL_REQUIRED` token → `enroll`. Prop `initialStep?: { status: "ENROLL_REQUIRED" | "MFA_REQUIRED"; mfaToken: string }` lets invite start mid-flow.
- Enroll: `mfaEnrollStart` → QR via `QRCode.toDataURL(otpauthUrl)` in `<img alt>` + secret text; code → `mfaEnrollConfirm` → show 10 codes, Copy button, required "I saved them" checkbox before Continue.
- Login page with `customer=1` or an active customer session (quiet `ensure()` true and `staff.me()` 403) shows the notice `staff.login.customerNotice`; with an active staff session redirects to `next`.
- Invite: password + confirm (match, `NewPasswordSchema` rules shown) → `inviteAccept` → `StaffLoginFlow initialStep`. Reset: same fields → `passwordReset` → "Password changed" + link to login. Forgot: email → always the same neutral message. Missing `token` → "This link is not valid" + link to login. `OTP_INVALID`/`UNAUTHORIZED`/`RATE_LIMITED` by code.

- [ ] **Step 1: Failing tests:** `MFA_REQUIRED goes to code and signs in`; `ENROLL_REQUIRED shows QR and recovery codes, Continue disabled until saved`; `recovery code leads to enrollment, not sign-in`; `invite accept starts at enrollment`; `wrong code shows OTP_INVALID text`; `customer session shows the notice`; `next is sanitized` (`//evil.com` → `/es/staff`); `forgot shows the same message on 204 and 404-like responses`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; gate green.
- [ ] **Step 5: Commit** `feat(web): staff sign-in, enrollment, invite and reset`.

### Task 9: Web — day agenda, action sheet, move

**Files:**
- Create: `apps/web/src/app/[locale]/staff/(panel)/page.tsx`; components `apps/web/src/components/staff/agenda/agenda-view.tsx`, `agenda-header.tsx`, `employee-chips.tsx`, `agenda-column.tsx`, `appointment-card.tsx`, `action-sheet.tsx`, `move-sheet.tsx`; `apps/web/src/lib/staff/actions.ts` (+ tests)

**Interfaces:**
- Produces:
  ```ts
  type StaffAction = "checkIn" | "complete" | "noShow" | "move" | "cancel";
  allowedActions(a: StaffAppointment, ctx: { role: StaffRole; meId: string; now: number; timeZone: string }):
    { action: StaffAction; enabledFrom?: number }[];
  ```
  Rules: `checkIn` (`BOOKED`), `complete` (`BOOKED`|`CHECKED_IN`) only when the local date of `now` ≥ the appointment's local date; `noShow` (`BOOKED`) with `enabledFrom = startsAt` when `now < startsAt`; `move` (`BOOKED`|`CHECKED_IN`); `cancel` (`BOOKED`|`CHECKED_IN`); EMPLOYEE: only `checkIn`/`complete` and only when a segment has `employeeId === meId`.
- Page state: `?date=` (default today in location timezone), `?highlight=<id>` (scroll to that card and outline it for 3 s), chips filter persisted in `localStorage["bs-staff-agenda-employees"]`, `includeCancelled` toggle. Data `api.staff.agenda`, polled with `usePolling`; refetch after every action.
- Layout: `useMediaQuery("(min-width: 768px)")` → all visible columns side by side (horizontal scroll); else one column with scroll-snap swipe and chips as tabs. Column timeline from `dayWindow`, 15-min grid, now line on today, gaps from `freeGaps` as "Free · a – b" buttons → `/staff/book?date=&time=&employeeId=` (OWNER/RECEPTION only). Inactive employee column header `staff.agenda.inactiveColumn`.
- Card: customer name or `staff.agenda.walkInClient` (null customer) / `staff.agenda.unnamedClient` (null name); service names from `agenda.services` (localized), resource name, time range, status badge, "Online" for `source ONLINE`, "Confirmed" when `confirmedByCustomerAt`, "No messages" when `customer && !customer.reachable`; multi-segment "part i of n".
- Action sheet: details (tap-to-call `tel:`), notes; buttons from `allowedActions`; EMPLOYEE on a multi-employee appointment confirm `staff.agenda.wholeAppointment`; cancel asks reason (≤ 200). Move sheet: date strip + `TimePicker`-like slot list from `api.staff.availability({ services: segments as choices, date, excludeAppointmentId })`, employees changeable per service; save → `moveAppointment`. Errors: 409 `CONFLICT` → `staff.agenda.changed` + refetch; `SLOT_TAKEN` → refetch slots.

- [ ] **Step 1: Failing tests:** `allowedActions` table (each status × role, future day hides checkIn/complete, noShow `enabledFrom` before start, EMPLOYEE not on own segment → none); `agenda card times use the agenda timezone` (process `TZ=America/Los_Angeles`); `cards without a customer or name use fallbacks`; `a 409 on an action shows changed and refetches`; `phone width shows one column, wide shows all` (mock matchMedia); `Show cancelled refetches with includeCancelled`; `gap tap links to quick booking with prefill`; `EMPLOYEE sees no New, Walk-in or gap links`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; gate green.
- [ ] **Step 5: Commit** `feat(web): staff day agenda with actions and move`.

### Task 10: Web — quick booking and walk-in

**Files:**
- Create: `apps/web/src/app/[locale]/staff/(panel)/book/page.tsx`, `walk-in/page.tsx`; components `apps/web/src/components/staff/booking/client-picker.tsx`, `staff-service-picker.tsx`, `staff-slot-list.tsx`, `quick-booking.tsx`, `walk-in.tsx` (+ tests)

**Interfaces:**
- Consumes: `api.staff.searchCustomers`, `createCustomer`, `customer`, `bookingCatalog`, `availability`, `createAppointment`, `walkIn`; `toE164` (`lib/phone.ts`); `RoleGuard allow={["OWNER","RECEPTION"]}`.
- `ClientPicker({ value, onChange, allowSkip? })`: debounced 300 ms search (≥ 2 chars), rows name · phone · "last: <services>"; "New client" inline form (name, phone, language default = page locale, email optional, `staff.book.emailConsent` checkbox default off → `consents: { EMAIL: true }` only when ticked). Preselect from `?customerId=`.
- Services: `popularServiceIds` chips first, then full list by category; "Same as last time" when `lastVisit` (sets those services). Max 4.
- Times: "Any professional" or chosen employee per service; first 3 slots, "More times" (full day), date strip; prefill `?date=&time=&employeeId=` selects the matching slot when present. "Other time…" refetches with `override: true` and lists all; choosing an `outsideHours` slot shows `staff.book.outsideHours` + "Book anyway" confirm; save sends that slot's segments with `override: true`.
- Footer: "Save · <time>" + message line (`staff.book.confirmByEmail` when the client has email consent and email, else `staff.book.noMessages`). Save → `router.push(/${locale}/staff?date=<date>&highlight=<id>)`.
- Walk-in: client optional (Skip), services, "Start now" → `walkIn`; success shows employee + time, link to agenda; `SLOT_TAKEN` → `staff.walkIn.noOneFree` + link to `/staff/book`.

- [ ] **Step 1: Failing tests:** `returning client books in six taps or fewer` (search result → same as last time → first slot → save, counting `userEvent.click`); `new client sends consent only when ticked`; `pasted phone is normalized`; `out-of-hours slot requires Book anyway and sends override true`; `prefill selects the gap slot`; `SLOT_TAKEN refetches times`; `walk-in without client sends customerId null`; `walk-in SLOT_TAKEN shows no one free`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; gate green.
- [ ] **Step 5: Commit** `feat(web): staff quick booking and walk-in`.

### Task 11: Web — clients list, detail, notes

**Files:**
- Create: `apps/web/src/app/[locale]/staff/(panel)/clients/page.tsx`, `clients/[id]/page.tsx`; components `apps/web/src/components/staff/clients/client-search.tsx`, `client-detail.tsx`, `notes-editor.tsx` (+ tests)

**Interfaces:**
- Consumes: `ClientPicker` search behavior (reuse its hook), `api.staff.customer`, `customerAppointments`, `notes`, `saveNotes`; `RoleGuard allow={["OWNER","RECEPTION"]}`.
- Detail: name, `tel:` phone, email, language, consents read-only, upcoming and past (status badge, cancel reason shown), "Book" → `/staff/book?customerId=`. Notes editor: textarea (max 2,000, counter), Save, "Updated <date> by <name>"; save failure keeps the text and shows the error.

- [ ] **Step 1: Failing tests:** `search shows results after two chars`; `detail renders past with cancel reasons`; `notes save shows updated by`; `notes save failure keeps the text`; `EMPLOYEE gets not available`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; gate green.
- [ ] **Step 5: Commit** `feat(web): staff clients and private notes`.

### Task 12: E2E, docs, plan index

**Files:**
- Create: `apps/api/scripts/e2e-staff.ts` (refuses unless `NODE_ENV=test`), `apps/web/e2e/totp.ts`, `apps/web/e2e/staff.spec.ts`
- Modify: `apps/web/e2e/prepare.sh` (run the script after `db:seed`), `apps/web/e2e/README.md`, `apps/api/package.json` (`e2e:staff` script)
- Docs: `docs/superpowers/plans/2026-11-17-mvp/README.md` (row 07 → 07a/07b), `docs/handoff.md`, `docs/superpowers/specs/2026-11-21-web-public-booking-design/session-and-data.md` (staff login notice now implemented)

**Interfaces:**
- `e2e-staff.ts`: upserts OWNER `owner@e2e.test` and gives seeded EMPLOYEE `ana@demo-salon.test` login: `canLogin true`, password `E2e-Staff-Pass-1` (hashed with the existing password helper), TOTP secret `JBSWY3DPEHPK3PXP` encrypted with `Encryptor`, `totpEnrolledAt` now. Prints nothing secret.
- `e2e/totp.ts`: `totp(secretB32: string, now = Date.now()): string` (RFC 6238, SHA-1, 30 s, 6 digits, `node:crypto`).
- `staff.spec.ts`: (1) `/en/staff/login` as OWNER → code → agenda shows the seeded appointment → "+ New" → existing seeded client → first service → first slot → Save → card on the agenda → Check in → Complete → badge "Done". (2) EMPLOYEE `ana@…` → only her column, no "New"/"Walk-in".

- [ ] **Step 1: Write** the script, helper and spec.
- [ ] **Step 2: Run** `pnpm --filter @beautyspa/web test:e2e` → staff specs PASS alongside existing ones.
- [ ] **Step 3: Docs** updated as listed; gate green.
- [ ] **Step 4: Commit** `test(e2e): staff panel smoke; docs for plan 07a`.

## Execution notes

Rulings made by the controller (Opus) during execution:

- T1: `BookingCatalog.services[].categoryId` is nullable (uncategorized services exist; non-null would drop them).
- T2: an EMPLOYEE's agenda `employees` is only themselves (their column shows only their own segments).
- T4: context loaded once, `findSlots` run twice (normal + override) on the same snapshot.
- T4→T10: quick booking "Other time…" lists override slots starting 06:00–22:59 local only; the API stays full-day.
- T7: the customer `SiteHeader` hides on `/<locale>/staff*` through a client wrapper (no route-group move); ES OWNER label "Propietario/a".
- T9: phone swipe uses a touch handler rendering only the active column (spec: "swipe or chip tap").
- Final reviews (two independent, both "changes needed"): one fix wave F1–F11. F1 override keeps the normal plan at normal starts (fixes an unbookable "Any professional" slot); `reachable` on `StaffCustomer`; `deleted` on `CustomerSummary` (API decides, web hides phone/link); no `lastVisit` for EMPLOYEE; sign-in error copy and start-over; agenda sheet lifecycle; 403 → staff login; `next` keeps the query; consent tick needs an email. Footer copy became "The client gets a confirmation" (push counts).
- Deferred to 07b/08 (see `docs/handoff.md` "Carried into later plans"): FK index on `customer.private_notes_updated_by`, quick booking "today" frozen at mount, inactive service names on client history, hour ticks for non-whole-hour zones, enroll-step "Back to sign in" no-op on `/staff/login`, and the per-task minors.
