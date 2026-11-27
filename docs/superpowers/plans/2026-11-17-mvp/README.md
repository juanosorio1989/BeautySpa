# MVP implementation plans

Spec: [`docs/superpowers/specs/2026-11-17-mvp-design/`](../../specs/2026-11-17-mvp-design/README.md)

The MVP is split into milestone plans. Each produces working, tested software
on its own branch, is reviewed and merged, and only then is the next plan
written in detail (so it builds on real code, not guesses).

| # | Plan | Delivers | Status |
|---|---|---|---|
| 01 | [Foundation and availability engine](01-foundation.md) | Monorepo, tooling, Docker, `datetime`, `contracts` base, `availability` engine, NestJS skeleton (`/v1`, OpenAPI, problem+json), full Prisma schema with exclusion constraints, CI | merged (PR #1) |
| 02 | [Auth](02-auth.md) | Phone OTP (Twilio Verify), staff password + TOTP + recovery, invites/reset, access + rotating refresh tokens, RBAC guards, `create-owner` CLI, `api-client` with `TokenStore` | merged |
| 03 | [Catalog, staff, schedules API](03-catalog-staff.md) | Services, categories, levels, resources, employees, working hours, time off, settings, closures, public reads, audit log, `CHECK` constraints, full seeds | merged |
| 04 | [Booking API](04-booking.md) | `/availability`, holds, booking, reschedule/move, cancel, status changes, walk-in, hold sweeper, export/delete | merged (PR #5) |
| 05 | [Notifications](05-notifications.md) | Provider interface, email (Resend) + `.ics` invite + web push providers, channel router, BullMQ reminders and maintenance queue, signed manage links, consent. SMS/WhatsApp later (business not incorporated yet) | in review (branch feat/mvp-05-notifications) |
| 06 | [Web: public site and booking](06-web-public-booking.md) | Next.js, next-intl EN/ES, SEO pages, booking flow, client area, manage-link pages moved to 05 | merged (PR #6) |
| 07a | [Web: staff panel, reception](07a-staff-reception.md) | Staff login/2FA, day agenda, actions, quick booking, walk-in, clients, private notes, 7 API additions | implemented, in review (branch feat/mvp-07a-staff-reception) |
| 07b | Web: staff panel, owner admin | Catalog, employees (deactivation surfaces future appointments), working hours, time off, closures, settings | to write |
| 08 | PWA and release hardening | Manifest and push-only service worker exist (plan 05); remaining: offline views, Playwright e2e, Lighthouse CI, Sentry, README | to write |

Execution for every plan: subagent-driven (implementer per task → `reviewer-opus`
→ fix → re-review), one final branch review, then merge to `main`.
