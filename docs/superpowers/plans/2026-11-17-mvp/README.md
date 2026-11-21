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
| 04 | [Booking API](04-booking.md) | `/availability`, holds, booking, reschedule/move, cancel, status changes, walk-in, hold sweeper, export/delete | in progress |
| 05 | Notifications | Provider interface, WhatsApp/SMS/email/console providers, channel router, BullMQ reminders, signed manage links, Twilio webhooks, consent | to write |
| 06 | Web: public site and booking | Next.js, next-intl EN/ES, SEO pages, booking flow, client area, manage-link pages | to write |
| 07 | Web: staff panel | Staff login/2FA, mobile day agenda, quick booking, walk-in, client search, owner catalog screens | to write |
| 08 | PWA and release hardening | Manifest, service worker offline views, Playwright e2e, Lighthouse CI, Sentry, README | to write |

Execution for every plan: subagent-driven (implementer per task → `reviewer-opus`
→ fix → re-review), one final branch review, then merge to `main`.
