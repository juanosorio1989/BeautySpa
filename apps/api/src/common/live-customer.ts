import { UnauthorizedException } from "@nestjs/common";
import type { Customer, Prisma } from "@prisma/client";
import type { AccessClaims } from "@beautyspa/contracts";

/**
 * The calling customer's row (filtered by org); 401 `UNAUTHORIZED` when it is missing or deleted
 * (`deleted_at` set), because a customer's access token stays valid until it expires. With `lock`,
 * the row is locked `FOR UPDATE` first (only inside a transaction), so a concurrent update or
 * deletion waits.
 */
export async function assertLiveCustomer(
  db: Pick<Prisma.TransactionClient, "customer" | "$queryRaw">,
  principal: AccessClaims,
  opts: { lock?: boolean } = {},
): Promise<Customer> {
  if (opts.lock) {
    await db.$queryRaw`
      SELECT id FROM customer
      WHERE id = ${principal.sub}::uuid AND organization_id = ${principal.org}::uuid
      FOR UPDATE`;
  }
  const row = await db.customer.findFirst({ where: { id: principal.sub, organizationId: principal.org } });
  if (!row || row.deletedAt) throw new UnauthorizedException({ code: "UNAUTHORIZED" });
  return row;
}
