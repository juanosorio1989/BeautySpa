# Plan 01 — Foundation and Availability Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working Turborepo monorepo with the platform-agnostic core packages (`datetime`, `contracts`, `availability`), a NestJS API skeleton on `/v1` with OpenAPI and problem+json errors, the full MVP database schema with DB-level double-booking protection, and CI.

**Architecture:** pnpm workspace + Turborepo. Shared packages are built with `tsup` (ESM + CJS + `.d.ts`) and must not depend on DOM, Next.js, NestJS, or Node-only APIs. The availability engine is a pure function over plain data (epoch-ms intervals). The API is NestJS 11 + Prisma; exclusion constraints live in raw SQL migrations.

**Tech Stack:** Node 22 LTS, pnpm 10, Turborepo 2, TypeScript 5 (strict), Vitest, tsup, date-fns 4 + `@date-fns/tz`, Zod, NestJS 11, `nestjs-zod`, `@nestjs/swagger`, helmet, Prisma 6, PostgreSQL 16, Redis 7, Docker Compose, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-17-mvp-design/` (read `README.md`, `architecture.md`, `data-model.md`, `availability.md`).

**Branch:** `feat/mvp-01-foundation`

## Routing

Main session: Opus 5.5 (orchestrates, does not implement normal tasks).

| Task | What | Implementer | Reviewer | Why |
|---|---|---|---|---|
| 1 | Monorepo scaffold, config package, Docker Compose | implementer-sonnet | reviewer-opus | mechanical setup, exact files given |
| 2 | `@beautyspa/datetime` | implementer-sonnet | reviewer-opus | pure functions, exact DST values given |
| 3 | `@beautyspa/contracts` base schemas | implementer-sonnet | reviewer-opus | schemas fully specified |
| 4 | `availability`: interval math + free time | implementer-sonnet | reviewer-opus | algorithm and tests specified |
| 5 | `availability`: `findSlots` + `validatePlan` | implementer-sonnet | reviewer-opus | algorithm detailed below; reviewer checks against spec |
| 6 | NestJS API skeleton | implementer-sonnet | reviewer-opus | standard wiring, tests given |
| 7 | Prisma schema, constraints migration, seed | **implementer-opus** | reviewer-opus | schema/migration (Opus rule) |
| 8 | CI workflow, drift check, docs | implementer-sonnet | reviewer-opus | mechanical, acceptance commands given |

## Global Constraints

- Node `22` (`.nvmrc`), pnpm `10` (`packageManager` field), TypeScript `strict: true`, `noUncheckedIndexedAccess: true`.
- Package scope `@beautyspa/*`. Packages: `config`, `datetime`, `contracts`, `availability`; apps: `api` (web/mobile come later; `apps/mobile/README.md` already exists — do not touch).
- `packages/datetime`, `packages/contracts`, `packages/availability` type-check with `lib: ["ES2022"]`, `types: []` (no DOM, no Node types) and may not import `next`, `@nestjs/*`, `react-dom`, `node:*`, `fs`, `path`.
- All timestamps are UTC; location wall time is converted via IANA zones. Default zone in fixtures/seeds: `America/New_York`.
- Money is integer cents (USD). Translatable text is `{ en: string; es: string }`.
- Locales: exactly `en` and `es`.
- Code, comments, docs, commit messages in English.
- Secrets never committed: `.env` gitignored, `.env.example` with placeholders only.
- Each task ends with green `pnpm turbo run lint typecheck test` for the packages it touched, and a commit. Docs change in the same commit as code.

## Review Focus

1. Employee hours that extend past location hours → slots are clipped to location hours (test in Task 4).
2. Multi-day time off (vacation spanning the requested date) and busy segments crossing midnight → correctly subtracted (test in Task 4).
3. The same service requested twice (two manicures for a mother and daughter) → treated as two parallel segments with distinct technicians (test in Task 5).
4. Unknown `serviceId`, empty service list, or explicit employee who does not offer the service → explicit `AvailabilityError` or empty result, never a crash or a wrong slot (tests in Task 5).
5. Malformed JSON / invalid body on the API → `400 application/problem+json` with code `VALIDATION_FAILED`, never a 500 (test in Task 6).

---

### Task 1: Monorepo scaffold, config package, Docker Compose

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.nvmrc`, `.gitignore`, `.npmrc`, `.env.example`, `docker-compose.yml`, `docker/postgres/init.sql`
- Create: `packages/config/package.json`, `packages/config/tsconfig.base.json`, `packages/config/tsconfig.platform.json`, `packages/config/tsconfig.node.json`, `packages/config/eslint.base.mjs`, `packages/config/eslint.platform.mjs`, `packages/config/vitest.preset.mjs`
- Create: `eslint.config.mjs` (root), `README.md` (root, short; full setup in Task 8)

**Interfaces:**
- Produces:
  - Workspaces `apps/*`, `packages/*`.
  - Turbo tasks: `build` (dependsOn `^build`, outputs `dist/**`), `dev` (persistent, no cache), `lint`, `typecheck` (dependsOn `^build`), `test` (dependsOn `^build`), `test:int` (dependsOn `^build`, no cache).
  - `@beautyspa/config/tsconfig.base.json` (strict, `noUncheckedIndexedAccess`, `moduleResolution: "Bundler"`, `target: "ES2022"`), `tsconfig.platform.json` (extends base, `lib: ["ES2022"]`, `types: []`), `tsconfig.node.json` (extends base, `types: ["node"]`).
  - `@beautyspa/config/eslint.platform.mjs`: base config + `no-restricted-imports` banning `next`, `next/*`, `@nestjs/*`, `react-dom`, `node:*`, `fs`, `path`, `crypto`, `http`.
  - `@beautyspa/config/vitest.preset.mjs`: `defineConfig({ test: { environment: "node", include: ["src/**/*.test.ts", "test/**/*.test.ts"] } })`.
  - Docker Compose services: `postgres` (`postgres:16`, port 5432, user/password/db `beautyspa`, init script creates DB `beautyspa_test`), `redis` (`redis:7`, port 6379), `mailpit` (ports 1025/8025). All with healthchecks.
  - `.env.example`: `DATABASE_URL=postgresql://beautyspa:beautyspa@localhost:5432/beautyspa`, `DATABASE_URL_TEST=postgresql://beautyspa:beautyspa@localhost:5432/beautyspa_test`, `REDIS_URL=redis://localhost:6379`, `WEB_ORIGIN=http://localhost:3000`, `PORT=3001`, `NODE_ENV=development`.

