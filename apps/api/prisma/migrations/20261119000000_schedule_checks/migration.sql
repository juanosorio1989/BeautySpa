-- Schedule, range and amount CHECK constraints (hand-written; Prisma does not
-- model them, and `prisma migrate diff` does not report them as drift).
-- Spec: docs/superpowers/specs/2026-11-17-mvp-design/data-model.md, "CHECK constraints".
--
-- Wall-time ends: `time` cannot hold 24:00, so an end of 24:00 (end of day) is
-- stored as 00:00; the time-order checks accept end = 00:00 for that reason.
--
-- ADD CONSTRAINT validates existing rows: the migration fails (and, being one
-- transaction, changes nothing) if any row already violates a check.
--
-- Down (Prisma migrations are forward-only; to revert manually):
--   ALTER TABLE working_hours DROP CONSTRAINT IF EXISTS working_hours_weekday;
--   ALTER TABLE working_hours DROP CONSTRAINT IF EXISTS working_hours_time_order;
--   ALTER TABLE location_hours DROP CONSTRAINT IF EXISTS location_hours_weekday;
--   ALTER TABLE location_hours DROP CONSTRAINT IF EXISTS location_hours_time_order;
--   ALTER TABLE time_off DROP CONSTRAINT IF EXISTS time_off_time_order;
--   ALTER TABLE location_closure DROP CONSTRAINT IF EXISTS location_closure_time_order;
--   ALTER TABLE service DROP CONSTRAINT IF EXISTS service_amounts;
--   ALTER TABLE service_level_price DROP CONSTRAINT IF EXISTS service_level_price_amounts;

BEGIN;

ALTER TABLE working_hours
  ADD CONSTRAINT working_hours_weekday CHECK (weekday BETWEEN 0 AND 6);
ALTER TABLE working_hours
  ADD CONSTRAINT working_hours_time_order CHECK (start_time < end_time OR end_time = '00:00'::time);

ALTER TABLE location_hours
  ADD CONSTRAINT location_hours_weekday CHECK (weekday BETWEEN 0 AND 6);
ALTER TABLE location_hours
  ADD CONSTRAINT location_hours_time_order CHECK (opens < closes OR closes = '00:00'::time);

ALTER TABLE time_off
  ADD CONSTRAINT time_off_time_order CHECK (starts_at < ends_at);

ALTER TABLE location_closure
  ADD CONSTRAINT location_closure_time_order CHECK (starts_at < ends_at);

ALTER TABLE service
  ADD CONSTRAINT service_amounts CHECK (duration_min > 0 AND buffer_after_min >= 0 AND price_cents >= 0);

ALTER TABLE service_level_price
  ADD CONSTRAINT service_level_price_amounts CHECK (duration_min > 0 AND price_cents >= 0);

COMMIT;
