import type { ConsentSource, Prisma } from "@prisma/client";
import type { Channel, Consents, Me } from "@beautyspa/contracts";
import { loadConsents } from "./reachability.js";

const CHANNELS: readonly Channel[] = ["WHATSAPP", "SMS", "EMAIL", "PUSH"];

/** Current consent per channel: the latest row of each; no row means false. `organizationId` scopes the read. */
export async function currentConsents(
  db: Pick<Prisma.TransactionClient, "notificationConsent">,
  customerId: string,
  organizationId: string,
): Promise<Consents> {
  return (await loadConsents(db, organizationId, [customerId])).get(customerId)!;
}

/** One consent row `recordConsents` appended. */
export interface RecordedConsent {
  channel: Channel;
  id: string;
}

/**
 * Appends a consent row for each channel in `wanted` whose value differs from the current one
 * (history is append-only) and returns those channels with the new row ids, in the order
 * `WHATSAPP`, `SMS`, `EMAIL`, `PUSH` (the id names the consent catch-up job).
 */
export async function recordConsents(
  tx: Prisma.TransactionClient,
  orgId: string,
  customerId: string,
  wanted: Partial<Consents>,
  source: ConsentSource,
): Promise<RecordedConsent[]> {
  const current = await currentConsents(tx, customerId, orgId);
  const changed = CHANNELS.filter((c) => wanted[c] !== undefined && wanted[c] !== current[c]);
  if (changed.length === 0) return [];
  const rows = await tx.notificationConsent.createManyAndReturn({
    data: changed.map((channel) => ({
      organizationId: orgId,
      customerId,
      channel,
      granted: wanted[channel]!,
      source,
    })),
    select: { id: true, channel: true },
  });
  return changed.map((channel) => ({ channel, id: rows.find((r) => r.channel === channel)!.id }));
}

/** The `Me` shape; staff endpoints add `reachable`. */
export function toCustomerDto(
  row: { id: string; phoneE164: string; name: string | null; email: string | null; locale: string },
  consents: Consents,
): Me {
  return {
    id: row.id,
    phoneE164: row.phoneE164,
    name: row.name,
    email: row.email,
    locale: row.locale as Me["locale"],
    consents,
  };
}
