# API additions

The booking, customer and auth endpoints from plans 02–04 already cover
almost everything. 07a adds only what the screens cannot get today. All new
endpoints: `/v1`, problem+json errors, contracts in `packages/contracts`,
typed methods in `packages/api-client`, RBAC matrix test rows, OpenAPI.

## 1. `GET /staff/me` (any staff role)

`{ id, name, email, role }` for the signed-in staff user (`staff_user` has no
name column: name = `employee_profile.display_name`, else the email). The same
fallback names `updatedBy` on notes. Used by the
staff layout and to know "own segments" for EMPLOYEE (`id` = segment
`employeeId`).

## 2. Agenda: employees, names, cancelled (extend `GET /staff/agenda`)

- Query adds `includeCancelled: boolean` (default `false`; today's filter
  `BOOKED, CHECKED_IN, COMPLETED, NO_SHOW` stays the default; `true` adds
  `CANCELLED`).
- Response adds `employees: [{ id, displayName, active, ranges: [{ start,
  end }] }]`: active employees with a profile at that location **plus** any
  employee referenced by a returned segment (`active: false` when inactive or
  no longer at the location); EMPLOYEE gets only self. `ranges` = working
  ranges for that local date after time off and closures (same source as the
  availability engine), ISO instants; empty for inactive ones.
- Response adds `services: [{ id, name }]` and `resources: [{ id, name }]`
  covering every id referenced by the returned segments, inactive items
  included (`name` is `LocalizedText` for services). So every role, EMPLOYEE
  included, can render cards without catalog reads.

## 3. Agenda and search: reachability and last visit

- `CustomerSummarySchema` (inside `StaffAppointment.customer`) adds
  `reachable: boolean` = the customer has at least one consented channel the
  router can use today (email with an address, or an active push
  subscription). Drives the "No messages" badge.
- `GET /staff/customers?q=` results add `lastVisit: { date, serviceIds } |
  null` (latest `COMPLETED` or `CHECKED_IN` appointment). Computed in one query
  for the ≤ 20 results (fixes the existing per-row consent query too).

## 4. Staff customer reads (OWNER, RECEPTION)

- `GET /staff/customers/:id` → `StaffCustomer` (same shape as `POST`).
- `GET /staff/customers/:id/appointments` → `{ upcoming: StaffAppointment[],
  past: StaffAppointment[] }`, past newest first and capped at 20 (no paging
  in 07a); staff see every `cancelReason`.
- Other org's id → 404; EMPLOYEE → 403 (their existing search access stays).

## 5. `GET /availability?override=true` (staff token only)

STAFF mode already ignores lead time and horizon. With `override=true` it
also ignores working hours and closures (the same relaxation the write path
applies with `override: true`, `plan.ts`), still forbids overlaps of employees
and resources, and marks each returned slot `outsideHours: boolean`. A start
the normal search also offers returns the normal plan with `outsideHours: false`
(so it books without override); only extra starts use the relaxed plan. A
customer token or no token with `override=true` → 400. The quick-booking
"Book anyway" sends the plan of such a slot to `POST /staff/appointments` with
`override: true`.

## 6. `GET /staff/booking-catalog` (OWNER, RECEPTION)

Everything quick booking needs in one call, STAFF view (includes services and
employees not offered online): `categories`, `services` (id, name, category,
duration, price, parallelizable, onlineBookable), `employees` (id,
displayName, serviceIds, level), plus `popularServiceIds` (top 6 by
appointments in the last 90 days, ties by name). Read-only; `services` reads
by OWNER (`GET /staff/services`) stay as they are.

## 7. Private customer notes (OWNER, RECEPTION)

- `GET /staff/customers/:id/notes` → `{ notes: string | null, updatedAt,
  updatedBy: { id, name } | null }`.
- `PUT /staff/customers/:id/notes { notes: string | null }` (trimmed, ≤ 2,000
  chars; empty → null) → same shape. Stored encrypted in
  `customer.private_notes_enc` with the existing `Encryptor`; needs two new
  columns `private_notes_updated_at`, `private_notes_updated_by` (migration).
  Audit row `customer.notes` with `before`/`after` = `{ changed: true }` only
  (never the text). Another org's id → 404. EMPLOYEE → 403.
- Customer export (`GET /me/export`) does **not** include private notes
  (staff working notes; revisit with the privacy review). Account deletion
  clears them.

## Calls (decided by Claude)

- New reads instead of loosening `GET /staff/services` to RECEPTION, so the
  OWNER admin contract (07b) stays separate from the booking view.
- `reachable` is computed, not stored.
- Notes are one text per customer, last-write-wins (two receptionists editing
  at once is unlikely; `updatedAt` is shown).
- Task routing hint for the plan: item 7 (migration + encrypted data) and
  item 5 (touches the availability engine) → `implementer-opus`.
- `override` is not stored on the appointment (audit only); the panel does
  not show it.
