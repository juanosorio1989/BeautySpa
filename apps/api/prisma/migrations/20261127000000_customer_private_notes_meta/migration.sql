-- Private customer notes (plan 07a): who last wrote customer.private_notes_enc
-- and when. Both columns are nullable, so the migration is safe on non-empty
-- tables. The author FK is ON DELETE SET NULL: deleting a staff user keeps the
-- note and loses only the attribution.
--
-- Rollback (manual; Prisma has no down migrations):
--   ALTER TABLE "customer" DROP CONSTRAINT "customer_private_notes_updated_by_fkey";
--   ALTER TABLE "customer" DROP COLUMN "private_notes_updated_by",
--     DROP COLUMN "private_notes_updated_at";

-- AlterTable
ALTER TABLE "customer" ADD COLUMN     "private_notes_updated_at" TIMESTAMPTZ(3),
ADD COLUMN     "private_notes_updated_by" UUID;

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_private_notes_updated_by_fkey" FOREIGN KEY ("private_notes_updated_by") REFERENCES "staff_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
