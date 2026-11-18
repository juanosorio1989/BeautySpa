# Handoff

Updated: 2026-11-18

## Done

- Plan 01 — foundation and availability engine — merged to `main` via PR #1 (merge commit `ffead68`). CI green on GitHub (`checks`, `integration`).
- Frontend mockups approved by the owner: https://claude.ai/artifact/3zfpH45c9UxwhiMPDWGjNi — cream ground, plum accent `#7A2E5A`, Space Grotesk headings + Inter body, 6 mobile screens (client booking flow, reception agenda and quick booking). Use as the visual base for plans 06 and 07.

## Next

Write plan 02 (auth) in `docs/superpowers/plans/2026-11-17-mvp/`, then execute it subagent-driven. See the plan index for plans 02–08.

## Carried into later plans

- Plan 03: DB `CHECK` constraints for hours (`weekday` 0–6; `start < end` or end `00:00` meaning 24:00) on `working_hours`, `location_hours`, `time_off`, `location_closure`.
- Plan 03/04: repositories copy `organization_id` from the parent row; map `00:00` end times to the engine's `"24:00"`; `customer.name` may be null.
- Plan 04: move `pgCode` from `apps/api/test/integration/helpers.ts` to `src/common` and map `23P01` (only present in Prisma's error message) to `SLOT_TAKEN`; store `blockEnd` from the validated plan, never recompute it; convert engine epoch-ms fields to contract ISO fields at the API edge; consider `BAD_REQUEST` instead of `VALIDATION_FAILED` for non-Zod 400s.
- Deferred minors (non-blocking): eslint platform rule misses subpath imports (`fs/*`…); Postgres healthcheck `-h localhost`; mailpit image unpinned; no `.prettierignore`; no `engines.node`; `check-drift.sh` compares raw URLs; RFC 7807 titles from enum names.

## Open questions

- None. Local Node is 22.23.5 via nvm (matches `.nvmrc` and CI); full checks verified green on it.