- [ ] **Step 1: Create branch** — `git checkout -b feat/mvp-01-foundation`
- [ ] **Step 2: Write root and config files** listed above. Root scripts: `build`, `dev`, `lint`, `typecheck`, `test`, `test:int` each as `turbo run <task>`; `format` with Prettier.
- [ ] **Step 3: Verify install and turbo** — Run: `pnpm install && pnpm turbo run lint typecheck test` · Expected: exit 0 (no packages with tasks yet is fine; turbo reports 0 or only config tasks).
- [ ] **Step 4: Verify Docker** — Run: `docker compose up -d && docker compose ps --format '{{.Service}} {{.Health}}'` · Expected: `postgres healthy`, `redis healthy`, `mailpit healthy`. Then `docker compose exec postgres psql -U beautyspa -lqt | cut -d'|' -f1 | grep -w beautyspa_test` prints `beautyspa_test`.
- [ ] **Step 5: Commit** — `chore: scaffold turborepo monorepo, shared config, docker compose`

---

### Task 2: `@beautyspa/datetime`

**Files:**
- Create: `packages/datetime/package.json`, `tsconfig.json` (extends platform), `tsup.config.ts`, `eslint.config.mjs` (platform), `vitest.config.ts`
- Create: `packages/datetime/src/index.ts`, `src/zoned.ts`, `src/dates.ts`
- Test: `packages/datetime/src/zoned.test.ts`, `src/dates.test.ts`

**Interfaces:**
- Produces (all exported from `@beautyspa/datetime`):
  - `type IsoDate = string` (`YYYY-MM-DD`), `type WallTime = string` (`HH:mm`, 24 h), `type Weekday = 0|1|2|3|4|5|6` (0 = Sunday).
  - `wallTimeToUtc(date: IsoDate, time: WallTime, timeZone: string): number` — epoch ms. Nonexistent wall time (spring-forward gap) shifts forward by the gap; ambiguous wall time (fall-back) uses the **earlier** instant (first occurrence).
  - `utcToWall(instant: number, timeZone: string): { date: IsoDate; time: WallTime; weekday: Weekday }`
  - `localDayBoundsUtc(date: IsoDate, timeZone: string): { start: number; end: number }` — half-open, `end` = start of next local day.
  - `weekdayOf(date: IsoDate): Weekday`
  - `addDays(date: IsoDate, days: number): IsoDate`
  - `datesInRange(from: IsoDate, to: IsoDate): IsoDate[]` — inclusive; throws `RangeError` if `from > to`.
  - `todayIn(timeZone: string, now: number): IsoDate`
  - `MINUTE = 60_000`

- [ ] **Step 1: Write failing tests** (`zoned.test.ts`, `dates.test.ts`), with `const NY = "America/New_York"`:

