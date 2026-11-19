import { Injectable } from "@nestjs/common";
import type { AuditPage, AuditQuery } from "@beautyspa/contracts";
import { PrismaService } from "../prisma/prisma.service.js";

/** Read side of `audit_log`, newest first (ids are UUIDv7, so `id desc` is time order). */
@Injectable()
export class AuditQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async page(orgId: string, query: AuditQuery): Promise<AuditPage> {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        organizationId: orgId,
        ...(query.entity !== undefined ? { entity: query.entity } : {}),
        ...(query.id !== undefined ? { entityId: query.id } : {}),
        ...(query.cursor !== undefined ? { id: { lt: query.cursor } } : {}),
      },
      orderBy: { id: "desc" },
      take: query.limit,
    });
    const items = rows.map((r) => ({
      id: r.id,
      actorType: r.actorType,
      actorId: r.actorId,
      action: r.action,
      entity: r.entity,
      entityId: r.entityId,
      before: r.before ?? null,
      after: r.after ?? null,
      ip: r.ip,
      at: r.at.toISOString(),
    }));
    return { items, nextCursor: items.length === query.limit ? items[items.length - 1]!.id : null };
  }
}
