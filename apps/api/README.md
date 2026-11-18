# @beautyspa/api

NestJS 11 REST API (CommonJS), served under `/v1`.

- `pnpm --filter @beautyspa/api dev` watch mode on `PORT` (default 3001); needs `DATABASE_URL`, `REDIS_URL`, `WEB_ORIGIN` (see `.env.example`).
- Docs: `/v1/docs` (Swagger UI), `/v1/openapi.json`. Generated from shared Zod contracts via `nestjs-zod`.
- Errors are RFC 7807 `application/problem+json` matching `ProblemSchema` (`src/common/problem.filter.ts`).
- Helmet security headers and CORS restricted to `WEB_ORIGIN`; all wiring lives in `src/bootstrap.ts` (`configureApp`).
- Tests: `pnpm --filter @beautyspa/api test` (Vitest + SWC for decorator metadata, config in `vitest.config.mts`).
