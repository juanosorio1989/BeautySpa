-- Notifications (plan 05): PUSH channel, appointment.times_set_at, the
-- notification_log dedupe key and the push_subscription table.
--
-- times_set_at is added nullable, backfilled from created_at, then set NOT
-- NULL, so the migration is safe on non-empty tables. The dedupe index is
-- created on notification_log while nothing writes it yet (all existing rows
-- get manage_version 0).
--
-- Down (Prisma migrations are forward-only; to revert manually):
--   - DROP TABLE push_subscription;
--   - DROP INDEX notification_log_dedupe; ALTER TABLE notification_log DROP COLUMN manage_version;
--   - ALTER TABLE appointment DROP COLUMN times_set_at;
--   - PostgreSQL cannot drop an enum value: delete rows using 'PUSH' from
--     notification_consent and notification_log, then recreate
--     notification_channel without it (create the new type, ALTER COLUMN ...
--     TYPE ... USING channel::text::new_type on both tables, drop the old one).

BEGIN;

-- Not used in this migration, so it may run in the same transaction (PostgreSQL 12+).
ALTER TYPE "notification_channel" ADD VALUE 'PUSH';

-- When the current times of an appointment were set (reminder eligibility).
ALTER TABLE "appointment" ADD COLUMN "times_set_at" TIMESTAMPTZ(3);
UPDATE "appointment" SET "times_set_at" = "created_at";
ALTER TABLE "appointment" ALTER COLUMN "times_set_at" SET NOT NULL;

-- One notification per (appointment, template, manage version, channel).
ALTER TABLE "notification_log" ADD COLUMN "manage_version" INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX "notification_log_dedupe" ON "notification_log"("appointment_id", "template_key", "manage_version", "channel");

-- Web Push subscriptions; rows are deleted explicitly, never by cascade.
CREATE TABLE "push_subscription" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_success_at" TIMESTAMPTZ(3),

    CONSTRAINT "push_subscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "push_subscription_endpoint_key" ON "push_subscription"("endpoint");
CREATE INDEX "push_subscription_customer_id_idx" ON "push_subscription"("customer_id");
CREATE INDEX "push_subscription_organization_id_idx" ON "push_subscription"("organization_id");

ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
