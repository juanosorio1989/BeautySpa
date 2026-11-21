import type { Prisma } from "@prisma/client";
import type { Channel, Consents, StaffCustomer } from "@beautyspa/contracts";

const CHANNELS: readonly Channel[] = ["WHATSAPP", "SMS", "EMAIL"];

/** Current consent per channel: the latest row of each; no row means false. */
export async function currentConsents(
  db: Pick<Prisma.TransactionClient, "notificationConsent">,
  customerId: string,
): Promise<Consents> {
  const rows = await db.notificationConsent.findMany({
    where: { customerId },
    orderBy: [{ changedAt: "desc" }, { id: "desc" }],
    select: { channel: true, granted: true },
  });
  const result: Consents = { WHATSAPP: false, SMS: false, EMAIL: false };
  const seen = new Set<Channel>();
  for (const r of rows) {
    if (seen.has(r.channel)) continue;
    seen.add(r.channel);
    result[r.channel] = r.granted;
  }
  return result;
}

/**
 * Appends a consent row for each channel in `wanted` whose value differs from the current one
 * (history is append-only) and returns those channels.
 */
export async function recordConsents(
  tx: Prisma.TransactionClient,
  orgId: string,
  customerId: string,
  wanted: Partial<Consents>,
  source: "BOOKING_FORM" | "PROFILE" | "RECEPTION" | "INBOUND_STOP",
): Promise<Channel[]> {
  const current = await currentConsents(tx, customerId);
  const changed = CHANNELS.filter((c) => wanted[c] !== undefined && wanted[c] !== current[c]);
  if (changed.length > 0) {
    await tx.notificationConsent.createMany({
      data: changed.map((channel) => ({
        organizationId: orgId,
        customerId,
        channel,
        granted: wanted[channel]!,
        source,
      })),
    });
  }
  return changed;
}

/** The customer shape shared by staff endpoints and `Me`. */
export function toCustomerDto(
  row: { id: string; phoneE164: string; name: string | null; email: string | null; locale: string },
  consents: Consents,
): StaffCustomer {
  return {
    id: row.id,
    phoneE164: row.phoneE164,
    name: row.name,
    email: row.email,
    locale: row.locale as StaffCustomer["locale"],
    consents,
  };
}
