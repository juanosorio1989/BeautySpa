# Plan 04 — Booking API

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clients see real availability, hold a slot, book it after OTP, and list, cancel, reschedule or repeat their appointments; reception books by phone, walks clients in, moves appointments and changes their status from the day agenda; customers can export or delete their data. Double booking stays impossible.

**Architecture:** A new `booking` module (plus a `customers` module) on the existing guard, tenancy, audit and problem filter. One `BookingContextService` turns database rows into the engine's `Context`; every write goes through `AppointmentWriter`, which re-validates the exact plan with `validatePlan` inside the transaction, inserts segments with the plan's `blockEnd`, and maps `23P01` to `SLOT_TAKEN`. Notifications are a `BookingEvents` port called after commit (logging no-op now; plan 05 implements it).

**Tech Stack:** NestJS 11, Prisma 6, Zod 3 + `nestjs-zod`, `@beautyspa/availability`, `@beautyspa/datetime`, Vitest + supertest against real Postgres/Redis.

**Spec:** `docs/superpowers/specs/2026-11-17-mvp-design/` — `availability.md` (whole page), `api.md` (Public, Client, Staff agenda/customers/appointments), `flows.md` (online booking, reception, walk-in, cancel/reschedule, hold lifecycle), `data-model.md` (Customers, Appointments, no double booking), `security-quality.md` (Privacy).

**Branch:** `feat/mvp-04-booking`

## Routing

Main session: Opus 5.5 (orchestrates, does not implement normal tasks).

| Task | What | Implementer | Reviewer | Why |
|---|---|---|---|---|
| 1 | Contracts: availability query, holds, appointments, customer, agenda | implementer-sonnet | reviewer-opus | schemas fully specified |
| 2 | Optional auth, `Clock`, booking errors, booking test fixture | **implementer-opus** | reviewer-opus | auth guard change (Opus rule) |
| 3 | `BookingContextService` and `GET /availability` | implementer-sonnet | reviewer-opus | read-only, rules listed |
| 4 | `AppointmentWriter`, `POST /holds`, hold sweeper | **implementer-opus** | reviewer-opus | writes production data |
| 5 | `POST /appointments`, `BookingEvents`, `GET /me/appointments` | **implementer-opus** | reviewer-opus | writes production data |
| 6 | Customer cancel, reschedule, repeat | **implementer-opus** | reviewer-opus | writes production data |
| 7 | Staff create, move, status, walk-in | **implementer-opus** | reviewer-opus | writes production data |
| 8 | Staff agenda and customers (search, create with consent) | implementer-sonnet | reviewer-opus | reads + one plain create, rules listed |
| 9 | `/me` profile, export, delete | **implementer-opus** | reviewer-opus | anonymizes production data |
| 10 | RBAC matrix, docs, plan index | implementer-sonnet | reviewer-opus | test table + docs |

Production-data branch: **two independent final branch reviews** (`reviewer-opus`, fresh context each, no shared conclusions).

## Design calls (made in this plan; the spec is updated in the task that implements each)