```ts
expect(wallTimeToUtc("2026-12-07", "09:00", NY)).toBe(Date.parse("2026-12-07T14:00:00Z"));
expect(wallTimeToUtc("2026-03-07", "09:00", NY)).toBe(Date.parse("2026-03-07T14:00:00Z"));
expect(wallTimeToUtc("2026-03-08", "09:00", NY)).toBe(Date.parse("2026-03-08T13:00:00Z"));
expect(wallTimeToUtc("2026-03-08", "02:30", NY)).toBe(Date.parse("2026-03-08T07:30:00Z")); // gap → 03:30 EDT
expect(wallTimeToUtc("2026-11-01", "01:30", NY)).toBe(Date.parse("2026-11-01T05:30:00Z")); // ambiguous → first (EDT)
expect(wallTimeToUtc("2026-11-01", "09:00", NY)).toBe(Date.parse("2026-11-01T14:00:00Z"));
expect(localDayBoundsUtc("2026-03-08", NY)).toEqual({ start: Date.parse("2026-03-08T05:00:00Z"), end: Date.parse("2026-03-09T04:00:00Z") }); // 23 h
expect(localDayBoundsUtc("2026-11-01", NY)).toEqual({ start: Date.parse("2026-11-01T04:00:00Z"), end: Date.parse("2026-11-02T05:00:00Z") }); // 25 h
expect(utcToWall(Date.parse("2026-12-07T14:00:00Z"), NY)).toEqual({ date: "2026-12-07", time: "09:00", weekday: 1 });
expect(weekdayOf("2026-12-06")).toBe(0);
expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
expect(datesInRange("2026-12-30", "2027-01-01")).toEqual(["2026-12-30", "2026-12-31", "2027-01-01"]);
expect(() => datesInRange("2026-12-02", "2026-12-01")).toThrow(RangeError);
expect(todayIn(NY, Date.parse("2026-12-08T03:00:00Z"))).toBe("2026-12-07");
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @beautyspa/datetime test` · Expected: FAIL (module/exports missing).
- [ ] **Step 3: Implement** in `src/zoned.ts` / `src/dates.ts` using `@date-fns/tz` (`TZDate`) and `date-fns`; `IsoDate` arithmetic via UTC-noon `Date` to avoid zone effects.
- [ ] **Step 4: Run tests** — same command · Expected: PASS.
- [ ] **Step 5: Verify platform guard** — temporarily add `export const x = document.title;` to `src/index.ts`, run `pnpm --filter @beautyspa/datetime typecheck` · Expected: FAIL `Cannot find name 'document'`. Remove the line; typecheck passes. Run `pnpm --filter @beautyspa/datetime build` · Expected: `dist/index.js`, `dist/index.cjs`, `dist/index.d.ts` exist.
- [ ] **Step 6: Commit** — `feat(datetime): timezone and date helpers with DST handling`

---

### Task 3: `@beautyspa/contracts` base schemas

**Files:**
- Create: `packages/contracts/{package.json,tsconfig.json,tsup.config.ts,eslint.config.mjs,vitest.config.ts}`
- Create: `packages/contracts/src/index.ts`, `src/common.ts`, `src/errors.ts`, `src/availability.ts`, `src/health.ts`
- Test: `packages/contracts/src/common.test.ts`, `src/availability.test.ts`

**Interfaces:**
- Produces (exported from `@beautyspa/contracts`, each schema with its `z.infer` type of the same name minus `Schema`):
  - `IdSchema = z.string().uuid()`
  - `PhoneE164Schema = z.string().regex(/^\+[1-9]\d{7,14}$/)`
  - `LocaleSchema = z.enum(["en", "es"])`
  - `LocalizedTextSchema = z.object({ en: z.string().min(1), es: z.string().min(1) })`
  - `MoneyCentsSchema = z.number().int().nonnegative()`
  - `IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)`
  - `IsoInstantSchema = z.string().datetime({ offset: true })`
  - `ErrorCode = z.enum(["VALIDATION_FAILED","NOT_FOUND","UNAUTHORIZED","FORBIDDEN","RATE_LIMITED","SLOT_TAKEN","HOLD_EXPIRED","OTP_INVALID","OUTSIDE_CANCEL_WINDOW","INTERNAL"])`
  - `ProblemSchema = z.object({ type: z.string(), title: z.string(), status: z.number().int(), code: ErrorCode, detail: z.string().optional(), errors: z.array(z.object({ path: z.string(), message: z.string() })).optional() })`
  - `PlannedSegmentSchema = z.object({ serviceId: IdSchema, employeeId: IdSchema, resourceId: IdSchema.nullable(), startsAt: IsoInstantSchema, endsAt: IsoInstantSchema, blockEndsAt: IsoInstantSchema, durationMin: z.number().int().positive(), priceCents: MoneyCentsSchema })`
  - `SlotSchema = z.object({ startsAt: IsoInstantSchema, endsAt: IsoInstantSchema, segments: z.array(PlannedSegmentSchema).min(1).max(4) })`
  - `ServiceChoiceSchema = z.object({ serviceId: IdSchema, employeeId: z.union([IdSchema, z.literal("ANY")]) })`
  - `AvailabilityQuerySchema = z.object({ locationId: IdSchema.optional(), services: z.array(ServiceChoiceSchema).min(1).max(4), date: IsoDateSchema })`
  - `HealthResponseSchema = z.object({ status: z.literal("ok") })`

- [ ] **Step 1: Write failing tests**: `PhoneE164Schema` accepts `"+17185550123"`, rejects `"7185550123"`, `"+0123"`; `LocalizedTextSchema` rejects missing `es`; `AvailabilityQuerySchema` rejects `services: []` and 5 services, accepts `employeeId: "ANY"`; `IsoInstantSchema` accepts `"2026-12-07T14:00:00Z"` and `"2026-12-07T09:00:00-05:00"`, rejects `"2026-12-07 09:00"`.
- [ ] **Step 2: Run** `pnpm --filter @beautyspa/contracts test` · Expected: FAIL.
- [ ] **Step 3: Implement** the schemas exactly as listed.
- [ ] **Step 4: Run tests + typecheck + build** · Expected: PASS, `dist/` emitted.
- [ ] **Step 5: Commit** — `feat(contracts): base zod schemas, error codes, slot contracts`

