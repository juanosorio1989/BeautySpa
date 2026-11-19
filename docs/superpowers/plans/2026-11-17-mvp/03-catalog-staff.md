# Plan 03 — Catalog, staff, schedules API

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The OWNER manages the whole salon setup through `/v1/staff/*` (categories, services with level prices, levels, resource types, resources, employees with profiles/services/locations, working hours, time off, location settings, hours and closures, audit log); the public site reads services, employees and locations from `/v1/public/*`; `db:seed` builds a realistic demo salon.

**Architecture:** Three new NestJS modules (`catalog`, `staff`, `locations`) plus `public` and an audit read controller, all on the existing global `AccessGuard`, `TenancyService`, `AuditService` and `ProblemFilter`. Request/response schemas live in `@beautyspa/contracts` and are used through `nestjs-zod` DTOs (validation + OpenAPI). Every write runs in one Prisma transaction with its audit row. A hand-written migration adds `CHECK` constraints for hours, ranges and amounts.

**Tech Stack:** NestJS 11, Prisma 6, Zod 3 + `nestjs-zod`, Vitest + supertest against real Postgres/Redis.

**Spec:** `docs/superpowers/specs/2026-11-17-mvp-design/` — `data-model.md` (Tenancy, Staff and auth, Catalog and resources), `api.md` (Public, Staff, RBAC), `availability.md` (Price shown for "Any", inputs), `architecture.md` (modules, Location call), `security-quality.md` (audit, seeds).

**Branch:** `feat/mvp-03-catalog-staff`

## Routing

Main session: Opus 5.5 (orchestrates, does not implement normal tasks).

| Task | What | Implementer | Reviewer | Why |
|---|---|---|---|---|
| 1 | Contracts: wall time, catalog, staff, settings, audit, public | implementer-sonnet | reviewer-opus | schemas fully specified |
| 2 | `CHECK` migration, `src/common` db/wall-time helpers, `LocationService`, test helpers | **implementer-opus** | reviewer-opus | schema/migration (Opus rule) |
| 3 | Categories, levels, resource types, resources CRUD | implementer-sonnet | reviewer-opus | plain CRUD on Task 2 helpers |
| 4 | Services with level prices | implementer-sonnet | reviewer-opus | CRUD, rules listed |
| 5 | Employees CRUD (staff user, profile, services, locations, invite, deactivate) | **implementer-opus** | reviewer-opus | auth: roles, sessions revoked (Opus rule) |
| 6 | Working hours and time off | implementer-sonnet | reviewer-opus | rules and tests listed |
| 7 | Location settings, hours and closures | implementer-sonnet | reviewer-opus | rules and tests listed |
| 8 | Public reads, audit read, RBAC matrix test | implementer-sonnet | reviewer-opus | read-only queries, rules listed |
| 9 | Full development seed | implementer-sonnet | reviewer-opus | data table given |

One final branch review (`reviewer-opus`). Not a money/production-data branch (prices are catalog data; no payments, no customer writes).

## Design calls (made in this plan; the spec is updated in the task that implements each)