1. **Availability query** takes `services` repeated, each `"<serviceId>:<employeeId|ANY>"` (`?services=a:ANY&services=b:<id>&date=2026-12-01`), one `date` per call (no `from`/`to` in the MVP; the date strip calls per day). (Tasks 1, 3, `api.md`)
2. **Mode comes from the token**: no token or a customer token → `ONLINE`; a staff token → `STAFF` (no lead time, no horizon, non-online employees/services included; no `override` on reads). `excludeAppointmentId` needs a token: a customer must own the appointment, staff any in the org; otherwise 404; no token → 401. (Tasks 2, 3)
3. **Expired holds are free for reads**: availability ignores segments of `HELD` appointments whose `hold_expires_at <= now`. Every write transaction first releases all expired holds of the org (a superset of "those that overlap"; idempotent). (Tasks 3, 4)
4. **Holds carry concrete segments**: the hold body is `{ locationId?, segments }` copied from a slot; validation uses `choices = segments.map(s => ({ serviceId, employeeId }))`. A hold has no customer; `POST /appointments` attaches the caller. (Task 4)
5. **Validation failures map to two answers**: `EMPLOYEE_UNAVAILABLE`, `RESOURCE_UNAVAILABLE`, `TOO_SOON` → 409 `SLOT_TAKEN` (the client refreshes slots); `NOT_QUALIFIED`, `NOT_BOOKABLE_ONLINE`, `BEYOND_HORIZON`, `MALFORMED_PLAN` → 400 `VALIDATION_FAILED` path `segments`. (Task 4)
6. **Reschedule and move delete the old segments** and insert the new plan in one transaction (the spec's "old segments `occupies = false`" would leave stale rows inside the appointment); the audit row keeps the old plan in `before`. Status changes still use `occupies = false`. (Tasks 4, 6, 7, `data-model.md`, `flows.md`)
7. **Status transitions**: `BOOKED → CHECKED_IN | COMPLETED | NO_SHOW | CANCELLED`; `CHECKED_IN → COMPLETED | CANCELLED`; everything else 409 `CONFLICT`. `NO_SHOW` only once `now >= startsAt`. Staff cancel ignores the cancel window. EMPLOYEE: own appointments (a segment of theirs), `CHECKED_IN`/`COMPLETED` only, else 403. (Task 7, `api.md`)
8. **Cancel window**: customer cancel or reschedule is allowed while `now <= startsAt - cancelWindowHours` (equality allowed), else 409 `OUTSIDE_CANCEL_WINDOW`. Cancel and reschedule increment `manage_version`. (Task 6)
9. **Walk-in** takes the first slot from `findSlots` (`STAFF`, today in the location zone) whose start is `<= floor(now to grid) + slotIntervalMin`; none → 409 `SLOT_TAKEN` ("No free slot right now"). Status `CHECKED_IN`, source `WALK_IN`; `customerId` may be null. (Task 7)
10. **Customer audit rows hold no personal data**: `customer.*` audits store `{ fields: [changed keys] }` in `after` (and `before: null`), so deleting an account leaves no name, phone or email in `audit_log`. (Tasks 8, 9)
11. **Account deletion** (`DELETE /me`): `name`, `email`, `private_notes_enc` → null, `phone_e164` → `"deleted:<customerId>"` (frees the number), `deleted_at` = now, future `BOOKED` appointments cancelled (`cancel_reason "ACCOUNT_DELETED"`), the customer's `appointment.notes` → null, one `granted:false` consent row (source `PROFILE`) per channel currently granted, refresh tokens revoked. Appointment rows stay attached to the anonymized customer. (Task 9, `security-quality.md`)
12. **Hold sweeper runs in-process** for now: `HoldSweeper` calls `releaseExpiredHolds` every `HOLD_SWEEP_INTERVAL_MS` (default 60000, `0` disables; tests use 0). Plan 05 moves it to the BullMQ `maintenance` queue with the worker entrypoint. (Task 4, `architecture.md`)
13. **Time comes from `Clock`** (`CLOCK` token, `{ now(): number }`, default `Date.now`), so integration tests pin `now`. Booking code never calls `Date.now()`. (Task 2)

## Global Constraints

- Everything from plans 01–03 still holds (strict TS, English only, no secrets committed or logged, problem+json via `ProblemFilter`, services throw `HttpException`s with `{ code }`, every handler has an auth decorator, every query filters by `orgId`, `IdPipe` on `:id`, `createZodDto` DTOs with `@ApiOkResponse`, creates 201).
- The engine works in epoch ms (`start`/`end`/`blockEnd`); the API speaks ISO (`startsAt`/`endsAt`/`blockEndsAt`, `toISOString()` output). Convert only in `src/booking/plan-mapping.ts`.
- `appointment_segment.block_ends_at` is always the validated plan's `blockEnd`, never recomputed. `organization_id` of appointments and segments comes from the location row, never the body.
- `occupies` becomes false in the same transaction as `CANCELLED` / `NO_SHOW`.
- Every appointment write records one audit row in its transaction: actions `appointment.hold`, `appointment.create`, `appointment.reschedule` (customer), `appointment.move` (staff), `appointment.status`, `appointment.cancel`; `entity "appointment"`, `entityId` = id; `before`/`after` = the `Appointment` response shape (with `override: true` added to `after` when staff used it). Customers act as `actorType "CUSTOMER"`, the sweeper as `"SYSTEM"` (one audit row per sweep run with `after: { released: n }`, only when `n > 0`).
- `BookingEvents` methods run after commit and never fail the request (errors are logged).
- Each task ends with green `pnpm turbo run lint typecheck test` and `pnpm --filter @beautyspa/api test:int`; docs change in the same commit.

## Review Focus

1. **Two clients hold the same slot at the same moment** → exactly one 201, the other 409 `SLOT_TAKEN`, never 500 and never two rows (test in Task 4).
2. **A hold that expires before confirming** → `POST /appointments` answers 409 `HOLD_EXPIRED`, and another client can hold that slot right away without waiting for the sweeper (tests in Tasks 4, 5).
3. **Rescheduling 15 minutes later, overlapping its own old time**, succeeds; rescheduling onto a taken slot answers 409 and leaves the old time booked and occupying (tests in Task 6).
4. **Another customer's appointment id** in cancel, reschedule, repeat or `excludeAppointmentId` → 404, with nothing changed and nothing revealed (tests in Tasks 3, 6).
5. **A deleted account's phone number** can verify OTP again and gets a new, empty customer; the old appointments stay for the salon without name or phone (test in Task 9).

---

### Task 1: Contracts — availability query, holds, appointments, customer, agenda

**Files:**
- Modify: `packages/contracts/src/availability.ts`, `packages/contracts/src/index.ts`
- Create: `packages/contracts/src/booking.ts`, `packages/contracts/src/customer.ts`, `booking.test.ts`, `customer.test.ts` (in `packages/contracts/src/`); add cases to `availability.test.ts`

**Interfaces — Produces** (each with `type X = z.infer<typeof XSchema>`):
- `availability.ts`: `AvailabilityQuerySchema { locationId?: Id, services, date: IsoDate, excludeAppointmentId?: Id }` where `services` preprocesses a single value into an array, then `z.array(ServiceChoiceInputSchema).min(1).max(4)`; `ServiceChoiceInputSchema` = `ServiceChoiceSchema` or a string `"<uuid>:<uuid|ANY>"` transformed into `ServiceChoice` (bad string → issue `"Expected serviceId:employeeId|ANY"`). Output type of `services` is `ServiceChoice[]`.
- `booking.ts`:
  - `AppointmentStatusSchema = z.enum(["HELD","BOOKED","CHECKED_IN","COMPLETED","CANCELLED","NO_SHOW"])`; `AppointmentSourceSchema = z.enum(["ONLINE","RECEPTION","WALK_IN"])`
  - `PlanSegmentsSchema = z.array(PlannedSegmentSchema).min(1).max(4)`
  - `HoldInputSchema { locationId?: Id, segments: PlanSegments }`; `HoldSchema { holdId: Id, expiresAt: IsoInstant }`
  - `NotesSchema = z.string().trim().max(500)`; `BookInputSchema { holdId: Id, notes: NotesSchema.nullable().default(null) }`
  - `AppointmentSegmentSchema = PlannedSegmentSchema.extend({ id: Id })`
  - `AppointmentSchema { id, locationId, status, source, startsAt, endsAt, totalPriceCents: MoneyCents, notes: string|null, segments: AppointmentSegment[], confirmedByCustomerAt: IsoInstant|null, cancelledAt: IsoInstant|null, cancelReason: string|null, createdAt: IsoInstant }` (`startsAt` = min segment start, `endsAt` = max segment end)
  - `CustomerSummarySchema { id, name: string|null, phoneE164: string }`; `StaffAppointmentSchema = AppointmentSchema.extend({ customer: CustomerSummary.nullable(), createdByStaffId: Id.nullable(), cancelledBy: z.enum(["STAFF","CUSTOMER","SYSTEM"]).nullable() })`
  - `MyAppointmentsSchema { upcoming: Appointment[], past: Appointment[] }`
  - `CancelInputSchema { reason: z.string().trim().max(200).nullable().default(null) }`; `RescheduleInputSchema { segments: PlanSegments }`
  - `RepeatSchema { locationId: Id, services: ServiceChoice[] }`
  - `StaffAppointmentInputSchema { customerId: Id, locationId?: Id, segments: PlanSegments, notes: Notes nullable default null, override: z.boolean().default(false) }`
  - `StaffAppointmentPatchSchema { segments: PlanSegments, override: z.boolean().default(false) }`
  - `StatusChangeSchema { status: z.enum(["CHECKED_IN","COMPLETED","NO_SHOW","CANCELLED"]), reason: z.string().trim().max(200).nullable().default(null) }`
  - `WalkInInputSchema { customerId: Id.nullable().default(null), locationId?: Id, services: z.array(ServiceChoiceSchema).min(1).max(4), notes: Notes nullable default null }`
  - `AgendaQuerySchema { date: IsoDate, locationId?: Id, employeeId?: Id }`; `AgendaSchema { date, locationId, timezone, appointments: StaffAppointment[] }`
- `customer.ts`:
  - `ChannelSchema = z.enum(["WHATSAPP","SMS","EMAIL"])`; `ConsentsSchema = z.object({ WHATSAPP: z.boolean(), SMS: z.boolean(), EMAIL: z.boolean() })`
  - `MeSchema { id, phoneE164, name: string|null, email: string|null, locale: Locale, consents: Consents }`
  - `CustomerNameSchema = z.string().trim().min(1).max(80)`
  - `MePatchSchema { name?: CustomerName, email?: EmailSchema.nullable(), locale?: Locale, consents?: ConsentsSchema.partial() }` + empty-update refine (`"Empty update"`)
  - `CustomerExportSchema { customer: Me, consentHistory: [{ channel, granted, source: z.enum(["BOOKING_FORM","PROFILE","RECEPTION","INBOUND_STOP"]), changedAt: IsoInstant }], appointments: Appointment[] }`
  - `CustomerSearchQuerySchema { q: z.string().trim().min(2).max(80) }`
  - `StaffCustomerSchema = MeSchema` (same fields); `StaffCustomerCreateSchema { name: CustomerName, phone: PhoneE164Schema, locale: Locale, email: EmailSchema.nullable().default(null), consents: ConsentsSchema.partial().default({}) }`

- [ ] **Step 1: Write failing tests:**
  - `AvailabilityQuerySchema.parse({ services: "<sid>:ANY", date: "2026-12-01" }).services` deep-equals `[{ serviceId: sid, employeeId: "ANY" }]`; two strings → two choices; `"<sid>"` alone fails at `services.0`; five services fail; `excludeAppointmentId: "x"` fails.
  - `HoldInputSchema` with 0 or 5 segments fails; `BookInputSchema.parse({ holdId }).notes === null`; notes of 501 chars fail.
  - `StatusChangeSchema` rejects `"BOOKED"` and `"HELD"`; `StaffAppointmentInputSchema.parse(...).override === false`.
  - `MePatchSchema.parse({})` fails; `{ consents: { WHATSAPP: true } }` passes; `{ name: "  " }` fails.
  - `StaffCustomerCreateSchema` with `phone "3055550100"` fails; defaults `email null`, `consents {}`.
- [ ] **Step 2: Run** `pnpm --filter @beautyspa/contracts test` · Expected: FAIL (modules not found).
- [ ] **Step 3: Implement** the schemas; export `booking` and `customer` from `index.ts`.
- [ ] **Step 4: Run** `pnpm turbo run lint typecheck test build --filter=@beautyspa/contracts` · Expected: PASS.
- [ ] **Step 5: Commit** — `feat(contracts): booking, appointment, customer and agenda schemas`

---

### Task 2: Optional auth, `Clock`, booking errors, booking test fixture (Opus)

**Files:**
- Modify: `apps/api/src/auth/decorators.ts`, `apps/api/src/auth/access.guard.ts`, `apps/api/src/common/db-errors.ts`, `apps/api/src/common/http-errors.ts`, `apps/api/test/integration/helpers.ts`
- Create: `apps/api/src/common/clock.ts`, `apps/api/src/common/common.module.ts` (global; provides `CLOCK`), `apps/api/test/integration/auth/optional-auth.int.test.ts`
- Modify: `apps/api/src/app.module.ts` (import `CommonModule`), `apps/api/src/common/db-errors.test.ts`

**Interfaces — Produces:**
- `OptionalAuth()` decorator: policy `{ kind: "optional" }`. Guard: no `authorization` header → allow, `principal` undefined; a header present → verify exactly like other policies (bad/expired/other-org token → 401), any kind/role allowed, `principal` set.
- `clock.ts`: `export const CLOCK = Symbol("CLOCK")`; `export interface Clock { now(): number }`; `systemClock: Clock = { now: () => Date.now() }`. `CommonModule` is `@Global()` and provides `{ provide: CLOCK, useValue: systemClock }`.
- `db-errors.ts`: `isExclusionViolation(err): boolean` (`pgCode(err) === "23P01"`).
- `http-errors.ts`: `slotTaken(message = "That time is no longer available"): ConflictException` (`code "SLOT_TAKEN"`); `holdExpired(): ConflictException` (`"HOLD_EXPIRED"`); `outsideCancelWindow(): ConflictException` (`"OUTSIDE_CANCEL_WINDOW"`); `conflict(message: string): ConflictException` (`"CONFLICT"`).
- `helpers.ts`:
  - `customerSession(app, f: Fixture, customerId?: string): Promise<{ id: string; token: string }>` — token via `TokenService.issueAccess({ sub, typ: "customer", org: f.orgId, role: "CUSTOMER" })`; default `f.customerId`.
  - `fixedClock(ms: number): Clock & { set(ms: number): void }`; integration apps that book pass `override: (b) => b.overrideProvider(CLOCK).useValue(clock)`.
  - `BOOKING_NOW = Date.parse("2026-11-30T12:00:00.000Z")` (Monday 07:00 in New York); `BOOKING_DATE = "2026-12-01"` (Tuesday, EST, 09:00 local = `14:00Z`).
  - `seedBookingFixture(prisma): Promise<BookingFixture>` where `BookingFixture = Fixture & { maniId: string; pediId: string }`. On top of `seedFixture`: location hours weekdays 1–6 `09:00–19:00`; `f.serviceId` (= `pediId`, 60 min, chair) set `parallelizable: true`; new service "Manicure" 30 min, buffer 5, 2500¢, parallelizable, no resource (`maniId`); `staffA` and `staffB` get a profile (`displayName` "Alex"/"Blair", `bookableOnline` true, no level), `staff_location` at the fixture location, working hours weekdays 2–6 `09:00–19:00`, and both services. Location settings stay `{}` (defaults: slot 15, hold 5, cancel window 24, horizon 60, lead 60).

- [ ] **Step 1: Write failing tests:**
  - `optional-auth.int.test.ts` (a test-only controller in the file, `@OptionalAuth()` `GET /v1/test/optional` returning `{ sub: principal?.sub ?? null }`, added through `createIntegrationApp({ imports: [...] })`): no header → 200 `{ sub: null }`; customer token → its `sub`; staff token → its `sub`; `Bearer garbage` → 401; a token signed for another org id → 401.
  - `db-errors.test.ts`: a message containing `code: "23P01"` → `isExclusionViolation` true; `"23505"` → false.
- [ ] **Step 2: Run** `pnpm --filter @beautyspa/api test && pnpm --filter @beautyspa/api test:int test/integration/auth/optional-auth.int.test.ts` · Expected: FAIL.
- [ ] **Step 3: Implement** the policy, clock, errors and helpers.
- [ ] **Step 4: Run** `pnpm turbo run lint typecheck test && pnpm --filter @beautyspa/api test:int` · Expected: PASS (existing RBAC matrix unchanged).
- [ ] **Step 5: Commit** — `feat(api): optional auth policy, injectable clock, booking error helpers`

---

### Task 3: `BookingContextService` and `GET /availability`

**Files:**
- Create: `apps/api/src/booking/booking.module.ts`, `booking-context.service.ts`, `plan-mapping.ts`, `plan-mapping.test.ts`, `availability.controller.ts`, `availability.service.ts` (in `apps/api/src/booking/`)
- Modify: `apps/api/src/app.module.ts`; move `readLocationSettings` from `src/locations/settings.service.ts` to `src/common/location-settings.ts` (re-export from the old place is not needed; update its importers)
- Test: `apps/api/test/integration/booking/availability.int.test.ts`
- Docs: `api.md` (design calls 1–3)

**Interfaces:**
- Consumes: Task 1 `AvailabilityQuery`, `Slot`; Task 2 `OptionalAuth`, `CLOCK`, `seedBookingFixture`, `fixedClock`, `customerSession`; `LocationService.resolve`; `dayHoursFromRows`; `readLocationSettings`; engine `findSlots`, `Context`, `AvailabilityError`.
- Produces:
  - `plan-mapping.ts`: `toSlotDto(s: engine.Slot): Slot`; `toEngineSegments(segments: PlannedSegment[]): engine.PlannedSegment[]` (`Date.parse` each instant); `choicesOf(segments): ServiceChoice[]` (concrete employee per segment).
  - `BookingContextService.load(db: Prisma.TransactionClient | PrismaService, orgId: string, location: { id: string; timezone: string }, opts: { mode: Mode; now: number; date: IsoDate; excludeAppointmentId?: string; override?: boolean }): Promise<Context>`
  - `AvailabilityService.slots(principal: AccessClaims | undefined, query: AvailabilityQuery): Promise<Slot[]>`; `GET /availability` (`@OptionalAuth()`) → `Slot[]`, rate-limited per IP: key `availability:ip:<hash>`, 120 per 60 s.

Loader rules (`load`):
- Window `W = [dayStart − 24 h, dayEnd + 24 h)` from `localDayBoundsUtc(date, timezone)`.
- `location`: `timezone`; `slotIntervalMin`, `minLeadMinutes`, `bookingHorizonDays` from `readLocationSettings`; `hours` = `dayHoursFromRows(location_hours)`; `closures` = `location_closure` rows of the location overlapping `W`, as ms intervals.
- `employees`: active `staff_user` of the org with an `employee_profile`, assigned to the location; `bookableOnline` from the profile (the engine applies it in `ONLINE`); `levelId` from the profile; `serviceIds` = their `employee_service` rows whose service is active; `workingHours` = `dayHoursFromRows` of their rows at this location; `timeOff` = their `time_off` rows with `location_id` null or this location, overlapping `W`.
- `services`: active services of the org with `levelOverrides` from `service_level_price` (`{ [levelId]: { durationMin, priceCents } }`).
- `resources`: active resources of the location (`id`, `resourceTypeId`, `name`).
- `busy`: segments of the org with `occupies`, `starts_at < W.end`, `block_ends_at > W.start`, `appointment_id <> excludeAppointmentId`, excluding segments of `HELD` appointments with `hold_expires_at <= now` (design call 3). Employee busy time counts at every location; resource rows are location-bound by id.
- `mode`, `now`, `override` copied from `opts`.

`AvailabilityService.slots`: `mode = principal?.typ === "staff" ? "STAFF" : "ONLINE"`; `excludeAppointmentId` without principal → 401 `UNAUTHORIZED`; with a customer principal the appointment must have `customer_id = sub` in the org, with staff it must be in the org, else `notFound("Appointment")`; `AvailabilityError` (`UNKNOWN_SERVICE`, `UNKNOWN_EMPLOYEE`) → `invalidRef("services", "Unknown service or employee")`.

- [ ] **Step 1: Write failing tests** (`availability.int.test.ts`, clock at `BOOKING_NOW`, query `services=<pedi>:ANY&date=2026-12-01`):
  - First slot `startsAt "2026-12-01T14:00:00.000Z"`, last starts `23:00Z` (18:00 local, 60 min ends at close), step 15 min (37 slots); each segment has `resourceId` = Chair 1 and `blockEndsAt == endsAt` (no buffer).
  - Mani + pedi (both `ANY`): first slot has two segments starting at `14:00Z` with different employees (parallel).
  - With both employees busy 14:00–15:00Z (`bookSegment`), the first single-pedi slot is `15:00Z`.
  - A `HELD` appointment with `holdExpiresAt` before `BOOKING_NOW` does not block; one expiring after it does.
  - A `time_off` row for staffA with `locationId null` hides staffA for an explicit `services=<pedi>:<staffA>` query in that range.
  - Clock at `2026-12-01T14:30:00Z` (09:30 local): first slot is `15:30Z` (60 min lead); with a staff token the first is `14:30Z`.
  - `date` 61 days after the clock's local date → `[]` online; staff token → slots.
  - `excludeAppointmentId` of the fixture customer's appointment: no token → 401; another customer's token → 404; the owner's token → the appointment's own time is offered again; staff token → 200.
  - Unknown service id → 400 path `services`; `services=bad` → 400.
- [ ] **Step 2: Run** `pnpm --filter @beautyspa/api test:int test/integration/booking/availability.int.test.ts` · Expected: FAIL.
- [ ] **Step 3: Implement** module, loader, mapping, controller.
- [ ] **Step 4: Run** `pnpm turbo run lint typecheck test && pnpm --filter @beautyspa/api test:int` · Expected: PASS.
- [ ] **Step 5: Update `api.md`**, then commit — `feat(api): availability endpoint on the booking context loader`

---

### Task 4: `AppointmentWriter`, `POST /holds`, hold sweeper (Opus)

**Files:**
- Create: `apps/api/src/booking/appointment-writer.ts`, `appointment-mapping.ts`, `holds.controller.ts`, `holds.service.ts`, `hold-sweeper.ts` (in `apps/api/src/booking/`)
- Modify: `apps/api/src/booking/booking.module.ts`, `apps/api/src/config/env.ts` (`HOLD_SWEEP_INTERVAL_MS`: `z.coerce.number().int().min(0).default(60000)`), `apps/api/test/support/test-env.ts` (`HOLD_SWEEP_INTERVAL_MS: "0"`), `.env.example`
- Test: `apps/api/test/integration/booking/holds.int.test.ts`
- Docs: `architecture.md` (design call 12), `data-model.md` (design call 6)

**Interfaces:**
- Consumes: Task 3 `BookingContextService.load`, `toEngineSegments`, `choicesOf`; Task 2 errors, `CLOCK`; engine `validatePlan`; `RateLimitService`, `AuditService`.
- Produces:
  - `releaseExpiredHolds(tx: Prisma.TransactionClient, orgId: string | null, now: Date): Promise<number>` (exported function in `appointment-writer.ts`): every `HELD` appointment (of the org, or all orgs when `null`) with `hold_expires_at <= now` → `CANCELLED`, `cancelled_at = now`, `cancelled_by SYSTEM`, `cancel_reason "HOLD_EXPIRED"`, `hold_expires_at` kept, its segments `occupies = false`. Two statements, no per-row loop.
  - `AppointmentWriter.validateOrThrow(ctx: Context, segments: engine.PlannedSegment[]): void` — `validatePlan(ctx, choicesOf(segments), segments)`; failure mapped per design call 5 (`slotTaken()` / `invalidRef("segments", <reason>)`).
  - `AppointmentWriter.insertSegments(tx, appt: { id: string; organizationId: string }, segments: engine.PlannedSegment[]): Promise<void>` — `createMany` with `blockEndsAt = new Date(seg.blockEnd)`; `isExclusionViolation` → `slotTaken()`.
  - `AppointmentWriter.replaceSegments(tx, appt, segments)` — `deleteMany` the appointment's segments, then `insertSegments` (used by Tasks 6, 7).
  - `appointment-mapping.ts`: `APPOINTMENT_INCLUDE` (Prisma include: segments ordered by `startsAt`, customer); `toAppointmentDto(row): Appointment`; `toStaffAppointmentDto(row): StaffAppointment`.
  - `HoldsService.create(input: HoldInput, ip: string | null): Promise<Hold>`; `POST /holds` (`@Public()`, 201), rate limit key `holds:ip:<hash>`, 30 per 600 s.
  - `HoldSweeper` (`OnApplicationBootstrap`/`OnApplicationShutdown`): when the interval is > 0, `setInterval(() => sweep(), ms)` (`unref()`); `sweep(): Promise<number>` runs `releaseExpiredHolds(tx, null, new Date(clock.now()))` in a transaction and audits per design rules (`actorType "SYSTEM"`, `action "appointment.hold_release"`, `entity "appointment"`, `entityId null`).

`HoldsService.create` (one transaction): resolve location → `releaseExpiredHolds(tx, org, now)` → `load(tx, …, { mode: "ONLINE", now, date: local date of the earliest segment })` → `validateOrThrow` → create appointment `HELD`, source `ONLINE`, `customerId null`, `holdExpiresAt = now + holdMinutes`, `organizationId`/`locationId` from the location → `insertSegments` → audit `appointment.hold` (`actorType "CUSTOMER"`, `actorId null`). Returns `{ holdId, expiresAt }`.

- [ ] **Step 1: Write failing tests** (`holds.int.test.ts`; slot taken from `GET /availability`):
  - Hold the first pedi slot → 201, `expiresAt` = clock + 5 min; DB: appointment `HELD`, one segment, `occupies true`, `blockEndsAt` equals the slot's.
  - `Promise.all` of two holds for the same slot → statuses sorted `[201, 409]`, the 409 body `code "SLOT_TAKEN"`, one `HELD` row.
  - A hold whose clock passed `expiresAt` blocks nothing: advance the clock 6 min, hold the same slot again → 201, and the first appointment is now `CANCELLED` with `cancelReason "HOLD_EXPIRED"` and segments `occupies false`.
  - Tampered segments: `priceCents` changed → 400 path `segments`; `startsAt` shifted 1 min off grid → 400; an employee not qualified → 400; a slot inside a closure (`location_closure` row) → 409 `SLOT_TAKEN`.
  - `holdMinutes: 10` in location settings → `expiresAt` = clock + 10 min.
  - 31st hold from one IP inside 10 minutes → 429 `RATE_LIMITED`.
  - `HoldSweeper.sweep()` with two expired holds and one live → returns 2; one `appointment.hold_release` audit row with `after.released === 2`; a second sweep returns 0 and adds no audit row.
- [ ] **Step 2: Run** `pnpm --filter @beautyspa/api test:int test/integration/booking/holds.int.test.ts` · Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm turbo run lint typecheck test && pnpm --filter @beautyspa/api test:int` · Expected: PASS.
- [ ] **Step 5: Update docs**, then commit — `feat(api): holds with in-transaction plan validation and hold sweeper`

---

### Task 5: `POST /appointments`, `BookingEvents`, `GET /me/appointments` (Opus)

**Files:**
- Create: `apps/api/src/booking/booking-events.ts`, `appointments.controller.ts`, `appointments.service.ts`, `my-appointments.controller.ts`, `my-appointments.service.ts` (in `apps/api/src/booking/`)
- Modify: `apps/api/src/booking/booking.module.ts`
- Test: `apps/api/test/integration/booking/book.int.test.ts`

**Interfaces:**
- Consumes: Task 4 `APPOINTMENT_INCLUDE`, `toAppointmentDto`, `holdExpired`, `conflict`; Task 2 `customerSession`.
- Produces:
  - `booking-events.ts`: `export abstract class BookingEvents { abstract booked(appointmentId: string): Promise<void>; abstract changed(appointmentId: string): Promise<void>; abstract cancelled(appointmentId: string): Promise<void> }`; `LoggingBookingEvents` (logs `booking.<event> <id>` at debug); module provides `{ provide: BookingEvents, useClass: LoggingBookingEvents }`; `notifyAfterCommit(events, logger, fn: () => Promise<void>): Promise<void>` swallows and logs errors.
  - `AppointmentsService.book(principal: AccessClaims, input: BookInput, ip): Promise<Appointment>`; `POST /appointments` (`@CustomerAuth()`, 201), rate limit `book:customer:<sub>` 10 per 3600 s.
  - `MyAppointmentsService.list(principal): Promise<MyAppointments>`; `GET /me/appointments` (`@CustomerAuth()`).

`book` (one transaction): lock `SELECT … FOR UPDATE` the appointment by `holdId` in the org; none → `notFound("Hold")`; `CANCELLED` with `cancelReason "HOLD_EXPIRED"`, or `HELD` with `holdExpiresAt <= now` → `holdExpired()`; any other non-`HELD` status → `conflict("Hold already used")`; customer `name` null → `invalidRef("name", "Name is required before booking")`. Update: `status BOOKED`, `customerId = sub`, `holdExpiresAt null`, `notes`. Audit `appointment.create` (`actorType "CUSTOMER"`, `actorId sub`). After commit `events.booked(id)`. 201 with `Appointment`.

`list`: the customer's appointments except `HELD`; `upcoming` = status `BOOKED` or `CHECKED_IN` with `endsAt > now`, ascending by `startsAt`; `past` = all others, descending, at most 50.

- [ ] **Step 1: Write failing tests** (`book.int.test.ts`):
  - Hold then book with notes → 201, `status "BOOKED"`, `totalPriceCents 4000`, `segments[0].blockEndsAt` equals the hold's; DB `customerId` set, `holdExpiresAt null`; audit `appointment.create` with `actorType "CUSTOMER"`; a spy `BookingEvents` (override provider) got `booked(id)` once.
  - Book the same hold again → 409 `CONFLICT`. Unknown `holdId` → 404.
  - Advance clock 6 min, book → 409 `HOLD_EXPIRED`; after the sweeper released it, booking still → 409 `HOLD_EXPIRED`.
  - Customer with `name null` → 400 path `name`, hold still `HELD`.
  - A `BookingEvents` whose `booked` throws → still 201.
  - Staff token → 403; no token → 401.
  - `GET /me/appointments`: one future `BOOKED`, one past `COMPLETED`, one `CANCELLED` future, another customer's, and a `HELD` row → `upcoming` length 1, `past` length 2 (the future cancelled one first, then the completed one: `startsAt` desc), nothing of the other customer.
- [ ] **Step 2: Run** `pnpm --filter @beautyspa/api test:int test/integration/booking/book.int.test.ts` · Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm turbo run lint typecheck test && pnpm --filter @beautyspa/api test:int` · Expected: PASS.
- [ ] **Step 5: Commit** — `feat(api): confirm a hold as a booking and list my appointments`

---

### Task 6: Customer cancel, reschedule, repeat (Opus)

**Files:**
- Modify: `apps/api/src/booking/my-appointments.controller.ts`, `my-appointments.service.ts`
- Test: `apps/api/test/integration/booking/my-appointment-changes.int.test.ts`
- Docs: `flows.md` (design calls 6, 8)

**Interfaces:**
- Consumes: Task 4 `AppointmentWriter.validateOrThrow`, `replaceSegments`, `releaseExpiredHolds`; Task 3 `BookingContextService.load`; Task 5 `BookingEvents`, `notifyAfterCommit`.
- Produces (`@CustomerAuth()`, `:id` with `IdPipe`):
  - `POST /me/appointments/:id/cancel` (`CancelInput`) → `Appointment`; `MyAppointmentsService.cancel(principal, id, input, ip)`.
  - `POST /me/appointments/:id/reschedule` (`RescheduleInput`) → `Appointment`; `.reschedule(principal, id, input, ip)`.
  - `POST /me/appointments/:id/repeat` → `Repeat`; `.repeat(principal, id)` (read-only, 200).

Rules (cancel and reschedule lock the appointment `FOR UPDATE`; not the caller's or not in the org → `notFound("Appointment")`):
- Both need `status BOOKED` (else `conflict("Appointment cannot be changed")`) and `now <= startsAt − cancelWindowHours·3600000` (else `outsideCancelWindow()`).
- Cancel: `CANCELLED`, `cancelledAt now`, `cancelledBy CUSTOMER`, `cancelReason`, segments `occupies false`, `manageVersion + 1`; audit `appointment.cancel`; `events.cancelled`.
- Reschedule: `releaseExpiredHolds` → `load(tx, …, { mode: "ONLINE", now, date: local date of new earliest segment, excludeAppointmentId: id })` → `validateOrThrow` → `replaceSegments` → `manageVersion + 1`; audit `appointment.reschedule` (`before` = old shape); `events.changed`. Any error rolls back the whole transaction.
- Repeat: services of the appointment in segment order; an inactive service is dropped; the employee is kept if they are still active, assigned to the location with a `bookableOnline` profile and qualified, else `"ANY"`. Any status allowed.

- [ ] **Step 1: Write failing tests:**
  - Cancel a booking starting 48 h after the clock → 200 `CANCELLED`; segments `occupies false`; `manageVersion` 1; the time shows again in `/availability`.
  - Cancel with the clock exactly 24 h before start → 200; 1 ms later → 409 `OUTSIDE_CANCEL_WINDOW`. Location `cancelWindowHours: 0` → allowed until start.
  - Reschedule 15 min later (overlapping its own old time, slot from `/availability?excludeAppointmentId=`) → 200 with the new `startsAt`; exactly the new segments exist; `manageVersion` 1; audit `before.startsAt` is the old time.
  - Reschedule onto a slot another booking took → 409 `SLOT_TAKEN`; the old segments still exist with `occupies true`, `manageVersion` 0.
  - Another customer's id → 404 on cancel, reschedule and repeat; DB unchanged.
  - Cancelling a `CANCELLED` appointment → 409 `CONFLICT`.
  - Repeat of mani (staffA) + pedi (staffB): staffB deactivated → `[{ mani, staffA }, { pedi, "ANY" }]`; mani deactivated → only pedi.
- [ ] **Step 2: Run** `pnpm --filter @beautyspa/api test:int test/integration/booking/my-appointment-changes.int.test.ts` · Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm turbo run lint typecheck test && pnpm --filter @beautyspa/api test:int` · Expected: PASS.
- [ ] **Step 5: Update `flows.md`**, then commit — `feat(api): customer cancel, reschedule and repeat`

---

### Task 7: Staff create, move, status, walk-in (Opus)

**Files:**
- Create: `apps/api/src/booking/staff-appointments.controller.ts`, `staff-appointments.service.ts`, `walk-in.service.ts` (in `apps/api/src/booking/`)
- Modify: `apps/api/src/booking/booking.module.ts`
- Test: `apps/api/test/integration/booking/staff-appointments.int.test.ts`, `apps/api/test/integration/booking/walk-in.int.test.ts`
- Docs: `api.md` (design calls 7, 9), `availability.md` (override recorded in audit `after.override`)

**Interfaces:**
- Consumes: Tasks 3–5 (`load`, `AppointmentWriter`, `releaseExpiredHolds`, `toStaffAppointmentDto`, `BookingEvents`); engine `findSlots`.
- Produces:
  - `POST /staff/appointments` (OWNER, RECEPTION; `StaffAppointmentInput`, 201) → `StaffAppointment`; `StaffAppointmentsService.create(principal, input, ip)`.
  - `PATCH /staff/appointments/:id` (OWNER, RECEPTION; `StaffAppointmentPatch`) → `StaffAppointment`; `.move(principal, id, patch, ip)`.
  - `POST /staff/appointments/:id/status` (`@StaffAuth()`; `StatusChange`) → `StaffAppointment`; `.changeStatus(principal, id, input, ip)`.
  - `POST /staff/walk-in` (OWNER, RECEPTION; `WalkInInput`, 201) → `StaffAppointment`; `WalkInService.create(principal, input, ip)`.

Rules:
- Create: `customerId` must be an org customer with `deletedAt null` (else `invalidRef("customerId", "Unknown customer")`); `load(…, { mode: "STAFF", override })` → `validateOrThrow` → appointment `BOOKED`, source `RECEPTION`, `createdByStaffId = sub` → `insertSegments`; audit `appointment.create` (`after.override` when true); `events.booked`.
- Move: status `BOOKED` or `CHECKED_IN` (else `conflict`); same as customer reschedule but `STAFF` mode with `override`, no window check; `manageVersion + 1`; audit `appointment.move`; `events.changed`.
- Status: design call 7; `CANCELLED` sets `cancelledBy STAFF`, `cancelReason`, `manageVersion + 1`, `occupies false` (also for `NO_SHOW`); audit `appointment.status` (`before.status` → `after.status`), `events.cancelled` only for `CANCELLED`.
- Walk-in: `customerId` checked like create when given; `findSlots({ ...load(…, { mode: "STAFF", date: today in the location zone }), choices: services, date })`; first slot per design call 9; insert `CHECKED_IN`, source `WALK_IN`, `createdByStaffId`; audit `appointment.create`; `events.booked`.

- [ ] **Step 1: Write failing tests:**
  - RECEPTION creates pedi for the fixture customer 10:00 local → 201 `source "RECEPTION"`, `createdByStaffId` set, `customer.name "Ana"`.
  - Staff create at 08:00 local (before hours): without `override` → 409 `SLOT_TAKEN`; with `override: true` → 201 and audit `after.override === true`. Overlapping an existing booking of the same employee with `override` → 409 `SLOT_TAKEN` (DB constraint).
  - Staff create inside the 60-min lead time (clock 09:30 local, slot 09:45) → 201.
  - Another org's / deleted customer → 400 path `customerId`.
  - Move to 11:00 → 200; `manageVersion` 1; audit `appointment.move`.
  - Status: `BOOKED → CHECKED_IN → COMPLETED` → 200 each; `COMPLETED → CANCELLED` → 409; `NO_SHOW` before start → 409, after → 200 and `occupies false`; staff `CANCELLED` inside the cancel window → 200.
  - EMPLOYEE (staffA's own session via `TokenService`): check-in own → 200; cancel own → 403; check-in staffB's → 403.
  - EMPLOYEE `POST /staff/appointments` → 403.
  - Walk-in at clock 10:07 local with pedi `ANY` → 201, `status "CHECKED_IN"`, `startsAt` 10:00 local (grid floor). Both chairs busy until 10:15 → `startsAt` 10:15 local. Both chairs busy until 10:30 (beyond `floor + 15 min`) → 409 `SLOT_TAKEN`. `customerId: null` → 201 with `customer null`.
- [ ] **Step 2: Run** `pnpm --filter @beautyspa/api test:int test/integration/booking/staff-appointments.int.test.ts test/integration/booking/walk-in.int.test.ts` · Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm turbo run lint typecheck test && pnpm --filter @beautyspa/api test:int` · Expected: PASS.
- [ ] **Step 5: Update docs**, then commit — `feat(api): staff booking, move, status changes and walk-in`

---

### Task 8: Staff agenda and customers

**Files:**
- Create: `apps/api/src/booking/agenda.controller.ts`, `agenda.service.ts` (in `apps/api/src/booking/`); `apps/api/src/customers/customers.module.ts`, `staff-customers.controller.ts`, `staff-customers.service.ts`, `consents.ts` (in `apps/api/src/customers/`)
- Modify: `apps/api/src/app.module.ts`, `apps/api/src/booking/booking.module.ts`
- Test: `apps/api/test/integration/booking/agenda.int.test.ts`, `apps/api/test/integration/customers/staff-customers.int.test.ts`

**Interfaces:**
- Consumes: Task 1 `Agenda*`, `StaffCustomer*`, `Consents`; Task 4 `toStaffAppointmentDto`; `LocationService`.
- Produces:
  - `GET /staff/agenda` (`@StaffAuth()`; `AgendaQuery`) → `Agenda`; `AgendaService.day(principal, query)`.
  - `consents.ts`: `currentConsents(db, customerId): Promise<Consents>` (latest row per channel, missing = false); `recordConsents(tx, orgId, customerId, wanted: Partial<Consents>, source): Promise<Channel[]>` appends a row only for channels whose value differs from current, returns them; `toCustomerDto(row, consents): StaffCustomer` (also used for `Me` in Task 9).
  - `GET /staff/customers?q=` (`@StaffAuth()`) → `StaffCustomer[]`; `POST /staff/customers` (OWNER, RECEPTION; 201) → `StaffCustomer`. `StaffCustomersService.search(principal, q)`, `.create(principal, input, ip)`.

Rules:
- Agenda: location resolved; appointments with status `BOOKED`, `CHECKED_IN`, `COMPLETED`, `NO_SHOW` whose earliest segment starts inside the local day; sorted by `startsAt`. `employeeId` filters to appointments with a segment of that employee. EMPLOYEE: forced to own; another `employeeId` → 403.
- Search: not deleted; `q` matches `name` (`contains`, case-insensitive) or, when `q` has ≥ 4 digits, `phone_e164` containing those digits; sort by name; at most 20. EMPLOYEE: only customers with a non-`HELD` appointment that has a segment of theirs.
- Create: `createdVia RECEPTION`, `phoneVerifiedAt null`; duplicate phone in org → 409 `CONFLICT`; consents via `recordConsents(…, source "RECEPTION")` for the `true` channels; audit `customer.create` per design call 10.

- [ ] **Step 1: Write failing tests:**
  - Agenda for `BOOKING_DATE` with a booked, a cancelled, a held and a next-day appointment → only the booked one; `?employeeId=<staffB>` excludes staffA-only bookings; EMPLOYEE staffA sees only theirs and gets 403 for `employeeId=<staffB>`.
  - An appointment at 23:30 local on `BOOKING_DATE` (after UTC midnight) is in that day's agenda.
  - Search `"an"` finds "Ana"; `"5550100"` finds her by phone; `"a"` → 400; a soft-deleted customer is never returned.
  - EMPLOYEE search finds only customers they served.
  - POST with `consents: { WHATSAPP: true }` → 201, `consents { WHATSAPP: true, SMS: false, EMAIL: false }`; one consent row `source RECEPTION`; audit `customer.create` whose `after` contains no phone or name; duplicate phone → 409; EMPLOYEE POST → 403.
- [ ] **Step 2: Run** `pnpm --filter @beautyspa/api test:int test/integration/booking/agenda.int.test.ts test/integration/customers` · Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm turbo run lint typecheck test && pnpm --filter @beautyspa/api test:int` · Expected: PASS.
- [ ] **Step 5: Commit** — `feat(api): staff day agenda and customer search/create with consent`

---

### Task 9: `/me` profile, export, delete (Opus)

**Files:**
- Create: `apps/api/src/customers/me.controller.ts`, `apps/api/src/customers/me.service.ts`
- Modify: `apps/api/src/customers/customers.module.ts`
- Test: `apps/api/test/integration/customers/me.int.test.ts`
- Docs: `security-quality.md` (design calls 10, 11)

**Interfaces:**
- Consumes: Task 8 `currentConsents`, `recordConsents`, `toCustomerDto`; Task 4 `toAppointmentDto`; `RefreshTokenService.revokeAllFor({ type: "CUSTOMER", id }, tx)`.
- Produces (`@CustomerAuth()`): `GET /me` → `Me`; `PATCH /me` (`MePatch`) → `Me`; `GET /me/export` → `CustomerExport`; `DELETE /me` → 204. `MeService.get/patch/export/remove`.

Rules:
- PATCH: one transaction; name/email/locale update; `consents` via `recordConsents(…, source "PROFILE")`; audit `customer.update` with `after: { fields }` (changed keys incl. `consents.<CHANNEL>`), no audit row when nothing changed.
- Export: `Me`, the full consent history ascending by `changedAt`, and all non-`HELD` appointments (`toAppointmentDto`) ascending.
- Delete: design call 11, one transaction; audit `customer.delete` with `after: { fields: ["name","email","phoneE164","privateNotes"] }`; after commit `events.cancelled` for each cancelled appointment. The access token stays valid up to 15 min (accepted limitation) but every `/me` route answers 401 for a deleted customer (check `deletedAt` in `MeService`).

- [ ] **Step 1: Write failing tests:**
  - GET `/me` → name "Ana", consents all false. PATCH `{ name: "Ana María", consents: { WHATSAPP: true } }` → 200; one consent row `PROFILE`; PATCH the same again → no new row, no audit row.
  - Export contains the consent history and the customer's appointments, none of another customer's.
  - DELETE with one future `BOOKED` and one past `COMPLETED` appointment → 204; customer `name null`, `phoneE164 "deleted:<id>"`, `deletedAt` set; future one `CANCELLED` (`cancelReason "ACCOUNT_DELETED"`, `occupies false`), past one unchanged and still linked; a `granted:false` WhatsApp row added; refresh with the customer's refresh token → 401; `GET /me` with the old access token → 401; no `audit_log` row of the org contains `"+13055550100"` or `"Ana"` in `before`/`after` (cast to text).
  - Then `POST /v1/auth/otp/start` + `verify` (fake provider) for `+13055550100` → `isNew: true` and a different customer id.
- [ ] **Step 2: Run** `pnpm --filter @beautyspa/api test:int test/integration/customers/me.int.test.ts` · Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm turbo run lint typecheck test && pnpm --filter @beautyspa/api test:int` · Expected: PASS.
- [ ] **Step 5: Update `security-quality.md`**, then commit — `feat(api): customer profile, data export and account deletion`

---

### Task 10: RBAC matrix, docs, plan index

**Files:**
- Modify: `apps/api/test/integration/rbac-matrix.int.test.ts`, `apps/api/README.md` (modules list: `booking`, `customers`), `docs/superpowers/specs/2026-11-17-mvp-design/api.md` (any route detail not yet written: rate limits, `Appointment` shape link), `docs/superpowers/plans/2026-11-17-mvp/README.md` (plan 04 row links this file)

**Interfaces:**
- Consumes: every route from Tasks 3–9.

- [ ] **Step 1: Extend the matrix** with every new route: `[GET /availability, public-optional]`, `[POST /holds, public]`, `[POST /appointments, CUSTOMER]`, `[GET|PATCH|DELETE /me, GET /me/export, GET /me/appointments, POST /me/appointments/:id/{cancel,reschedule,repeat}, CUSTOMER]`, `[GET /staff/agenda, all staff]`, `[GET /staff/customers, all staff]`, `[POST /staff/customers, POST /staff/appointments, PATCH /staff/appointments/:id, POST /staff/walk-in, OWNER+RECEPTION]`, `[POST /staff/appointments/:id/status, all staff]`. Denied roles → 403, no token → 401 (`public` routes: not 401/403). A customer token on a staff route → 403; a staff token on a customer route → 403.
- [ ] **Step 2: Run** `pnpm --filter @beautyspa/api test:int test/integration/rbac-matrix.int.test.ts` · Expected: PASS (routes exist; a failure is a real guard bug — fix the decorator, not the table).
- [ ] **Step 3: Update docs** listed above.
- [ ] **Step 4: Run** `pnpm turbo run lint typecheck test build && pnpm format:check && pnpm --filter @beautyspa/api test:int && pnpm --filter @beautyspa/api db:drift` · Expected: PASS.
- [ ] **Step 5: Commit** — `test(api): RBAC matrix for booking routes; docs`

---

## After the last task

- Two independent final branch reviews (`reviewer-opus`, fresh context each), fixes, re-review.
- Push, PR, merge (use `gh api` REST for edit/merge). Mark plan 04 merged in `README.md`; update `docs/handoff.md` (done; carried: plan 05 implements `BookingEvents`, moves `HoldSweeper` to BullMQ `maintenance`, adds manage links using `manage_version`; plan 06 uses `excludeAppointmentId` for reschedule and the post-booking WhatsApp offer via `PATCH /me { consents }`; plan 07 shows override and `NO_SHOW` rules; availability by date range is still open; private customer notes have no endpoint yet).

## Rulings made during execution

Decisions taken while executing (spec docs were updated in the same commits). Each says what it costs if wrong.

- **R1** Hold sweeper audits one `appointment.hold_release` row per org (audit rows need an org). Cost: small sweeper refactor.
- **R2** `Me`/`StaffCustomer` keep the E.164 phone type; deleted customers never reach those responses. Cost: a response parse error → switch to `z.string()`.
- **R3** Every booking write transaction first takes a per-org advisory lock (`lockOrgBookings`), reads `now` after it, and uses `BOOKING_TX_OPTIONS`; exclusion constraints (23P01) and deadlocks (40P01) still map to `SLOT_TAKEN`. Per org, not per location, because an employee's busy time spans locations. Cost: serialized writes per org (negligible at one-spa volume).
- **R4** Audit `before` of a booking confirmed from a hold is the `HELD` appointment; staff create and walk-in use `before: null`. Cost: one line.
- **R5** Customer reschedule keeps the same services (employees and times may change); staff move may change services. Cost: drop one check.
- **R6** Status changes and cancels do not release expired holds (they free time, never claim it). Cost: one line per method.
- **R7 / R7b** Account deletion also nulls free-text `notes` and customer-written `cancelReason` on the customer's appointments and inside their earlier audit rows (system reasons kept) — the one documented exception to `audit_log` being append-only. Cost: drop the scrub.
- **R8** Every `/me` and `/me/appointments` route answers 401 for a deleted customer. Cost: one read per request.
- **R9** Staff can move an appointment already in progress while keeping its original start. Cost: one line.
- **R10** `POST /appointments` answers 401 for a deleted customer.
- **R11** Appointment `notes` and `cancelReason` are visible to the customer; staff-only remarks belong in customer private notes (endpoint later). Cost: a later `staff_notes` split.
- **R12** Blank notes and reasons are stored as null.
- **R13** `CHECKED_IN` / `COMPLETED` only from the appointment's local day on. Cost: drop one check.
- **R14** Every expired-hold release inside a write records an `appointment.hold_release` audit row.
- **R15** The sweeper continues with the next org when one org fails.
- **R16** The R9 clamp also lets staff move a past, never-checked-in appointment to an earlier time (staff-only, audited; useful to reconcile records). Cost: clamp only while the appointment is in progress.