---

### Task 4: `availability` — interval math and free time

**Files:**
- Create: `packages/availability/{package.json,tsconfig.json,tsup.config.ts,eslint.config.mjs,vitest.config.ts}`
- Create: `packages/availability/src/index.ts`, `src/types.ts`, `src/intervals.ts`, `src/free-time.ts`
- Create: `packages/availability/test/fixtures.ts`
- Test: `packages/availability/src/intervals.test.ts`, `src/free-time.test.ts`

**Interfaces:**
- Consumes: `wallTimeToUtc`, `localDayBoundsUtc`, `weekdayOf`, `IsoDate`, `WallTime`, `Weekday`, `MINUTE` from `@beautyspa/datetime`.
- Produces — `src/types.ts` (exported):

```ts
export type Ms = number;
export interface Interval { start: Ms; end: Ms }            // half-open [start, end)
export interface WeeklyHours { weekday: Weekday; start: WallTime; end: WallTime }
export interface LocationInput { timezone: string; slotIntervalMin: number; minLeadMinutes: number; bookingHorizonDays: number; hours: WeeklyHours[]; closures: Interval[] }
export interface ServiceInput { id: string; durationMin: number; bufferAfterMin: number; priceCents: number; parallelizable: boolean; resourceTypeId: string | null; onlineBookable: boolean; levelOverrides: Record<string, { durationMin: number; priceCents: number }> }
export interface EmployeeInput { id: string; levelId: string | null; serviceIds: string[]; workingHours: WeeklyHours[]; timeOff: Interval[]; bookableOnline: boolean }
export interface ResourceInput { id: string; resourceTypeId: string; name: string }
export interface BusySegment { employeeId: string; resourceId: string | null; start: Ms; blockEnd: Ms }
```

- Produces — `src/intervals.ts`: `normalize(xs: Interval[]): Interval[]` (sort, merge overlapping/adjacent, drop empty), `subtract(a: Interval[], b: Interval[]): Interval[]`, `intersect(a: Interval[], b: Interval[]): Interval[]`, `covers(xs: Interval[], range: Interval): boolean`.
- Produces — `src/free-time.ts`:
  - `weeklyToUtc(hours: WeeklyHours[], date: IsoDate, timeZone: string): Interval[]`
  - `employeeFreeTime(args: { employee: EmployeeInput; location: LocationInput; date: IsoDate; busy: BusySegment[]; ignoreHours: boolean }): Interval[]` — not ignoring hours: `weeklyToUtc(employee.workingHours) ∩ weeklyToUtc(location.hours) − location.closures − employee.timeOff − busy(employee)`; ignoring hours: `localDayBounds − busy(employee)`. Busy ranges are `[start, blockEnd)`.
  - `resourceFreeTime(args: { resource: ResourceInput; location: LocationInput; date: IsoDate; busy: BusySegment[] }): Interval[]` — `localDayBounds − busy(resource)`.
- `test/fixtures.ts` exports `NY`, `MON = "2026-12-07"`, `location` (NY, slot 15, minLead 60, horizon 60, hours every weekday `09:00–19:00`, no closures), services `mani` (30 min, buffer 10, 2500, parallel, no resource), `pedi` (45, buffer 15, 4000, parallel, resource type `chair`), `gel` (15, buffer 0, 1500, parallel, no resource), `haircut` (60, buffer 0, 5000, not parallel, no resource, override `senior` → 45 min / 7000); employees `ana`, `bea` (mani, pedi, gel; level `junior`), `carla` (haircut; `senior`), `dani` (haircut; `junior`), all `09:00–19:00` every weekday, `bookableOnline: true`; resources `chair-1`, `chair-2` (type `chair`); `const at = (date, time) => wallTimeToUtc(date, time, NY)`; and builder helpers to override any field. Ids are UUID-shaped constants in that alphabetical order (`ana` < `bea` < `carla` < `dani`).

- [ ] **Step 1: Write failing interval tests**: `normalize([{0,10},{5,20},{20,30},{40,40}])` → `[{0,30}]`; `subtract([{0,100}], [{10,20},{50,60}])` → `[{0,10},{20,50},{60,100}]`; `intersect([{0,50}], [{40,100}])` → `[{40,50}]`; `covers([{0,50}], {10,50})` true, `covers([{0,50}], {10,51})` false.
- [ ] **Step 2: Write failing free-time tests** (using fixtures):
  - dani on `MON`, no busy → `[{ at(MON,"09:00"), at(MON,"19:00") }]`.
  - dani hours `09:00–13:00` + `14:00–19:00` → two intervals with the gap.
  - dani busy `10:00`→blockEnd `11:00` → `[09:00–10:00, 11:00–19:00]`.
  - **Review Focus 1:** dani hours `08:00–21:00`, location `09:00–19:00` → `[09:00–19:00]`.
  - **Review Focus 2:** dani time off `2026-12-05T00:00 NY` → `2026-12-09T00:00 NY` → `[]` on `MON`; busy segment `2026-12-06 23:30` → blockEnd `2026-12-07 09:30` → free starts `09:30`.
  - location closure covering `MON` → `[]`.
  - `ignoreHours: true` with dani time off all day → `localDayBoundsUtc(MON)` minus busy.
  - DST: dani on `2026-03-08` → `[{ Date.parse("2026-03-08T13:00:00Z"), Date.parse("2026-03-08T23:00:00Z") }]`.
