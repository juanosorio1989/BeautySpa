# Data model (PostgreSQL 16 + Prisma)

Conventions: UUID v7 ids; `created_at`/`updated_at` everywhere (append-only
`notification_consent` and `audit_log` carry only `changed_at` / `at`; join
tables `staff_location` and `employee_service` use a composite primary key); timestamps are
`timestamptz` in UTC; money is integer cents (USD); translatable text is
`jsonb` `{ "en": "...", "es": "..." }`; tenant-owned tables carry
`organization_id` (and `location_id` where it applies).

## Tenancy

| Table | Key columns |
|---|---|
| `organization` | `name`, `slug` (unique), `default_locale` |
| `location` | `organization_id`, `name`, `address`, `phone`, `timezone` (IANA), `settings` jsonb: `slotIntervalMin` (15), `holdMinutes` (5), `cancelWindowHours` (24), `bookingHorizonDays` (60), `minLeadMinutes` (60) |
| `location_hours` | `location_id`, `weekday` 0–6, `opens` time, `closes` time. An end time of 00:00 that is not after the start means 24:00 (end of day). Overnight shifts are not supported. Repositories must map it to the engine's "24:00". |
| `location_closure` | `location_id`, `starts_at`, `ends_at`, `reason` |

**Tenancy columns.** Top-level tables and the hot child tables `resource`,
`appointment_segment`, `working_hours`, `time_off` and `notification_consent`
carry `organization_id` directly (NOT NULL, FK, indexed) so the busiest queries
filter by tenant without a join. All other child tables (`location_hours`,
`staff_location`, `employee_profile`, `service_level_price`, ...) inherit
tenancy through their parent; RLS will join through it.

**Deletes keep history.** FKs from history rows are `ON DELETE RESTRICT`:
`appointment.customer_id`, `appointment_segment.resource_id`,
`service.resource_type_id` and `notification_consent.customer_id` (consent is
evidence). Customers are soft-deleted (`deleted_at`); resources are
deactivated (`active = false`).

## Staff and auth

