import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { invalidRef, notFound } from "../common/http-errors.js";
import { PrismaService } from "../prisma/prisma.service.js";

/** Resolves and checks locations within one organization. */
@Injectable()
export class LocationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The location to act on. With `locationId`: that location if it belongs to
   * the organization, else 404. Without: the only location, or 400 on
   * `locationId` when there are several. No location at all is a
   * misconfiguration (plain `Error`, 500).
   */
  async resolve(
    orgId: string,
    locationId?: string,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<{ id: string; organizationId: string; timezone: string }> {
    const select = { id: true, organizationId: true, timezone: true } as const;
    if (locationId !== undefined) {
      const found = await db.location.findFirst({ where: { id: locationId, organizationId: orgId }, select });
      if (!found) throw notFound("Location");
      return found;
    }
    const rows = await db.location.findMany({ where: { organizationId: orgId }, select, take: 2 });
    if (rows.length === 0) throw new Error(`Organization ${orgId} has no location`);
    if (rows.length > 1) throw invalidRef("locationId", "locationId is required");
    return rows[0]!;
  }

  /** Throws 400 on `${path}.${i}` for the first id that is not a location of the organization. */
  async assertInOrg(
    orgId: string,
    ids: string[],
    path: string,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    if (ids.length === 0) return;
    const rows = await db.location.findMany({
      where: { organizationId: orgId, id: { in: [...new Set(ids)] } },
      select: { id: true },
    });
    const known = new Set(rows.map((r) => r.id));
    const i = ids.findIndex((id) => !known.has(id));
    if (i >= 0) throw invalidRef(`${path}.${i}`, "Unknown location");
  }
}
