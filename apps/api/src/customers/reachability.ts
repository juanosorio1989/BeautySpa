import type { Prisma } from "@prisma/client";
import type { Channel, Consents } from "@beautyspa/contracts";
import { selectChannels } from "../notifications/router.js";
import type { PrismaService } from "../prisma/prisma.service.js";

/** One consent history row, as `loadConsents` reads it. */
export interface ConsentRow {
  customerId: string;
  channel: Channel;
  granted: boolean;
  changedAt: Date;
  id: string;
}

/** Current consents per customer from history rows (latest row per channel wins; no row means false). */
export function consentsFromRows(ids: readonly string[], rows: readonly ConsentRow[]): Map<string, Consents> {
  const result = new Map<string, Consents>(
    ids.map((id) => [id, { WHATSAPP: false, SMS: false, EMAIL: false, PUSH: false }]),
  );
  const latest = new Map<string, ConsentRow>();
  for (const r of rows) {
    const key = `${r.customerId}:${r.channel}`;
    const seen = latest.get(key);
    if (!seen || r.changedAt > seen.changedAt || (+r.changedAt === +seen.changedAt && r.id > seen.id)) {
      latest.set(key, r);
    }
  }
  for (const r of latest.values()) {
    const c = result.get(r.customerId);
    if (c) c[r.channel] = r.granted;
  }
  return result;
}

/** Pure core of `loadReachable`: who has a consented channel the router can use. */
export function reachableIds(
  ids: readonly string[],
  rows: readonly ConsentRow[],
  withEmail: ReadonlySet<string>,
  withPush: ReadonlySet<string>,
): Set<string> {
  const consents = consentsFromRows(ids, rows);
  const out = new Set<string>();
  for (const id of ids) {
    const c = consents.get(id)!;
    if (selectChannels(c, { email: withEmail.has(id), push: withPush.has(id) }).length > 0) out.add(id);
  }
  return out;
}

type Db = Prisma.TransactionClient | PrismaService;

/** Current consents of many customers: one query. */
export async function loadConsents(db: Db, customerIds: readonly string[]): Promise<Map<string, Consents>> {
  const rows =
    customerIds.length === 0
      ? []
      : await db.notificationConsent.findMany({
          where: { customerId: { in: [...customerIds] } },
          select: { customerId: true, channel: true, granted: true, changedAt: true, id: true },
        });
  return consentsFromRows(customerIds, rows);
}

/**
 * The customers (of `customerIds`) the router can message today: a consented channel that also has
 * an address (`EMAIL`) or a push subscription (`PUSH`). One query per table, whatever the count.
 */
export async function loadReachable(db: Db, customerIds: readonly string[]): Promise<Set<string>> {
  const ids = [...new Set(customerIds)];
  if (ids.length === 0) return new Set();
  const [rows, customers, subs] = await Promise.all([
    db.notificationConsent.findMany({
      where: { customerId: { in: ids } },
      select: { customerId: true, channel: true, granted: true, changedAt: true, id: true },
    }),
    db.customer.findMany({ where: { id: { in: ids }, email: { not: null } }, select: { id: true } }),
    db.pushSubscription.findMany({
      where: { customerId: { in: ids } },
      select: { customerId: true },
      distinct: ["customerId"],
    }),
  ]);
  return reachableIds(ids, rows, new Set(customers.map((c) => c.id)), new Set(subs.map((s) => s.customerId)));
}

/** `loadReachable` for the customers of appointment rows (a walk-in has none). */
export function loadReachableFor(db: Db, rows: readonly { customerId: string | null }[]): Promise<Set<string>> {
  return loadReachable(
    db,
    rows.flatMap((r) => (r.customerId ? [r.customerId] : [])),
  );
}