- [ ] **Step 3: Run** `pnpm --filter @beautyspa/availability test` · Expected: FAIL.
- [ ] **Step 4: Implement** `intervals.ts` and `free-time.ts`.
- [ ] **Step 5: Run tests, typecheck, lint** · Expected: PASS.
- [ ] **Step 6: Commit** — `feat(availability): interval math and employee/resource free time`

---

### Task 5: `availability` — `findSlots` and `validatePlan`

**Files:**
- Create: `packages/availability/src/plan.ts`, `src/find-slots.ts`, `src/validate-plan.ts`, `src/errors.ts`
- Modify: `packages/availability/src/index.ts` (exports), `src/types.ts` (add types below)
- Test: `packages/availability/src/find-slots.test.ts`, `src/validate-plan.test.ts`

**Interfaces:**
- Consumes: Task 4 types, `employeeFreeTime`, `resourceFreeTime`, `covers`; `datesInRange`, `todayIn`, `addDays`, `localDayBoundsUtc`, `MINUTE`.
- Produces (add to `types.ts`, export):

```ts
export type Mode = "ONLINE" | "STAFF";
export interface ServiceChoice { serviceId: string; employeeId: string | "ANY" }
export interface PlannedSegment { serviceId: string; employeeId: string; resourceId: string | null; start: Ms; end: Ms; blockEnd: Ms; durationMin: number; priceCents: number }
export interface Slot { start: Ms; end: Ms; segments: PlannedSegment[] }
export interface Context { location: LocationInput; services: ServiceInput[]; employees: EmployeeInput[]; resources: ResourceInput[]; busy: BusySegment[]; mode: Mode; now: Ms; override?: boolean }
export interface FindSlotsInput extends Context { choices: ServiceChoice[]; date: IsoDate }
export type PlanRejection = "NOT_QUALIFIED" | "EMPLOYEE_UNAVAILABLE" | "RESOURCE_UNAVAILABLE" | "TOO_SOON" | "BEYOND_HORIZON" | "NOT_BOOKABLE_ONLINE" | "MALFORMED_PLAN";
```

  - `findSlots(input: FindSlotsInput): Slot[]` — sorted by `start`, at most one slot per start.
  - `validatePlan(ctx: Context, choices: ServiceChoice[], segments: PlannedSegment[]): { ok: true } | { ok: false; reason: PlanRejection }`
  - `class AvailabilityError extends Error { code: "NO_SERVICES" | "TOO_MANY_SERVICES" | "UNKNOWN_SERVICE" | "UNKNOWN_EMPLOYEE" }` — thrown by `findSlots` for 0 or > 4 choices or unknown ids.

**Algorithm (from spec `availability.md`, plus the decisions below):**

1. Validate choices (errors above). Resolve each service; if `mode === "ONLINE"` and a service is not `onlineBookable` → return `[]`.
2. Candidate employees per choice: explicit id → that employee only, must offer the service (else `[]`); `"ANY"` → all employees offering it. ONLINE also requires `bookableOnline`.
3. Date window: ONLINE returns `[]` if `date > addDays(todayIn(tz, now), bookingHorizonDays)` or `date` before today. Earliest start: ONLINE `now + minLeadMinutes`; STAFF `floor(now)` to the slot grid.
4. Grid: candidate starts `t` from `localDayBoundsUtc(date).start` every `slotIntervalMin` minutes, ≥ earliest, < day end.
5. Free time per employee and resource computed once per call (`ignoreHours = mode === "STAFF" && override === true`).
6. Duration/price per (service, employee): `levelOverrides[employee.levelId]` else service defaults. `blockEnd = end + bufferAfterMin`.
7. For each `t`: let `P` = choices whose service is `parallelizable`. If `|P| ≥ 2`: try **parallel block** — all `P` start at `t`, distinct employees; then the non-parallel choices follow sequentially in client order from `max(end of P)`. If that fails (or `|P| < 2`): try **fully sequential** in client order, segment *n+1* starts at segment *n*'s `end`.
8. Assignment uses backtracking (≤ 4 segments): candidates ordered by (booked minutes that local day ascending — sum of `blockEnd − start` of that employee's busy segments starting in the day — then id ascending). A segment fits if the employee's free time `covers [start, blockEnd)`, the employee is not already used by an overlapping segment in this plan, and, when the service needs a resource, some resource of that type (ordered by name) covers `[start, blockEnd)` and is not used by an overlapping segment in this plan.
9. **Same-employee consecutive segments (call, recorded in spec):** when segment *n+1* uses the same employee as segment *n*, segment *n*'s `blockEnd = end` (no buffer between one client's back-to-back services).
10. Slot `end` = max segment `end`.

