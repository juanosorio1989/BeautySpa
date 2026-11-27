/**
 * TEST ONLY. Gives the e2e run two staff accounts that can sign in:
 * - OWNER `owner@e2e.test` (created or updated)
 * - the seeded EMPLOYEE `ana@demo-salon.test` (login enabled)
 * Both get the password and TOTP secret the Playwright staff spec knows (apps/web/e2e/staff.spec.ts).
 * Refuses to run unless NODE_ENV=test. Never prints secrets.
 * Run by apps/web/e2e/prepare.sh after db:seed: pnpm --filter @beautyspa/api e2e:staff
 */
import { PrismaClient } from "@prisma/client";
import { Encryptor } from "../src/auth/crypto/encryption.js";
import { hashPassword } from "../src/auth/crypto/password.js";

const PASSWORD = "E2e-Staff-Pass-1";
const TOTP_SECRET_B32 = "JBSWY3DPEHPK3PXP";
const OWNER_EMAIL = "owner@e2e.test";
const EMPLOYEE_EMAIL = "ana@demo-salon.test";

async function main(): Promise<void> {
  if (process.env.NODE_ENV !== "test") throw new Error("e2e-staff refuses to run unless NODE_ENV=test");
  if (!process.env.DATABASE_URL_TEST || process.env.DATABASE_URL !== process.env.DATABASE_URL_TEST) {
    throw new Error("e2e-staff only writes to DATABASE_URL_TEST");
  }
  const keyB64 = process.env.DATA_ENCRYPTION_KEY;
  if (!keyB64) throw new Error("DATA_ENCRYPTION_KEY is not set");
  const encryptor = new Encryptor({ keyId: process.env.DATA_ENCRYPTION_KEY_ID ?? "k1", keyB64 });

  const prisma = new PrismaClient();
  try {
    const org = await prisma.organization.findUniqueOrThrow({ where: { slug: "demo-salon" } });
    const login = {
      canLogin: true,
      active: true,
      passwordHash: await hashPassword(PASSWORD),
      totpSecretEnc: encryptor.encrypt(TOTP_SECRET_B32),
      totpEnrolledAt: new Date(),
    };
    const key = (email: string) => ({ organizationId_email: { organizationId: org.id, email } });

    await prisma.staffUser.upsert({
      where: key(OWNER_EMAIL),
      update: { ...login, role: "OWNER" },
      create: { organizationId: org.id, email: OWNER_EMAIL, role: "OWNER", locale: "en", ...login },
    });
    await prisma.staffUser.update({ where: key(EMPLOYEE_EMAIL), data: login });
    console.log("e2e staff accounts ready");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