1. **Wall times in the API are `"HH:MM"`; an end time may be `"24:00"`.** The DB stores 24:00 as `00:00` (`time` cannot hold 24:00). `"00:00"` as an end is rejected (end must be after start). (Tasks 1, 2, `api.md`)
2. **Working hours are replaced per employee and location**: `GET`/`PUT /staff/employees/:id/working-hours?locationId=` with `{ days: [{ weekday, start, end }] }`, not row-level CRUD. Same for location hours inside `PATCH /staff/settings`. (Tasks 6, 7, `api.md`)
3. **No hard delete for services, resources and staff**: they have history (segments). `PATCH { active: false }` instead. Categories, levels, resource types, time off and closures can be deleted; a delete blocked by a foreign key answers 409 `CONFLICT`. (Tasks 3–5, 7)
4. **Every staff member is an "employee" row** (`/staff/employees` lists OWNER, RECEPTION and EMPLOYEE). `profile` (display name, level, bookable online) is present only for people who perform services; `serviceIds` require a profile. (Task 5, `api.md`)
5. **Employee reads** (`GET /staff/employees`, `/:id`) are OWNER and RECEPTION (reception books for a professional); writes are OWNER. Working hours `GET`: OWNER, RECEPTION, EMPLOYEE (own only); `PUT`: OWNER. Closures `GET`: all staff; writes OWNER. (Tasks 5–7)
6. **An OWNER cannot change their own `role`, `active` or `canLogin`** (403), so the salon never loses its last owner by accident. Changing another member's `role`, `email`, `active` or `canLogin` revokes all their refresh tokens in the same transaction. (Task 5)
7. **Location closures** get `GET/POST/PATCH/DELETE /staff/closures` (missing from the spec's table). (Task 7, `api.md`)
8. **Public lists show only what can be booked**: `/public/services` lists a service only if it is active, online-bookable, has at least one bookable qualified employee at the location, and (when it needs a resource type) the location has an active resource of that type. `fromPriceCents` = lowest price among those employees (level override, else base). (Task 8, `api.md`)
9. **Foreign ids in a body are checked against the organization**: an unknown or other-org id answers 400 `VALIDATION_FAILED` with `errors: [{ path, message }]`; an unknown or other-org `:id` in the path answers 404 `NOT_FOUND`. (Tasks 2–8)
10. **Audit pagination** uses `cursor` = the last returned audit id (UUID v7, ordered by id desc), `limit` 1–100 (default 50); `?entity=&id=` filter as in the spec. (Task 8, `api.md`)
11. **`pgCode` moves to `apps/api/src/common/db-errors.ts`** now (the test helper re-exports it); plan 04 adds the `23P01` → `SLOT_TAKEN` mapping. (Task 2)

## Global Constraints

- Everything from plans 01–02 still holds (Node 22, strict TS, English only, no secrets committed or logged, platform packages have no DOM/Node imports, problem+json via `ProblemFilter`, services throw `HttpException`s with `{ code }`).
- Every controller handler has an auth decorator (`@Public()`, `@StaffAuth(...)`); the guard answers 403 to undecorated routes.
- Every query filters by `orgId` from the principal (`principal.org`) or `TenancyService.getOrgId()` on public routes. Child rows copy `organization_id` from their parent row (`working_hours`/`time_off` from `staff_user`, `resource` from `location`), never from the body.
- Every write (create/update/delete) records one audit row in the same transaction: `actorType "STAFF"`, `actorId principal.sub`, `action "<entity>.create|update|delete"`, `entity` = table name (`service_category`, `level`, `resource_type`, `resource`, `service`, `staff_user`, `working_hours`, `time_off`, `location`, `location_closure`), `entityId` = row id (`working_hours`: `"<staffId>:<locationId>"`), `before`/`after` = the API response shape of the row (never `passwordHash`, `totpSecretEnc` or tokens), `ip` from `requestMeta(req).ip`.
- Translatable text uses the existing `LocalizedTextSchema` (`{ en, es }`, both non-empty). Money is integer cents.
- `:id` path params use `new ZodValidationPipe(IdSchema)` (400 on non-UUID), as in `StaffAdminController`.
- Responses are plain JSON objects parsed by nothing on the server; controllers declare `@ApiOkResponse({ type: XDto })` with `createZodDto` DTOs as in `StaffAuthController`. Creates answer 201, deletes 204.
- Each task ends with green `pnpm turbo run lint typecheck test` and `pnpm --filter @beautyspa/api test:int`; docs change in the same commit.

## Review Focus

1. **A shift that ends at midnight** → `PUT` with end `"24:00"` stores `00:00` and `GET` returns `"24:00"`; `"00:00"` as an end is 400 (tests in Tasks 1, 2, 6).
2. **Overlapping ranges on the same weekday** (`09:00–13:00` and `12:00–15:00`) → 400 with the path of the second range; touching ranges (`13:00` end, `13:00` start) are accepted (tests in Task 1, applied in Tasks 6 and 7).
3. **An id from another organization** (`categoryId`, `levelId`, `resourceTypeId`, `serviceIds[]`, `locationIds[]`, `employeeId`) → 400 `VALIDATION_FAILED` with that path, never 500 and never a cross-tenant row; another org's `:id` → 404 (tests in Tasks 3, 4, 5, 6).
4. **Deleting something still in use** (resource type used by a service or resource) → 409 `CONFLICT`, not 500 (test in Task 3).
5. **A deactivated employee, an employee whose profile is not bookable, or a service whose resource type (chair, cabin) has no active resource** disappears from `/public/*`; deactivation also ends that person's sessions (tests in Tasks 5 and 8).

---

### Task 1: Contracts — wall time, catalog, staff, settings, audit, public

**Files:**
- Modify: `packages/contracts/src/common.ts`, `packages/contracts/src/index.ts`
- Create: `packages/contracts/src/catalog.ts`, `staff.ts`, `settings.ts`, `audit.ts`, `public.ts` and a `.test.ts` next to each (all in `packages/contracts/src/`)

**Interfaces — Produces** (exported from `@beautyspa/contracts`, each with `type X = z.infer<typeof XSchema>`; "Update" schemas are `.partial()` of the input plus `.refine(o => Object.keys(o).length > 0, "Empty update")`):
- `common.ts`: `WallTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)`; `EndWallTimeSchema = z.union([WallTimeSchema, z.literal("24:00")])`; `WeekdaySchema = z.number().int().min(0).max(6)`; `DayHoursSchema { weekday, start: WallTimeSchema, end: EndWallTimeSchema }` refined `start < end` (string compare, message `"end must be after start"`, path `end`); `WeekHoursSchema = z.array(DayHoursSchema).max(50)` refined so that ranges of the same weekday do not overlap (touching allowed); the issue path is `[index]` of the later range in input order sorted by `(weekday, start)` (use `superRefine`, path = original index); `TimezoneSchema = z.string().min(1).max(64).refine(isValidTimeZone)` where `isValidTimeZone` tries `new Intl.DateTimeFormat("en-US", { timeZone })`.
- `catalog.ts`:
  - `CategoryInputSchema { name: LocalizedTextSchema, sort: z.number().int().min(0).max(10000).default(0) }`, `CategoryUpdateSchema`, `CategorySchema { id, name, sort }`
  - `LevelInputSchema { name, rank: z.number().int().min(0).max(100) }`, `LevelUpdateSchema`, `LevelSchema { id, name, rank }`
  - `ResourceTypeInputSchema { name }`, `ResourceTypeUpdateSchema`, `ResourceTypeSchema { id, name }`
  - `ResourceInputSchema { locationId: IdSchema.optional(), resourceTypeId: IdSchema, name: z.string().trim().min(1).max(80), active: z.boolean().default(true) }`; `ResourceUpdateSchema` = partial of `{ resourceTypeId, name, active }` (location cannot change); `ResourceSchema { id, locationId, resourceTypeId, name, active }`
  - `LevelPriceSchema { levelId: IdSchema, durationMin: z.number().int().min(5).max(600), priceCents: MoneyCentsSchema.max(1_000_000) }`
  - `ServiceInputSchema { categoryId: IdSchema.nullable(), name, description: LocalizedTextSchema.nullable().default(null), durationMin: int 5–600, bufferAfterMin: int 0–120 default 0, priceCents: MoneyCentsSchema.max(1_000_000), parallelizable: boolean default false, resourceTypeId: IdSchema.nullable().default(null), onlineBookable: boolean default true, active: boolean default true, levelPrices: z.array(LevelPriceSchema).max(20).default([]) }` refined: `levelPrices[].levelId` unique (path `levelPrices.<i>.levelId`); `ServiceUpdateSchema` (partial; `levelPrices` replaces the whole list when present); `ServiceSchema` = all fields + `id` (no defaults)
- `staff.ts`:
  - `EmployeeProfileSchema { displayName: z.string().trim().min(1).max(60), bio: LocalizedTextSchema.nullable().default(null), photoUrl: z.string().url().startsWith("https://").max(500).nullable().default(null), levelId: IdSchema.nullable().default(null), bookableOnline: z.boolean().default(true) }`
  - `EmployeeCreateSchema { role: StaffRoleSchema, email: EmailSchema.nullable().default(null), locale: LocaleSchema, canLogin: z.boolean().default(false), locationIds: z.array(IdSchema).min(1).max(10).optional(), profile: EmployeeProfileSchema.nullable().default(null), serviceIds: z.array(IdSchema).max(100).default([]), sendInvite: z.boolean().default(false) }` refined: `canLogin` requires `email` (path `email`); `sendInvite` requires `canLogin` (path `sendInvite`); non-empty `serviceIds` require `profile` (path `serviceIds`); `locationIds` and `serviceIds` unique
  - `EmployeeUpdateSchema` = partial of `{ role, email, locale, canLogin, active: z.boolean(), locationIds, profile, serviceIds }` (cross-field rules are re-checked in the service against the stored row)
  - `EmployeeSchema { id, role, email: string|null, locale, canLogin, active, hasPassword: boolean, mfaEnrolled: boolean, locationIds: Id[], profile: (EmployeeProfile)|null, serviceIds: Id[] }`
  - `WorkingHoursQuerySchema { locationId: IdSchema.optional() }`; `WorkingHoursPutSchema { days: WeekHoursSchema }`; `WorkingHoursSchema { employeeId, locationId, days: DayHours[] }`
  - `TimeOffKindSchema = z.enum(["VACATION","BLOCK"])`; `TimeOffInputSchema { employeeId, locationId: IdSchema.nullable().default(null), startsAt: IsoInstantSchema, endsAt: IsoInstantSchema, kind, note: z.string().trim().max(500).nullable().default(null) }` refined `startsAt < endsAt` (path `endsAt`) and span ≤ 366 days (path `endsAt`); `TimeOffUpdateSchema` = partial of `{ locationId, startsAt, endsAt, kind, note }` (range re-checked in the service); `TimeOffSchema` = input + `id`; `TimeOffQuerySchema { from: IsoInstantSchema, to: IsoInstantSchema, employeeId: IdSchema.optional(), locationId: IdSchema.optional() }` refined `from < to`, span ≤ 366 days
- `settings.ts`:
  - `LocationSettingsSchema { slotIntervalMin: z.union([5,10,15,20,30,60 as literals]), holdMinutes: int 1–30, cancelWindowHours: int 0–168, bookingHorizonDays: int 1–365, minLeadMinutes: int 0–1440 }`; `DEFAULT_LOCATION_SETTINGS = { slotIntervalMin: 15, holdMinutes: 5, cancelWindowHours: 24, bookingHorizonDays: 60, minLeadMinutes: 60 }`
  - `StaffSettingsSchema { location: { id, name, address: string|null, phone: PhoneE164|null, timezone }, settings: LocationSettings, hours: DayHours[] }`
  - `StaffSettingsPatchSchema { name?: trim 1–80, address?: trim max 200 nullable, phone?: PhoneE164Schema.nullable(), timezone?: TimezoneSchema, settings?: LocationSettingsSchema.partial(), hours?: WeekHoursSchema }` + empty-update refine; `LocationQuerySchema { locationId: IdSchema.optional() }`
  - `ClosureInputSchema { locationId: IdSchema.optional(), startsAt, endsAt, reason: trim max 200 nullable default null }` refined like time off; `ClosureUpdateSchema` partial of `{ startsAt, endsAt, reason }`; `ClosureSchema { id, locationId, startsAt, endsAt, reason }`; `ClosureQuerySchema { from, to, locationId? }` refined like `TimeOffQuerySchema`
- `audit.ts`: `AuditQuerySchema { entity: z.string().max(64).optional(), id: z.string().max(200).optional(), cursor: IdSchema.optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }`; `AuditEntrySchema { id, actorType: z.enum(["STAFF","CUSTOMER","SYSTEM"]), actorId: Id|null, action, entity, entityId: string|null, before: z.unknown().nullable(), after: z.unknown().nullable(), ip: string|null, at: IsoInstantSchema }`; `AuditPageSchema { items: AuditEntry[], nextCursor: Id|null }`
- `public.ts`: `PublicLocationSchema { id, name, address, phone, timezone, hours: DayHours[] }`; `PublicServiceSchema { id, categoryId: Id|null, name, description, durationMin, priceCents, fromPriceCents: MoneyCents, parallelizable }`; `PublicServicesResponseSchema { categories: Category[], services: PublicService[] }`; `PublicEmployeeSchema { id, displayName, bio, photoUrl, level: Level|null, serviceIds: Id[] }`

- [ ] **Step 1: Write failing tests** (one file per module):
  - `DayHoursSchema`: `{weekday:1,start:"09:00",end:"24:00"}` passes; `end:"00:00"` fails with path `end`; `start:"24:00"` fails; `weekday:7` fails; `start:"9:00"` fails.
  - `WeekHoursSchema`: `[{1,"09:00","13:00"},{1,"13:00","19:00"}]` passes; `[{1,"09:00","13:00"},{1,"12:00","15:00"}]` fails with path `[1]`; same ranges on weekdays 1 and 2 pass; overlap given in reverse input order reports the index of the range that starts later.
  - `TimezoneSchema`: `"America/New_York"` passes, `"Mars/Base"` fails.
  - `ServiceInputSchema`: defaults applied (`bufferAfterMin 0`, `onlineBookable true`, `levelPrices []`); `durationMin 4` fails; duplicate `levelId` fails with path `levelPrices.1.levelId`; `ServiceUpdateSchema.parse({})` fails.
  - `EmployeeCreateSchema`: `canLogin:true` without email fails (path `email`); `sendInvite:true, canLogin:false` fails; `serviceIds:[id]` with `profile:null` fails (path `serviceIds`); `photoUrl:"http://x.dev/a.jpg"` fails; `email:" Ana@Salon.COM "` → `"ana@salon.com"`.
  - `TimeOffInputSchema`: `endsAt == startsAt` fails; 367-day span fails; `TimeOffQuerySchema` with `from > to` fails.
  - `LocationSettingsSchema`: `slotIntervalMin 15` passes, `7` fails; `holdMinutes 0` fails.
  - `AuditQuerySchema.parse({ limit: "20" }).limit === 20`; `limit "0"` fails; default 50.
- [ ] **Step 2: Run** `pnpm --filter @beautyspa/contracts test` · Expected: FAIL (modules not found).
- [ ] **Step 3: Implement** the schemas above; export the new modules from `index.ts`.
- [ ] **Step 4: Run** `pnpm turbo run lint typecheck test build --filter=@beautyspa/contracts` · Expected: PASS.
- [ ] **Step 5: Commit** — `feat(contracts): catalog, staff, schedule, settings, audit and public schemas`

---

### Task 2: `CHECK` migration, common helpers, `LocationService`, test helpers

**Files:**
- Create: `apps/api/prisma/migrations/20261119000000_schedule_checks/migration.sql` (hand-written)
- Create: `apps/api/src/common/db-errors.ts`, `apps/api/src/common/db-errors.test.ts`, `apps/api/src/common/wall-time.ts`, `apps/api/src/common/wall-time.test.ts`, `apps/api/src/common/http-errors.ts`, `apps/api/src/tenancy/location.service.ts`
- Modify: `apps/api/src/tenancy/tenancy.module.ts` (provide/export `LocationService`), `apps/api/test/integration/helpers.ts` (re-export `pgCode` from `src/common/db-errors`, add `staffSession`), `apps/api/test/integration/schema-integrity.int.test.ts`, `apps/api/prisma/schema.prisma` (comments naming the new constraints)
- Create: `apps/api/test/integration/locations/location-resolve.int.test.ts`
- Docs: `docs/superpowers/specs/2026-11-17-mvp-design/data-model.md` (constraint list; design calls 1 and 11)

**Interfaces — Produces:**
- Migration, constraint names exactly:
  - `working_hours_weekday` `CHECK (weekday BETWEEN 0 AND 6)`; `working_hours_time_order` `CHECK (start_time < end_time OR end_time = '00:00'::time)`
  - `location_hours_weekday`; `location_hours_time_order` `CHECK (opens < closes OR closes = '00:00'::time)`
  - `time_off_time_order` `CHECK (starts_at < ends_at)`; `location_closure_time_order` `CHECK (starts_at < ends_at)`
  - `service_amounts` `CHECK (duration_min > 0 AND buffer_after_min >= 0 AND price_cents >= 0)`; `service_level_price_amounts` `CHECK (duration_min > 0 AND price_cents >= 0)`
- `db-errors.ts`: `pgCode(err: unknown): string | undefined` (moved verbatim from `test/integration/helpers.ts`); `isUniqueViolation(err): boolean` (Prisma `P2002` or SQLSTATE `23505`); `isForeignKeyViolation(err): boolean` (`P2003` or `23503`).
- `wall-time.ts`: `timeToWall(t: Date, role: "start" | "end"): WallTime` (reads UTC hours/minutes of a Prisma `@db.Time` value; `role "end"` maps `00:00` to `"24:00"`); `wallToTime(w: WallTime): Date` (`"24:00"` → `1970-01-01T00:00:00.000Z`, else `1970-01-01THH:MM:00.000Z`); `dayHoursFromRows(rows: { weekday: number; start: Date; end: Date }[]): DayHours[]` sorted by `(weekday, start)`.
- `http-errors.ts`: `invalidRef(path: string, message: string): BadRequestException` (body `{ code: "VALIDATION_FAILED", message: "Validation failed", errors: [{ path, message }] }`); `notFound(what: string): NotFoundException` (`{ code: "NOT_FOUND", message: \`${what} not found\` }`); `inUse(what: string): ConflictException` (`{ code: "CONFLICT", message: \`${what} is in use\` }`).
- `LocationService.resolve(orgId: string, locationId?: string, db?: Prisma.TransactionClient): Promise<{ id: string; timezone: string }>`: given id not in org → `notFound("Location")`; absent and exactly one location → it; absent and more than one → `invalidRef("locationId", "locationId is required")`; zero locations → plain `Error` (500, misconfiguration). `LocationService.assertInOrg(orgId, ids: string[], path: string, db?)`: throws `invalidRef(\`${path}.${i}\`, "Unknown location")` for the first id not in the org.
- `test/integration/helpers.ts`: `staffSession(app: INestApplication, prisma: PrismaClient, f: Fixture, role: StaffRole, email?: string): Promise<{ id: string; token: string }>` — creates a staff user via `createStaff` (`canLogin` true, enrolled) and returns an access token from `app.get(TokenService).issueAccess(...)`.

- [ ] **Step 1: Write failing tests**
  - `wall-time.test.ts`: `timeToWall(new Date("1970-01-01T00:00:00Z"), "end") === "24:00"`; same with `"start"` → `"00:00"`; `timeToWall(new Date("1970-01-01T09:30:00Z"), "start") === "09:30"`; `wallToTime("24:00").toISOString() === "1970-01-01T00:00:00.000Z"`; `dayHoursFromRows` sorts and maps end midnight to `"24:00"`.
  - `db-errors.test.ts`: `pgCode` on a message containing `code: "23514"` → `"23514"`; `isUniqueViolation({ code: "P2002" })` true; `isForeignKeyViolation({ code: "P2003" })` true; `isForeignKeyViolation(new Error("x"))` false.
  - `schema-integrity.int.test.ts` (new `describe("schedule checks")`): all eight constraint names exist in `pg_constraint`; inserting `working_hours` with `weekday 7` → `23514`; with `start 10:00, end 09:00` → `23514`; with `start 18:00, end 00:00` succeeds; `time_off` with `starts_at = ends_at` → `23514`; `service` with `duration_min 0` → `23514`.
  - `location-resolve.int.test.ts`: one location → resolved without id; an id from another org → 404; after adding a second location, no id → 400 with `errors[0].path === "locationId"` (call through `LocationService` directly and assert the exception's response body).
- [ ] **Step 2: Run** `pnpm --filter @beautyspa/api test && pnpm --filter @beautyspa/api test:int test/integration/schema-integrity.int.test.ts test/integration/locations` · Expected: FAIL.
- [ ] **Step 3: Write the migration** by hand (one `ALTER TABLE ... ADD CONSTRAINT` per constraint) and apply it: `pnpm --filter @beautyspa/api db:deploy`. The test DB gets it from the integration `globalSetup`.
- [ ] **Step 4: Implement** the helpers, `LocationService`, and `staffSession`; switch every `pgCode` import in `test/` to the re-export.
- [ ] **Step 5: Run** `pnpm turbo run lint typecheck test && pnpm --filter @beautyspa/api test:int && pnpm --filter @beautyspa/api db:drift` · Expected: PASS, drift reports no difference.
- [ ] **Step 6: Update `data-model.md`** with the constraint names and the API wall-time rule.
- [ ] **Step 7: Commit** — `feat(api): schedule CHECK constraints, wall-time and db-error helpers, location resolver`

---

### Task 3: Categories, levels, resource types, resources CRUD

**Files:**
- Create: `apps/api/src/catalog/catalog.module.ts`, `categories.controller.ts`, `categories.service.ts`, `levels.controller.ts`, `levels.service.ts`, `resource-types.controller.ts`, `resource-types.service.ts`, `resources.controller.ts`, `resources.service.ts` (all in `apps/api/src/catalog/`)
- Modify: `apps/api/src/app.module.ts` (import `CatalogModule`)
- Test: `apps/api/test/integration/catalog/simple-crud.int.test.ts`
- Docs: `apps/api/README.md` (modules list)

**Interfaces:**
- Consumes: Task 1 schemas; Task 2 `invalidRef`, `notFound`, `inUse`, `isForeignKeyViolation`, `LocationService`, `staffSession`; `AuditService.record(entry, tx)`.
- Produces (all `@StaffAuth("OWNER")`): `GET/POST /staff/categories`, `GET/PATCH/DELETE /staff/categories/:id`; same five routes for `/staff/levels`, `/staff/resource-types`; `/staff/resources` has `GET` (query `locationId?`), `POST`, `GET/PATCH /:id`, no `DELETE`. Lists sort: categories by `sort, name.en`; levels by `rank`; resource types by `name.en`; resources by `name`.
- `CategoriesService`, `LevelsService`, `ResourceTypesService`, `ResourcesService` each with `list(orgId, ...)`, `get(orgId, id)`, `create(principal, input, ip)`, `update(principal, id, patch, ip)`, `remove(principal, id, ip)` (not on resources). Each maps its Prisma row to the Task 1 response schema with a private `toDto`.

Rules:
- `ResourcesService.create`: `locationId` resolved by `LocationService.resolve`; `organizationId` copied from the location; `resourceTypeId` not in org → `invalidRef("resourceTypeId", "Unknown resource type")`.
- Delete of a resource type referenced by a service or resource: catch `isForeignKeyViolation` → `inUse("Resource type")` (409). Deleting a category sets its services' `categoryId` to null (existing FK `SetNull`); deleting a level removes its level prices and clears `employee_profile.level_id` (existing FKs).

- [ ] **Step 1: Write failing tests** (`simple-crud.int.test.ts`, OWNER token from `staffSession`):
  - Category: POST → 201 with `id`, `sort 0`; GET list sorted; PATCH `{ sort: 5 }` → 200; DELETE → 204, then GET `/:id` → 404; an audit row `service_category.create` with `after.name.en` exists, and `service_category.delete` has `before` set.
  - Level and resource type: create/update/delete round trip (one test each).
  - DELETE a resource type used by the fixture's service → 409 `CONFLICT`.
  - Resource: POST without `locationId` → 201 with the fixture location; POST with another org's `resourceTypeId` → 400, `errors[0].path === "resourceTypeId"`; PATCH `{ active: false }` → 200; `DELETE /staff/resources/:id` → 404 (no route).
  - GET `/staff/categories/<other-org id>` → 404; `/staff/categories/not-a-uuid` → 400.
  - RECEPTION and EMPLOYEE tokens → 403 on `GET /staff/categories` and `POST /staff/resources`; no token → 401.
- [ ] **Step 2: Run** `pnpm --filter @beautyspa/api test:int test/integration/catalog` · Expected: FAIL (404 on routes).
- [ ] **Step 3: Implement** the module, controllers (DTOs via `createZodDto`, `IdPipe`) and services; each write is `prisma.$transaction(async (tx) => { ...; await audit.record({...}, tx) })`.
- [ ] **Step 4: Run** `pnpm turbo run lint typecheck test && pnpm --filter @beautyspa/api test:int` · Expected: PASS.
- [ ] **Step 5: Commit** — `feat(api): categories, levels, resource types and resources CRUD`

---

### Task 4: Services with level prices

**Files:**
- Create: `apps/api/src/catalog/service-catalog.controller.ts`, `apps/api/src/catalog/service-catalog.service.ts`
- Modify: `apps/api/src/catalog/catalog.module.ts`
- Test: `apps/api/test/integration/catalog/services.int.test.ts`

**Interfaces:**
- Consumes: Task 1 `ServiceInputSchema`, `ServiceUpdateSchema`, `ServiceSchema`; Task 2 helpers; Task 3 module.
- Produces (`@StaffAuth("OWNER")`): `GET /staff/services` (query `active?: "true"|"false"`, `categoryId?`), `POST /staff/services`, `GET/PATCH /staff/services/:id`; no `DELETE`. `ServiceCatalogService.list/get/create/update`. List sort: category `sort` (uncategorized last), then `name.en`.

Rules:
- `categoryId`, `resourceTypeId` and every `levelPrices[i].levelId` must belong to the org → `invalidRef("categoryId" | "resourceTypeId" | "levelPrices.<i>.levelId", ...)`.
- `levelPrices` in a PATCH replaces all rows for the service (`deleteMany` + `createMany` in the same transaction).
- Audit `service.create|update` with the full `ServiceSchema` shape (including `levelPrices`).

- [ ] **Step 1: Write failing tests:**
  - POST with two level prices → 201; GET `/:id` returns them sorted by level `rank`.
  - PATCH `{ levelPrices: [] }` removes them; PATCH `{ priceCents: 4500 }` keeps the others; audit `service.update` has `before.priceCents` and `after.priceCents`.
  - POST with another org's `categoryId` → 400 path `categoryId`; with another org's level → 400 path `levelPrices.0.levelId`; `durationMin: 0` → 400.
  - GET `?active=false` returns only inactive services.
  - EMPLOYEE token → 403.
- [ ] **Step 2: Run** `pnpm --filter @beautyspa/api test:int test/integration/catalog/services.int.test.ts` · Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm turbo run lint typecheck test && pnpm --filter @beautyspa/api test:int` · Expected: PASS.
- [ ] **Step 5: Commit** — `feat(api): services with per-level price overrides`

---

### Task 5: Employees CRUD (Opus)

**Files:**
- Create: `apps/api/src/staff/staff.module.ts`, `apps/api/src/staff/employees.controller.ts`, `apps/api/src/staff/employees.service.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/test/integration/staff/employees.int.test.ts`
- Docs: `docs/superpowers/specs/2026-11-17-mvp-design/api.md` (design calls 3–6)

**Interfaces:**
- Consumes: Task 1 `EmployeeCreateSchema`, `EmployeeUpdateSchema`, `EmployeeSchema`; Task 2 helpers and `LocationService`; `StaffLinksService.inviteByOwner(owner, staffId, ip)` and `RefreshTokenService.revokeAllFor(subject, tx)` (both exported by `AuthModule`; the subject shape is the one `RefreshTokenService` already uses for staff).
- Produces: `GET /staff/employees` (OWNER, RECEPTION; query `active?`, `locationId?`), `GET /staff/employees/:id` (OWNER, RECEPTION), `POST /staff/employees` (OWNER), `PATCH /staff/employees/:id` (OWNER). The existing `POST /:id/invite` and `/:id/reset-2fa` in `StaffAdminController` stay. `EmployeesService.list/get/create/update`; `EmployeesService.toDto(row)` builds `EmployeeSchema` (`hasPassword = passwordHash !== null`, `mfaEnrolled = totpEnrolledAt !== null`). List sort: active first, then `profile.displayName ?? email`.

Rules:
- Create (one transaction): `staff_user` (`organizationId` = principal org), `staff_location` rows (`locationIds`, else the `LocationService.resolve` default), `employee_profile` when `profile` is set, `employee_service` rows; `levelId`, `serviceIds[i]`, `locationIds[i]` checked against the org (`invalidRef` with that path); duplicate email → 409 `CONFLICT` (`isUniqueViolation`). Audit `staff_user.create`. After commit, if `sendInvite`, call `inviteByOwner(principal, id, ip)` (it sends the email and audits `staff.invite`).
- Update (one transaction, row locked `FOR UPDATE`): resulting row must still satisfy `canLogin ⇒ email` and `serviceIds non-empty ⇒ profile` (400 with paths `email` / `serviceIds`). `profile: null` deletes the profile and all `employee_service` rows. `locationIds` replaces `staff_location`; removed locations also delete that member's `working_hours` rows there and `time_off` rows bound to them. `serviceIds` replaces `employee_service`.
- Self-protection: when `id === principal.sub`, any of `role`, `active`, `canLogin` in the patch → 403 `FORBIDDEN` ("You cannot change your own role or access").
- Sessions: if the patch changes `role`, `email`, `active` (to false) or `canLogin` (to false), call `revokeAllFor` for that staff member inside the transaction.
- No `DELETE` route: deactivate with `active: false`.

- [ ] **Step 1: Write failing tests** (`employees.int.test.ts`):
  - POST EMPLOYEE with profile, two services, `canLogin:false`, no email → 201; `locationIds` = fixture location; `profile.bookableOnline === true`; audit `staff_user.create` whose `after` has no `passwordHash` key.
  - POST with `canLogin:true, email, sendInvite:true` → 201 and the console mailer captured one invite email.
  - POST with another org's service id → 400 path `serviceIds.0`; duplicate email → 409.
  - PATCH `{ profile: null }` removes services (`serviceIds: []`).
  - PATCH `{ active: false }` on a member with a live refresh token → 200, then `POST /v1/auth/refresh` with that token → 401.
  - PATCH `{ locationIds: [second location] }` deletes the working hours at the first location.
  - OWNER PATCH on self `{ role: "RECEPTION" }` → 403; `{ locale: "es" }` on self → 200.
  - RECEPTION: GET list → 200, POST → 403; EMPLOYEE GET list → 403. Another org's `:id` → 404.
- [ ] **Step 2: Run** `pnpm --filter @beautyspa/api test:int test/integration/staff/employees.int.test.ts` · Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm turbo run lint typecheck test && pnpm --filter @beautyspa/api test:int` · Expected: PASS.
- [ ] **Step 5: Update `api.md`**, then commit — `feat(api): employees CRUD with profiles, services, locations and session revocation`

---

### Task 6: Working hours and time off

**Files:**
- Create: `apps/api/src/staff/working-hours.controller.ts`, `working-hours.service.ts`, `time-off.controller.ts`, `time-off.service.ts` (in `apps/api/src/staff/`)
- Modify: `apps/api/src/staff/staff.module.ts`
- Test: `apps/api/test/integration/staff/working-hours.int.test.ts`, `apps/api/test/integration/staff/time-off.int.test.ts`
- Docs: `api.md` (design call 2)

**Interfaces:**
- Consumes: Task 1 `WorkingHours*`, `TimeOff*` schemas; Task 2 `wallToTime`, `dayHoursFromRows`, `LocationService`, helpers.
- Produces:
  - `GET /staff/employees/:id/working-hours?locationId=` (`@StaffAuth()`; EMPLOYEE only when `:id === principal.sub`, else 403) → `WorkingHours`; `PUT` same path (OWNER) body `WorkingHoursPut` → `WorkingHours`. `WorkingHoursService.get(principal, staffId, locationId?)`, `.replace(principal, staffId, locationId | undefined, days, ip)`.
  - `GET /staff/time-off` (`TimeOffQuery`; OWNER/RECEPTION see all, EMPLOYEE forced to own and 403 if `employeeId` is someone else) → `TimeOff[]` overlapping `[from, to)`, sorted by `startsAt`; `POST` (OWNER, RECEPTION) → 201; `PATCH /:id`, `DELETE /:id` (OWNER, RECEPTION). `TimeOffService.list/create/update/remove`.

Rules:
- Working hours: `locationId` resolved by `LocationService.resolve`; the member must be assigned to it (`staff_location`), else `invalidRef("locationId", "Employee is not assigned to this location")`; replace = `deleteMany` + `createMany` for `(staffUserId, locationId)` in one transaction; `organizationId` from the staff row. Audit `working_hours.update`, `entityId "<staffId>:<locationId>"`, `before`/`after` = `{ days }`.
- Time off: `employeeId` must be an org staff member (`invalidRef("employeeId", ...)`); non-null `locationId` must be one of the member's locations; PATCH re-checks `startsAt < endsAt` on the merged row (400 path `endsAt`). Overlapping time-off rows are allowed.

- [ ] **Step 1: Write failing tests:**
  - PUT `{ days: [{2,"09:00","13:00"},{2,"14:00","24:00"}] }` → 200; DB row for the second has `end_time 00:00`; GET returns `"24:00"`.
  - PUT twice: second call replaces (row count equals the second payload); audit has `before.days` of the first.
  - PUT with overlapping ranges → 400 path `days.1`; for a location the member is not assigned to → 400 path `locationId`.
  - EMPLOYEE GET own → 200; another member's → 403; EMPLOYEE PUT own → 403.
  - Time off: RECEPTION POST VACATION for the fixture employee → 201; GET with a window that only touches its end (`from = endsAt`) → empty; overlapping window → 1 item.
  - EMPLOYEE GET with no `employeeId` → only own rows; with another `employeeId` → 403.
  - PATCH making `endsAt <= startsAt` → 400; DELETE → 204, audit `time_off.delete`.
  - POST with another org's `employeeId` → 400 path `employeeId`.
- [ ] **Step 2: Run** `pnpm --filter @beautyspa/api test:int test/integration/staff` · Expected: FAIL for the new files.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm turbo run lint typecheck test && pnpm --filter @beautyspa/api test:int` · Expected: PASS.
- [ ] **Step 5: Commit** — `feat(api): employee working hours and time off`

---

### Task 7: Location settings, hours and closures

**Files:**
- Create: `apps/api/src/locations/locations.module.ts`, `settings.controller.ts`, `settings.service.ts`, `closures.controller.ts`, `closures.service.ts` (in `apps/api/src/locations/`)
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/test/integration/locations/settings.int.test.ts`, `apps/api/test/integration/locations/closures.int.test.ts`
- Docs: `api.md` (settings shape, design call 7)

**Interfaces:**
- Consumes: Task 1 `StaffSettings*`, `LocationSettingsSchema`, `DEFAULT_LOCATION_SETTINGS`, `Closure*`; Task 2 helpers.
- Produces: `GET /staff/settings?locationId=` and `PATCH /staff/settings?locationId=` (OWNER) → `StaffSettings`; `GET /staff/closures` (`@StaffAuth()`, `ClosureQuery`, overlapping `[from, to)`, sorted by `startsAt`), `POST` (OWNER, 201), `PATCH /:id`, `DELETE /:id` (OWNER). `SettingsService.get(orgId, locationId?)`, `.patch(principal, locationId | undefined, patch, ip)`; `readLocationSettings(json: unknown): LocationSettings` (exported from `settings.service.ts`: `{ ...DEFAULT_LOCATION_SETTINGS, ...stored }` parsed by `LocationSettingsSchema`, falling back to the defaults for any invalid key) — plan 04 uses it to build the engine's `LocationInput`.

Rules:
- PATCH merges `settings` into the stored JSON (only given keys change); `hours` replaces all `location_hours` rows for the location; other fields update `location`. One transaction, audit `location.update` with full `StaffSettings` before/after.
- Closures: `locationId` resolved by `LocationService`; PATCH re-checks the merged range. Audit `location_closure.*`.

- [ ] **Step 1: Write failing tests:**
  - GET on the fixture location (stored `settings: {}`) returns `DEFAULT_LOCATION_SETTINGS` and `hours: []`.
  - PATCH `{ settings: { holdMinutes: 10 } }` keeps the other four values; PATCH `{ hours: [{0,"10:00","24:00"}] }` stores `closes 00:00` and returns `"24:00"`.
  - PATCH `{ timezone: "Mars/Base" }` → 400 path `timezone`; `{}` → 400; `{ settings: { slotIntervalMin: 7 } }` → 400.
  - RECEPTION GET settings → 403.
  - Closures: OWNER POST → 201; EMPLOYEE GET → 200 with it; EMPLOYEE POST → 403; PATCH with `endsAt` before `startsAt` → 400; DELETE → 204.
- [ ] **Step 2: Run** `pnpm --filter @beautyspa/api test:int test/integration/locations` · Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm turbo run lint typecheck test && pnpm --filter @beautyspa/api test:int` · Expected: PASS.
- [ ] **Step 5: Update `api.md`**, then commit — `feat(api): location settings, hours and closures`

---

### Task 8: Public reads, audit read, RBAC matrix

**Files:**
- Create: `apps/api/src/public/public.module.ts`, `public.controller.ts`, `public-catalog.service.ts` (in `apps/api/src/public/`); `apps/api/src/audit/audit.controller.ts`, `apps/api/src/audit/audit-query.service.ts`
- Modify: `apps/api/src/audit/audit.module.ts`, `apps/api/src/app.module.ts`
- Test: `apps/api/test/integration/public/public.int.test.ts`, `apps/api/test/integration/audit-read.int.test.ts`, `apps/api/test/integration/rbac-matrix.int.test.ts`
- Docs: `api.md` (design calls 8 and 10)

**Interfaces:**
- Consumes: Task 1 `Public*`, `Audit*` schemas; Tasks 3–7 data; Task 2 `dayHoursFromRows`, `LocationService`.
- Produces:
  - `@Public()` `GET /public/locations` → `PublicLocation[]` (all org locations, sorted by name); `GET /public/services?locationId=` → `PublicServicesResponse`; `GET /public/employees?locationId=` → `PublicEmployee[]` (sorted by `displayName`). Org from `TenancyService.getOrgId()`.
  - `@StaffAuth("OWNER")` `GET /staff/audit` (`AuditQuery`) → `AuditPage` (order `id desc`, `nextCursor` = last item id when `items.length === limit`, else null).
  - `PublicCatalogService.bookableEmployees(orgId, locationId)` (exported for plan 04): active `staff_user` with a profile where `bookableOnline`, assigned to the location, with their service ids and level.

Rules (design call 8): a listed employee is active, has `bookableOnline` profile and the location; a listed service is `active && onlineBookable`, done by ≥ 1 listed employee, and if `resourceTypeId` is set the location has ≥ 1 active resource of that type. `fromPriceCents` = min over listed qualified employees of (`service_level_price` for their level, else `priceCents`). Categories returned = those with ≥ 1 listed service. Employee `serviceIds` include only listed services.

- [ ] **Step 1: Write failing tests:**
  - Public services: a service done by a Junior (base price 4000) and a Senior (override 5500) shows `priceCents 4000, fromPriceCents 4000`; done only by the Senior → `fromPriceCents 5500`.
  - Deactivating the only qualified employee hides the service; setting their `bookableOnline:false` hides them from `/public/employees`; a service that needs a resource type (chair, cabin) whose resources are all `active:false` is hidden; `onlineBookable:false` hides it.
  - `/public/locations` returns `"24:00"` for a midnight close. No token needed for all three.
  - Audit: after 3 category creates, `?limit=2` returns 2 newest with `nextCursor`; the next page returns 1 with `nextCursor null`; `?entity=service_category&id=<id>` returns only that row's entries. RECEPTION → 403.
  - RBAC matrix (`rbac-matrix.int.test.ts`): table of `[method, path, allowedRoles]` covering every route added in Tasks 3–8; for each, every role not allowed gets 403 and a request without a token gets 401 (or 200 for `@Public()`). Requests use placeholder UUIDs and valid bodies only where needed to get past validation; assert only the status for denied roles.
- [ ] **Step 2: Run** `pnpm --filter @beautyspa/api test:int test/integration/public test/integration/audit-read.int.test.ts test/integration/rbac-matrix.int.test.ts` · Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm turbo run lint typecheck test && pnpm --filter @beautyspa/api test:int` · Expected: PASS.
- [ ] **Step 5: Update `api.md`**, then commit — `feat(api): public catalog reads, audit log read, RBAC matrix test`

---

### Task 9: Full development seed

**Files:**
- Modify: `apps/api/prisma/seed.ts` (export `seed(prisma: PrismaClient, opts?: { today?: IsoDate }): Promise<SeedCounts>`; `main()` refuses `NODE_ENV=production`, then calls it)
- Test: `apps/api/test/integration/seed.int.test.ts`
- Docs: `docs/development/README.md` (what the seed creates, that employees cannot log in until invited, `create-owner` still needed)

**Data** (idempotent by natural keys: org `slug`, location name, level/category/resource-type `name.en`, service `name.en`, staff `email`, resource name, customer phone; seed appointments are those with `notes` starting `"[seed]"`, deleted and recreated on each run):
- Org `demo-salon` "Demo Salon" (`es`); location "Main", `America/New_York`, address "123 Main St, Queens, NY", phone `+17185550100`, `DEFAULT_LOCATION_SETTINGS`, hours Mon–Sat 09:00–19:00 (Sunday closed).
- Levels: Junior / Junior (rank 1), Senior / Senior (rank 2). Resource types "Pedicure chair" / "Silla de pedicura" (resources "Chair 1", "Chair 2", "Chair 3") and "Treatment cabin" / "Cabina de tratamiento" (resources "Cabin 1", "Cabin 2").
- Categories (sort): Nails / Uñas (1), Hair / Cabello (2), Brows & lashes / Cejas y pestañas (3), Facials / Faciales (4), Massages & body / Masajes y corporales (5).
- Services (min, buffer, cents, parallelizable, resource):

| Category | EN / ES | Min | Buf | ¢ | Par | Resource |
|---|---|---|---|---|---|---|
| Nails | Classic manicure / Manicura clásica | 30 | 5 | 2500 | yes | – |
| Nails | Gel manicure / Manicura en gel | 45 | 5 | 4000 | yes | – |
| Nails | Classic pedicure / Pedicura clásica | 45 | 10 | 3500 | yes | yes |
| Nails | Spa pedicure / Pedicura spa | 60 | 10 | 5000 | yes | yes |
| Nails | Acrylic full set / Juego completo acrílico | 75 | 10 | 6000 | no | – |
| Nails | Acrylic fill / Relleno acrílico | 60 | 10 | 4500 | no | – |
| Nails | Nail art (per set) / Diseño de uñas | 15 | 0 | 1500 | no | – |
| Hair | Women's haircut / Corte de dama | 45 | 10 | 5000 | no | – |
| Hair | Men's haircut / Corte de caballero | 30 | 5 | 3000 | no | – |
| Hair | Blowout / Secado y peinado | 45 | 5 | 4000 | no | – |
| Hair | Root color / Tinte de raíz | 90 | 15 | 8500 | no | – |
| Hair | Highlights / Mechas | 120 | 15 | 15000 | no | – |
| Brows & lashes | Brow wax / Depilación de cejas | 15 | 5 | 1500 | no | – |
| Brows & lashes | Brow tint / Tinte de cejas | 20 | 5 | 2000 | no | – |
| Brows & lashes | Lash lift / Lifting de pestañas | 60 | 10 | 7000 | no | – |
| Facials | Deep cleansing facial / Limpieza facial profunda | 60 | 10 | 7000 | no | cabin |
| Facials | Hydrating facial / Facial hidratante | 60 | 10 | 8500 | no | cabin |
| Massages & body | Relaxing massage / Masaje relajante | 60 | 10 | 8000 | no | cabin |
| Massages & body | Deep tissue massage / Masaje de tejido profundo | 60 | 10 | 9500 | no | cabin |
| Massages & body | Body scrub / Exfoliación corporal | 45 | 10 | 6500 | no | cabin |

- Senior level prices: Women's haircut 6000, Root color 9500, Highlights 17000 (same durations).
- Employees (role EMPLOYEE, `canLogin false`, `locale es`, location Main, `bookableOnline true`): Ana Rivera (`ana@demo-salon.test`, Senior, all Nails), Carmen López (`carmen@demo-salon.test`, Junior, all Nails + Brow wax), Luis Ortega (`luis@demo-salon.test`, Senior, all Hair), Sofía Méndez (`sofia@demo-salon.test`, Junior, Women's haircut, Blowout, all Brows & lashes), Valeria Cruz (`valeria@demo-salon.test`, Senior, all Facials and all Massages & body). Working hours Tue–Sat 09:00–13:00 and 14:00–19:00.
- Customers (`createdVia RECEPTION`, `phoneVerifiedAt null`): María Gómez `+17185550101` `es` (WhatsApp consent granted, source RECEPTION), Jennifer Smith `+17185550102` `en` (no consent rows), Rosa Díaz `+17185550103` `es` (WhatsApp granted). Consent rows are added only when the customer has none.
- Appointments (status BOOKED, source RECEPTION, notes `"[seed] …"`), on the next Tue–Sat on or after `opts.today` (default `todayIn("America/New_York")`) at local time via `wallTimeToUtc`: María 10:00 Classic manicure (Ana) ‖ Classic pedicure (Carmen, Chair 1); Jennifer 11:00 Women's haircut (Luis, Senior price 6000); Rosa 15:00 Brow wax (Sofía). Segment `blockEndsAt = endsAt + buffer`, snapshots from the service/level price.

- [ ] **Step 1: Write the failing test** (`seed.int.test.ts`): truncate, run `seed(prisma, { today: "2026-12-01" })` twice; counts after the second run: levels 2, categories 5, services 20, level prices 3, resource types 2, resources 5, staff 5, working-hours rows 50, customers 3, consents 2, appointments 3, segments 4; the parallel appointment's two segments start at the same instant `2026-12-01T15:00:00.000Z` (10:00 EST); `GET /v1/public/services` on an integration app (with `DEFAULT_ORG_SLUG=demo-salon`) lists 20 services.
- [ ] **Step 2: Run** `pnpm --filter @beautyspa/api test:int test/integration/seed.int.test.ts` · Expected: FAIL (`seed` not exported).
- [ ] **Step 3: Implement** the seed. Note: `seed.ts` is outside `src/`; import `DEFAULT_LOCATION_SETTINGS` from `@beautyspa/contracts` and `todayIn`/`wallTimeToUtc` from `@beautyspa/datetime` (add the workspace dependency to `apps/api/package.json` if missing).
- [ ] **Step 4: Run** `pnpm turbo run lint typecheck test && pnpm --filter @beautyspa/api test:int && pnpm --filter @beautyspa/api db:seed` (twice) · Expected: PASS; the seed prints the same counts both times.
- [ ] **Step 5: Update `docs/development/README.md`**, then commit — `feat(api): full development seed`

---

## After the last task

- Final branch review (`reviewer-opus`), fixes, re-review.
- Mark plan 03 merged in `README.md`, update `docs/handoff.md` (done; carried items: plan 04 builds the engine `Context` from `readLocationSettings`, `dayHoursFromRows` and `PublicCatalogService.bookableEmployees`; deactivating an employee leaves their future appointments in place — plan 07 must surface them; `api-client` methods for these endpoints come with plans 06/07).