- [ ] **Step 1: Write failing `findSlots` tests** (fixtures from Task 4; `now = Date.parse("2026-12-06T12:00:00Z")`, mode ONLINE unless stated):
  1. haircut/dani → 37 slots; first `start = at(MON,"09:00")`, `end = at(MON,"10:00")`; last `start = at(MON,"18:00")`.
  2. mani/ana → 38 slots; last `start = at(MON,"18:15")` (needs 40 min incl. buffer by 19:00).
  3. dani busy `10:00–11:00` → includes `09:00`, excludes `09:15` and `10:45`, includes `11:00`.
  4. mani ANY + pedi ANY → first slot: both segments `start = at(MON,"09:00")`, employees `{ana, bea}` distinct, pedi `resourceId = chair-1`, mani `resourceId = null`, slot `end = at(MON,"09:45")`.
  5. bea time off all day → sequential: mani ana `09:00–09:30` with `blockEnd = 09:30` (buffer dropped), pedi ana `09:30–10:15`, slot `end = at(MON,"10:15")`.
  6. both chairs busy all day → `[]` for mani + pedi.
  7. mani ANY + pedi ANY + haircut dani → first slot: mani‖pedi at `09:00`, haircut `09:45–10:45`.
  8. mani + pedi + gel (all ANY; only ana, bea exist for them) → fully sequential in client order: mani `09:00–09:30`, pedi `09:30–10:15`, gel `10:15–10:30`.
  9. ANY tie-break: mani ANY with no busy → `employeeId = ana`; with ana busy `15:00–17:00` → `bea`.
  10. haircut carla (senior) → `end − start = 45 min`, `priceCents = 7000`; dani → 60 min, 5000.
  11. DST: haircut dani on `2026-03-08` → first start `Date.parse("2026-03-08T13:00:00Z")`, 37 slots; on `2026-11-01` → first start `Date.parse("2026-11-01T14:00:00Z")`, 37 slots.
  12. Lead time: `now = Date.parse("2026-12-07T15:10:00Z")` → ONLINE first start `Date.parse("2026-12-07T16:15:00Z")`; STAFF first start `Date.parse("2026-12-07T15:00:00Z")`.
  13. Horizon (today = `"2026-12-06"`, horizon 60): date `"2027-02-04"` → ONLINE non-empty; `"2027-02-05"` → ONLINE `[]`, STAFF non-empty.
  14. dani `bookableOnline: false` → ONLINE explicit dani `[]`; STAFF non-empty.
  15. STAFF `override: true`, dani time off all day → non-empty, first start `at(MON,"00:00")`.
  16. **Review Focus 3:** mani ANY + mani ANY → parallel, distinct employees `{ana, bea}`.
  17. **Review Focus 4:** `choices: []` → throws `AvailabilityError` code `NO_SERVICES`; 5 choices → `TOO_MANY_SERVICES`; unknown serviceId → `UNKNOWN_SERVICE`; explicit `carla` for mani → `[]`.