| Table | Key columns |
|---|---|
| `staff_user` | `organization_id`, `email` (unique per org, nullable when `can_login = false`), `can_login`, `password_hash`, `totp_secret_enc`, `totp_enrolled_at`, `role` (`OWNER`, `RECEPTION`, `EMPLOYEE`), `locale`, `active` |
| `staff_recovery_code` | `staff_user_id`, `code_hash`, `used_at` — 10 issued at TOTP enrollment |
| `staff_auth_token` | `staff_user_id`, `purpose` (`INVITE`, `PASSWORD_RESET`), `token_hash`, `expires_at`, `used_at` |
| `staff_location` | `staff_user_id`, `location_id` |
| `level` | `organization_id`, `name` jsonb, `rank` (e.g. Junior, Senior) |
| `employee_profile` | `staff_user_id` (PK), `display_name`, `bio` jsonb, `photo_url`, `level_id`, `bookable_online` |
| `employee_service` | `staff_user_id`, `service_id` — what each employee can do |
| `working_hours` | `organization_id`, `staff_user_id`, `location_id`, `weekday`, `start_time`, `end_time` (local wall time; An end time of 00:00 that is not after the start means 24:00 (end of day). Overnight shifts are not supported. Repositories must map it to the engine's "24:00".) Several rows per day = breaks are gaps. |
| `time_off` | `organization_id`, `staff_user_id`, `location_id` (nullable = all locations), `starts_at`, `ends_at`, `kind` (`VACATION`, `BLOCK`), `note`. Recurring breaks are gaps in `working_hours`; one-off breaks are `BLOCK`. |
| `refresh_token` | `subject_type` (`customer`/`staff`), `subject_id`, `family_id`, `token_hash` (unique), `expires_at`, `rotated_at`, `revoked_at`, `user_agent`, `ip` |

## Customers

| Table | Key columns |
|---|---|
| `customer` | `organization_id`, `phone_e164` (unique per org), `name` (nullable: the row is created at OTP verify, before the name step), `email` (optional), `locale`, `phone_verified_at`, `created_via` (`ONLINE`, `RECEPTION`), `private_notes_enc` (staff-only, encrypted), `deleted_at` |
| `notification_consent` | `organization_id`, `customer_id`, `channel` (`WHATSAPP`, `SMS`, `EMAIL`), `granted`, `source` (`BOOKING_FORM`, `PROFILE`, `RECEPTION`, `INBOUND_STOP`), `changed_at`. Append-only history; current state = latest row per channel. |

## Catalog and resources

| Table | Key columns |
|---|---|
| `service_category` | `organization_id`, `name` jsonb, `sort` |
| `service` | `organization_id`, `category_id`, `name` jsonb, `description` jsonb, `duration_min`, `buffer_after_min`, `price_cents`, `parallelizable` bool, `resource_type_id` (nullable), `online_bookable`, `active` |
| `service_level_price` | `service_id`, `level_id`, `duration_min`, `price_cents` — overrides by level |
| `resource_type` | `organization_id`, `name` jsonb (e.g. Pedicure chair) |
| `resource` | `organization_id`, `location_id`, `resource_type_id`, `name`, `active` |

## Appointments

| Table | Key columns |
|---|---|
| `appointment` | `organization_id`, `location_id`, `customer_id` (nullable while `HELD` anonymous), `status` (`HELD`, `BOOKED`, `CHECKED_IN`, `COMPLETED`, `CANCELLED`, `NO_SHOW`), `source` (`ONLINE`, `RECEPTION`, `WALK_IN`), `hold_expires_at`, `confirmed_by_customer_at`, `manage_version` int, `notes`, `created_by_staff_id`, `cancelled_at`, `cancel_reason`, `cancelled_by` |
| `appointment_segment` | `organization_id`, `appointment_id`, `service_id`, `staff_user_id`, `resource_id` (nullable), `starts_at`, `ends_at`, `block_ends_at` (`ends_at + buffer_after_min`, or `ends_at` when the buffer is dropped for a same-employee back-to-back segment (see availability.md); the API always stores `blockEnd` from the validated plan, never recomputes it), `duration_min`, `price_cents` (snapshots), `occupies` bool |

### No double booking (raw SQL migration)

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE appointment_segment
  ADD CONSTRAINT no_employee_overlap EXCLUDE USING gist (
    staff_user_id WITH =,
    tstzrange(starts_at, block_ends_at, '[)') WITH &&
  ) WHERE (occupies);

ALTER TABLE appointment_segment
  ADD CONSTRAINT no_resource_overlap EXCLUDE USING gist (
    resource_id WITH =,
    tstzrange(starts_at, block_ends_at, '[)') WITH &&
  ) WHERE (occupies AND resource_id IS NOT NULL);
```

- `occupies` is `true` for `HELD`, `BOOKED`, `CHECKED_IN`, `COMPLETED`, and set
  to `false` when the appointment becomes `CANCELLED` or `NO_SHOW`, in the same
  transaction as the status change.
- Expired holds still occupy until released. The booking transaction first
  releases expired holds that overlap the requested ranges, then inserts; a
  sweeper job every minute releases the rest.
- A constraint violation (`23P01`) maps to HTTP 409 `SLOT_TAKEN`.
- Working hours, time off, and closures are not in the constraint; the booking
  transaction re-runs the availability check for the exact plan before insert.
- Prisma does not model these constraints. A test asserts both constraints exist
  after `prisma migrate deploy`, and CI fails if `prisma migrate diff` would drop
  them.
- Implementation: migration `*_booking_constraints` (hand-written) also adds
  `CHECK (starts_at < ends_at AND ends_at <= block_ends_at)` named
  `segment_time_order` (violation `23514`). Prisma 6 reports neither violation
  as a P-code: it throws `PrismaClientUnknownRequestError` and the SQLSTATE is
  only in the message (`code: "23P01"`).
- Drift check (`pnpm --filter @beautyspa/api db:drift`): `prisma migrate diff
  --from-migrations --to-schema-datamodel --exit-code`. Prisma 6.19 ignores
  exclusion and check constraints in this diff, so they never show as drift and
  no filtering workaround is needed. The diff wipes its shadow database, so the
  shadow is a separate `<test db>_shadow` database (created on first use, or
  `SHADOW_DATABASE_URL`), never the integration-test database itself.

## Schedule, range and amount checks (raw SQL migration)

Migration `*_schedule_checks` (hand-written; Prisma does not model `CHECK`
constraints and the drift check ignores them). A violation is SQLSTATE `23514`;
the API validates first, so a `23514` means a bug or a direct write.

| Constraint | Table | Rule |
|---|---|---|
| `working_hours_weekday` | `working_hours` | `weekday BETWEEN 0 AND 6` |
| `working_hours_time_order` | `working_hours` | `start_time < end_time OR end_time = '00:00'` |
| `location_hours_weekday` | `location_hours` | `weekday BETWEEN 0 AND 6` |
| `location_hours_time_order` | `location_hours` | `opens < closes OR closes = '00:00'` |
| `time_off_time_order` | `time_off` | `starts_at < ends_at` |
| `location_closure_time_order` | `location_closure` | `starts_at < ends_at` |
| `service_amounts` | `service` | `duration_min > 0 AND buffer_after_min >= 0 AND price_cents >= 0` |
| `service_level_price_amounts` | `service_level_price` | `duration_min > 0 AND price_cents >= 0` |

**Wall times in the API.** Hours are `"HH:MM"` local wall time; an end may be
`"24:00"` (end of day). `time` cannot hold 24:00, so it is stored as `00:00`
and read back as `"24:00"` (`apps/api/src/common/wall-time.ts`:
`wallToTime`, `timeToWall(t, "end")`, `dayHoursFromRows`). `"00:00"` as an API
end is rejected (end must be after start), so a stored end of `00:00` always
means 24:00.

**Database error mapping.** `apps/api/src/common/db-errors.ts` holds `pgCode`
(SQLSTATE from a Prisma error, also re-exported by the integration test
helpers), `isUniqueViolation` (`P2002` / `23505`) and `isForeignKeyViolation`
(`P2003` / `23503`, answered as 409 `CONFLICT` on blocked deletes). Plan 04
adds the `23P01` → `SLOT_TAKEN` mapping there.

## Notifications and audit

| Table | Key columns |
|---|---|
| `notification_log` | `organization_id`, `appointment_id`, `customer_id`, `template_key`, `locale`, `channel`, `provider`, `provider_message_id`, `status` (`QUEUED`, `SENT`, `DELIVERED`, `READ`, `FAILED`, `SKIPPED`), `error`, `attempts`, `sent_at`, `updated_at` |
| `audit_log` | `organization_id`, `actor_type` (`STAFF`, `CUSTOMER`, `SYSTEM`), `actor_id`, `action` (e.g. `appointment.create`, `appointment.move`, `appointment.cancel`), `entity`, `entity_id` (text, so composite or non-UUID keys fit), `before` jsonb, `after` jsonb, `ip`, `at`. Append-only. |

## Encryption

Application-level AES-256-GCM for `*_enc` columns, key from env
(`DATA_ENCRYPTION_KEY`), key id prefixed to the ciphertext for rotation. The
MVP has few sensitive fields (`private_notes_enc`, `totp_secret_enc`); the
technical file in phase 2 uses the same mechanism.
