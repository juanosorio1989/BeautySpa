# Availability engine

Lives in `packages/availability` as a **pure function**: the API loads the data,
the engine computes, the API re-validates on write. Same code can run on a
future native app for previews, but the server is always authoritative.

## Inputs

```ts
findSlots({
  location: { timezone, slotIntervalMin, minLeadMinutes, hours, closures },
  request: { services: [{ serviceId, employeeId | "ANY" }], date | range },
  services,           // duration, buffer, parallelizable, resourceTypeId, level overrides
  employees,          // qualified services, level, working hours, time off
  resources,          // by type
  busy,               // existing occupying segments (minus excludeAppointmentId)
  mode,               // 'ONLINE' | 'STAFF' (see Staff mode)
  now,
}) -> Slot[]

Slot = { start, end, segments: [{ serviceId, employeeId, resourceId, start, end, blockEnd, durationMin, priceCents }] }
```

The engine works in epoch milliseconds (`start`/`end`/`blockEnd`); the API converts at its edge to the contracts' ISO fields (`startsAt`/`endsAt`/`blockEndsAt`).

Max 4 services per request **(call)**.

## Algorithm

1. **Free time per employee**: for each date, convert `working_hours` (local
   wall time) to UTC intervals using the location timezone (DST-safe via
   `packages/datetime`), intersect with location hours, subtract closures,
   `time_off`, and busy segment ranges (`starts_at` → `block_ends_at`).
2. **Free time per resource**: resource-type availability = intervals where at
   least one resource of that type is free.
3. **Candidate starts** on the slot grid (`slotIntervalMin`, default 15), not
   before `now + minLeadMinutes`.
4. For each candidate start `t`, build a plan:
   - **Parallel block first** **(call)**: if ≥ 2 chosen services are
     `parallelizable`, try starting all of them at `t` with **distinct**
     qualified employees and distinct resources; the remaining
     (non-parallelizable) services follow sequentially, in the client's order,
     starting when the longest parallel segment ends. Example: mani ‖ pedi,
     then haircut.
   - If the parallel block does not fit (e.g. 3 parallelizable services, 2
     free techs), **fall back to fully sequential** for that `t`. No partial
     parallel groups in the MVP.
   - **Sequential**, in the order the client chose: segment *n+1*
     starts at segment *n*'s `ends_at` (the client's buffer is not waited; the
     buffer blocks only the employee/resource).
   - Each segment needs: an employee qualified for the service, free over
     `[start, start + duration + buffer)`; a free resource of the required
     type over the same range.
   - Duration and price come from the employee's level override, else the
     service default.
   - **Same-employee consecutive segments (call)**: when segment *n+1* uses
     the same employee as segment *n* and starts at its end, segment *n*'s
     block ends at its `ends_at` (no buffer between one client's back-to-back
     services) **only if** segment *n* needs no resource or segment *n+1* uses
     the same resource. Otherwise the buffer stays, so a chair is never
     released early (one `block_ends_at` per segment, as in the DB).
   - **Assignment by backtracking (call)** (at most 4 segments): candidates
     per segment are ordered by booked minutes that local day (sum of
     `block_ends_at - starts_at` of the employee's busy segments starting that
     day, ascending; counted from the input busy list only, not from segments
     of the plan being built), then by id. Resources are tried by name. Branches
     that are already infeasible are pruned early using a sound lower bound of
     each placed block (the buffer is kept unless it can still be dropped).
   - **Symmetry reduction (call)**: at each depth only one candidate per
     equivalence class is tried. Two employees are equivalent when they have
     the same level terms (duration, price) for this and every remaining
     choice, the same candidacy for every remaining choice, and identical free
     intervals for the day; employees already used in the plan are never
     merged. The representative is the first in the ordering above.
   - **Node budget (call)**: at most `MAX_NODES_PER_START = 5000` search nodes
     per start time and shape; beyond it that start yields no plan. This can
     hide a valid slot only in pathological schedules. A
     parallel block needs distinct employees; a sequential plan may reuse one.
5. **Employee choice for "ANY"** **(call)**: among free qualified employees, pick
   the one with the fewest booked minutes that day; ties by stable id order.
   Resource choice: first free by name.
6. Return one plan per start time (the first valid one). Slot `endsAt` = the
   latest segment `ends_at`.

## Staff mode **(call)**

`mode = 'STAFF'` ignores `minLeadMinutes`, `bookingHorizonDays`,
`online_bookable`, and `bookable_online`. Walk-in uses it with `t` = now rounded
down to the slot grid. Staff may also book outside working hours / time off /
location hours **and location closures** with an explicit `override: true` on the request (UI asks "Book
outside {name}'s hours?"); the override is recorded as `override: true` in the
audit row's `after` (`appointment.create` / `appointment.move`). Overlaps are
never allowed, override or not: validation answers 409 `SLOT_TAKEN`, and the DB
exclusion constraint is the final guard. Walk-in takes the first slot starting
no later than that grid floor + `slotIntervalMin` (no override).

Reads can use the same relaxation: staff `GET /availability?override=true`
runs the search twice on one context snapshot, normal and with `override`, and
returns the override list with each slot flagged `outsideHours = true` when its
start is not among the normal starts. A closure day therefore lists slots that
are all `outsideHours: true`. Customer or anonymous callers get 400 on
`override`. The quick-booking "Book anyway" sends such a slot's segments to
`POST /staff/appointments` with `override: true`, so the client never builds a
plan itself.

## Price shown for "Any"

Online, a service with "Any" shows "from $X" (lowest level price among
qualified employees). The slot's plan carries the exact price for the assigned
employee, shown before confirming.

## Write-time validation

`POST /holds` receives the plan, the API re-runs the check for those exact
segments inside a transaction, then inserts. The exclusion constraints are the
final guard for races.

Expired holds: reads ignore them; every write that claims time (hold, staff
booking, walk-in, reschedule, move) first releases the organization's expired
holds. Status changes and cancels do not release them, because they only free
time and never claim it (ruling R6).

## Required tests (table-driven, Vitest)

- Single service, single employee, with and without buffer.
- Breaks (gap in working hours), time off, location closure.
- Mani + pedi parallel succeeds with 2 techs + 1 free chair; falls back to
  sequential when only 1 tech is free; no slot when no chair is free.
- "ANY" picks the least-loaded employee.
- Level override changes duration and price.
- DST days in `America/New_York` (2026-03-08 and 2026-11-01): no phantom or
  missing slots.
- `minLeadMinutes` and booking horizon; STAFF mode ignores them.
- Mani + pedi + haircut: parallel block then haircut; 3 parallelizable with 2 techs → sequential.
- `excludeAppointmentId` lets a reschedule overlap its own old time.
