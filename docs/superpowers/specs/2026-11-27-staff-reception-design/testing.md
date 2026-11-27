# Testing

Same tools as plans 04–06.

- **API (Vitest + integration against Postgres/Redis):** each addition gets
  unit tests where there is logic (ranges, `reachable`, popularity) and
  integration tests: happy path, RBAC (OWNER / RECEPTION / EMPLOYEE /
  customer token / no token), other-org 404, validation 400, audit row for
  notes, encryption at rest (DB column is not the plaintext).
- **`api-client`:** a typed method per new or extended endpoint, with unit
  tests (schema parse, error mapping), plus methods for the plan 03/04 staff
  endpoints the panel calls (agenda, staff appointments, status, walk-in,
  customers). The staff auth methods already exist (`auth.staffLogin`,
  `mfaVerify`, `mfaRecover`, … in `packages/api-client/src/client.ts`); add
  only the missing ones.
- **Web (Vitest + Testing Library):** login step machine (MFA, enroll,
  recovery → re-enroll, invite → enrollment, customer-session notice), agenda layout by width, action sheet
  shows only allowed actions per status/role, `NO_SHOW` disabled before start,
  quick booking taps (returning client ≤ 6 taps), out-of-hours "Book anyway"
  sends `override: true`, polling pauses when hidden, error mapping.
- **Playwright e2e (CI `e2e` job):** staff login with a seeded OWNER whose TOTP
  secret is known to the test (seed helper, test env only) → agenda shows a
  seeded appointment → quick booking for an existing client → card appears →
  check in → complete. One EMPLOYEE smoke: sees only own column, no
  "New"/"Walk-in".
- Seeds: add a demo RECEPTION and the e2e OWNER/EMPLOYEE with fixed TOTP
  secrets only when `NODE_ENV=test` (never in dev/prod seeds).
- Acceptance for the branch: `pnpm lint`, `pnpm typecheck`, `pnpm build`,
  `pnpm test`, `pnpm test:int` (run alone), `pnpm format:check`, e2e green in
  CI.
