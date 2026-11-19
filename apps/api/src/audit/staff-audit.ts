import type { Prisma } from "@prisma/client";
import type { AccessClaims } from "@beautyspa/contracts";
import type { AuditService } from "./audit.service.js";

/**
 * Records `<entity>.<op>` for a staff write inside the caller's transaction.
 * `before`/`after` are the API response shape of the row.
 */
export function recordStaffAudit(
  audit: AuditService,
  tx: Prisma.TransactionClient,
  principal: AccessClaims,
  entity: string,
  op: "create" | "update" | "delete",
  entityId: string,
  before: object | null,
  after: object | null,
  ip: string | null,
): Promise<void> {
  return audit.record(
    {
      orgId: principal.org,
      actorType: "STAFF",
      actorId: principal.sub,
      action: `${entity}.${op}`,
      entity,
      entityId,
      before,
      after,
      ip,
    },
    tx,
  );
}