- [ ] **Step 2: Write failing `validatePlan` tests**: segments of slot from test 4 → `{ ok: true }`; same but busy added on `chair-1` overlapping and `chair-2` busy → `RESOURCE_UNAVAILABLE`; mani assigned to carla → `NOT_QUALIFIED`; ONLINE start before `now + minLead` → `TOO_SOON`; segments count ≠ choices count → `MALFORMED_PLAN`.
- [ ] **Step 3: Run** `pnpm --filter @beautyspa/availability test` · Expected: FAIL.
- [ ] **Step 4: Implement** `plan.ts` (assignment/backtracking, shared by both), `find-slots.ts`, `validate-plan.ts` (re-checks each given segment against the same rules as step 8, including durations/prices matching the employee's level, and the order/parallel shape rules), `errors.ts`.
- [ ] **Step 5: Run tests, typecheck, lint, build** · Expected: PASS. Also `pnpm --filter @beautyspa/availability exec vitest run --coverage` ≥ 90 % lines for `src/`.
- [ ] **Step 6: Update spec** `docs/superpowers/specs/2026-11-17-mvp-design/availability.md`: add the same-employee buffer rule (step 9) and the backtracking ordering (step 8) under Algorithm, marked **(call)**.
- [ ] **Step 7: Commit** — `feat(availability): slot planner with parallel/sequential plans and plan validation`

---

### Task 6: NestJS API skeleton

**Files:**
- Create: `apps/api/{package.json,tsconfig.json,tsconfig.build.json,nest-cli.json,eslint.config.mjs,vitest.config.ts}`
- Create: `apps/api/src/main.ts`, `src/app.module.ts`, `src/bootstrap.ts`, `src/config/env.ts`, `src/common/problem.filter.ts`, `src/health/health.controller.ts`, `src/health/health.module.ts`
- Test: `apps/api/test/app.e2e.test.ts`

**Interfaces:**
- Consumes: `HealthResponseSchema`, `ProblemSchema`, `ErrorCode` from `@beautyspa/contracts`.
- Produces:
  - `configureApp(app: INestApplication, env: Env): Promise<void>` in `src/bootstrap.ts` — sets global prefix `v1`, helmet, CORS (`origin: env.WEB_ORIGIN`, `credentials: true`), global `ZodValidationPipe`, global `ProblemFilter`, Swagger UI at `/v1/docs`, JSON at `/v1/openapi.json` (via `@nestjs/swagger` + `nestjs-zod` `cleanupOpenApiDoc`). Used by `main.ts` and tests.
  - `Env` + `loadEnv(source = process.env): Env` in `src/config/env.ts` — Zod: `NODE_ENV` enum (`development`,`test`,`production`), `PORT` coerce number default 3001, `DATABASE_URL` url, `REDIS_URL` url, `WEB_ORIGIN` url. Invalid env → throws listing missing keys.
  - `ProblemFilter`: responses `Content-Type: application/problem+json`, body matching `ProblemSchema`; maps `ZodValidationException` and body-parse errors → 400 `VALIDATION_FAILED` with `errors[]`; `NotFoundException` → 404 `NOT_FOUND`; other `HttpException` → its status with code from `exception.getResponse().code` if it is an `ErrorCode`, else by status; unknown → 500 `INTERNAL` (no stack in body).
  - `GET /v1/health` → `{ "status": "ok" }`.
- [ ] **Step 1: Write failing e2e tests** (supertest against an app built with `configureApp`, a test-only `EchoController` with `POST /v1/echo` validated by a `createZodDto(z.object({ name: z.string() }))`):
  - `GET /v1/health` → 200 `{ status: "ok" }`, header `x-content-type-options: nosniff`.
  - `GET /v1/openapi.json` → 200, `paths` has key `/v1/health`.
  - `GET /v1/nope` → 404, `content-type` starts with `application/problem+json`, body `code: "NOT_FOUND"`, parses with `ProblemSchema`.
  - `POST /v1/echo` `{}` → 400 `VALIDATION_FAILED`, `errors[0].path === "name"`.
  - **Review Focus 5:** `POST /v1/echo` raw body `{"name":` with `content-type: application/json` → 400 `VALIDATION_FAILED`.
  - CORS: `OPTIONS /v1/health` with `Origin: https://evil.example` → no `access-control-allow-origin`; with `Origin: http://localhost:3000` → echoed.
  - `loadEnv({})` throws an error whose message contains `DATABASE_URL`.
- [ ] **Step 2: Run** `pnpm --filter @beautyspa/api test` · Expected: FAIL.
- [ ] **Step 3: Implement** the files above. `main.ts`: `loadEnv()`, create app, `configureApp`, listen on `PORT`.
- [ ] **Step 4: Run tests, typecheck, lint** · Expected: PASS. Manual: `pnpm --filter @beautyspa/api dev` then `curl -s localhost:3001/v1/health` → `{"status":"ok"}`.
- [ ] **Step 5: Commit** — `feat(api): nestjs skeleton with /v1, openapi, problem+json, security headers`

---

### Task 7: Prisma schema, constraints migration, seed — **Opus**

**Files:**
- Create: `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/<timestamp>_init/migration.sql` (generated), `apps/api/prisma/migrations/<timestamp>_booking_constraints/migration.sql` (hand-written), `apps/api/prisma/seed.ts`
- Create: `apps/api/src/prisma/prisma.service.ts`, `src/prisma/prisma.module.ts`
- Create: `apps/api/scripts/check-drift.sh`
- Modify: `apps/api/package.json` (scripts: `db:migrate` = `prisma migrate dev`, `db:deploy` = `prisma migrate deploy`, `db:seed` = `tsx prisma/seed.ts`, `db:drift` = `bash scripts/check-drift.sh`, `test:int` = `vitest run --config vitest.int.config.ts`), `apps/api/vitest.int.config.ts`
- Test: `apps/api/test/integration/booking-constraints.int.test.ts`, `apps/api/test/integration/setup.ts`

**Interfaces:**
- Consumes: spec `data-model.md` (authoritative for every table, column, enum).
- Produces:
  - Prisma models for **every** table in `data-model.md` (tenancy, staff/auth incl. `staff_recovery_code`, `staff_auth_token`, `refresh_token`, customers, consent, catalog, resources, appointments, segments, notification log, audit log). Table/column names `snake_case` via `@@map`/`@map`; model/field names `PascalCase`/`camelCase`. Ids `@default(uuid(7)) @db.Uuid`. Timestamps `@db.Timestamptz(3)`. Enums: `StaffRole`, `AppointmentStatus`, `AppointmentSource`, `TimeOffKind`, `NotificationChannel`, `ConsentSource`, `NotificationStatus`, `ActorType`, `CreatedVia`, `SubjectType`, `StaffTokenPurpose`.
  - Indexes: `customer (organization_id, phone_e164)` unique; `staff_user (organization_id, email)` unique; `appointment_segment (staff_user_id, starts_at)`, `(resource_id, starts_at)`; `appointment (location_id, status)`, `(hold_expires_at)` where useful; `refresh_token (token_hash)` unique; `notification_log (provider_message_id)`.
  - `booking_constraints` migration: `CREATE EXTENSION IF NOT EXISTS btree_gist;` and the two `EXCLUDE` constraints exactly as in `data-model.md` (`no_employee_overlap`, `no_resource_overlap`), plus `CHECK (starts_at < ends_at AND ends_at <= block_ends_at)` named `segment_time_order`.
  - `PrismaService` (extends `PrismaClient`, `onModuleInit` connects) in a global `PrismaModule`.
  - Seed (idempotent upsert): organization `slug "demo-salon"`, name `"Demo Salon"`, `default_locale "es"`; one location `"Main"`, timezone `America/New_York`, settings `{ slotIntervalMin: 15, holdMinutes: 5, cancelWindowHours: 24, bookingHorizonDays: 60, minLeadMinutes: 60 }`, hours Mon–Sat `09:00–19:00`. (Full catalog seeds come in plan 03.)
- [ ] **Step 1: Write failing integration tests** (against `DATABASE_URL_TEST`; `setup.ts` runs `prisma migrate reset --force --skip-seed` once, then truncates per test; helpers insert org, location, two staff users, resource type, two resources, a customer, appointments):
  - `pg_constraint` has `no_employee_overlap` and `no_resource_overlap` (contype `x`) on `appointment_segment`.
  - Same employee, `[10:00, 11:00)` then `[10:30, 11:30)`, both `occupies = true` → second insert rejects with Prisma error whose `meta`/cause code is `23P01`.
  - Adjacent `[10:00, 11:00)` and `[11:00, 12:00)` same employee → both succeed.
  - Overlap where the first has `occupies = false` → succeeds.
  - Different employees, same `resource_id`, overlapping → `23P01`; both `resource_id = null` → succeeds.
  - Buffer counts: first `starts 10:00, ends 10:30, block_ends 10:45`, second same employee starting `10:40` → `23P01`.
  - `ends_at > block_ends_at` → check violation `23514`.
- [ ] **Step 2: Run** `docker compose up -d && pnpm --filter @beautyspa/api test:int` · Expected: FAIL (no schema).
- [ ] **Step 3: Write `schema.prisma`**, run `pnpm --filter @beautyspa/api exec prisma migrate dev --name init`.
- [ ] **Step 4: Create the constraints migration** with `prisma migrate dev --create-only --name booking_constraints`, paste the SQL, apply with `prisma migrate dev`.
- [ ] **Step 5: Run integration tests** · Expected: PASS.
- [ ] **Step 6: Write `check-drift.sh`**: runs `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "$DATABASE_URL_TEST" --exit-code`; exit 0 = no drift. Run `pnpm --filter @beautyspa/api db:drift` · Expected: exit 0. If Prisma reports it would drop the exclusion constraints, record the workaround chosen in the spec's `data-model.md` and make the script fail only on non-constraint drift.
- [ ] **Step 7: Seed** — `pnpm --filter @beautyspa/api db:seed` twice · Expected: both succeed; `select count(*) from organization` = 1.
- [ ] **Step 8: Commit** — `feat(api): full MVP prisma schema, exclusion constraints, seed`

---

### Task 8: CI workflow, drift check, docs

**Files:**
- Create: `.github/workflows/ci.yml`, `docs/README.md`, `docs/development/README.md`
- Modify: `README.md` (root)

**Interfaces:**
- Consumes: turbo tasks (Task 1), `db:deploy`, `db:drift`, `test:int` (Task 7).
- Produces:
  - CI on `push` to `main` and on `pull_request`: job `checks` (Node 22 via `.nvmrc`, pnpm via `packageManager`, cache pnpm store, `pnpm install --frozen-lockfile`, `pnpm turbo run lint typecheck test build`); job `integration` with services `postgres:16` (db `beautyspa_test`) and `redis:7`, env `DATABASE_URL_TEST` / `DATABASE_URL` both pointing to it, steps `pnpm turbo run build --filter=@beautyspa/api...`, `pnpm --filter @beautyspa/api db:deploy`, `pnpm --filter @beautyspa/api test:int`, `pnpm --filter @beautyspa/api db:drift`.
  - `docs/README.md`: short index linking `development/`, `superpowers/specs/`, `superpowers/plans/`.
  - `docs/development/README.md`: prerequisites (Node 22, pnpm 10, Docker), `cp .env.example .env`, `docker compose up -d`, `pnpm install`, `pnpm --filter @beautyspa/api db:migrate && db:seed`, `pnpm dev`, test commands, URLs (`http://localhost:3001/v1/docs`, Mailpit `http://localhost:8025`).
  - Root `README.md`: one paragraph on the product + links to `docs/`.
- [ ] **Step 1: Write the workflow and docs.**
- [ ] **Step 2: Validate workflow syntax** — Run: `npx --yes @action-validator/cli .github/workflows/ci.yml` · Expected: exit 0.
- [ ] **Step 3: Full local run from clean** — `docker compose down -v && docker compose up -d && pnpm install --frozen-lockfile && pnpm turbo run lint typecheck test build && pnpm --filter @beautyspa/api db:deploy && pnpm --filter @beautyspa/api test:int && pnpm --filter @beautyspa/api db:drift` (with `DATABASE_URL` pointed at the test DB for deploy) · Expected: all exit 0.
- [ ] **Step 4: Commit** — `ci: lint, typecheck, unit, integration and drift checks; development docs`

---

## Done when

- All 8 tasks committed on `feat/mvp-01-foundation`, each reviewed by `reviewer-opus` with findings fixed and re-reviewed.
- Final branch review by `reviewer-opus` passes.
- The Task 8 Step 3 command passes from a clean checkout.
- Branch pushed and merged to `main` (when a remote exists); `docs/handoff.md` written with done / commits / next (plan 02) / open questions.
