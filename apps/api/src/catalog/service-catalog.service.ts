import { Injectable } from "@nestjs/common";
import { Prisma, type Service as ServiceRow, type ServiceLevelPrice } from "@prisma/client";
import type { AccessClaims, LevelPrice, LocalizedText, Service, ServiceInput, ServiceUpdate } from "@beautyspa/contracts";
import { AuditService } from "../audit/audit.service.js";
import { recordStaffAudit } from "../audit/staff-audit.js";
import { invalidRef, notFound } from "../common/http-errors.js";
import { PrismaService } from "../prisma/prisma.service.js";

type ServiceWithPrices = ServiceRow & { levelPrices: (ServiceLevelPrice & { level: { rank: number } })[] };

const include = { levelPrices: { include: { level: { select: { rank: true } } } } } as const;

@Injectable()
export class ServiceCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Sorted by category `sort` (uncategorized last), then `name.en`. */
  async list(orgId: string, filter: { active?: boolean; categoryId?: string } = {}): Promise<Service[]> {
    const rows = await this.prisma.service.findMany({
      where: {
        organizationId: orgId,
        ...(filter.active !== undefined ? { active: filter.active } : {}),
        ...(filter.categoryId !== undefined ? { categoryId: filter.categoryId } : {}),
      },
      include: { ...include, category: { select: { sort: true } } },
    });
    const sortOf = (r: (typeof rows)[number]) => r.category?.sort ?? Number.POSITIVE_INFINITY;
    return rows
      .sort((a, b) => {
        const sa = sortOf(a);
        const sb = sortOf(b);
        if (sa !== sb) return sa < sb ? -1 : 1;
        return (a.name as LocalizedText).en.localeCompare((b.name as LocalizedText).en, "en");
      })
      .map((r) => this.toDto(r));
  }

  async get(orgId: string, id: string): Promise<Service> {
    const row = await this.prisma.service.findFirst({ where: { id, organizationId: orgId }, include });
    if (!row) throw notFound("Service");
    return this.toDto(row);
  }

  create(principal: AccessClaims, input: ServiceInput, ip: string | null): Promise<Service> {
    return this.prisma.$transaction(async (tx) => {
      await this.assertRefs(tx, principal.org, input);
      const row = await tx.service.create({
        data: {
          organizationId: principal.org,
          categoryId: input.categoryId,
          name: input.name,
          description: input.description ?? undefined,
          durationMin: input.durationMin,
          bufferAfterMin: input.bufferAfterMin,
          priceCents: input.priceCents,
          parallelizable: input.parallelizable,
          resourceTypeId: input.resourceTypeId,
          onlineBookable: input.onlineBookable,
          active: input.active,
          levelPrices: { create: input.levelPrices.map((lp) => ({ ...lp })) },
        },
        include,
      });
      const dto = this.toDto(row);
      await recordStaffAudit(this.audit, tx, principal, "service", "create", dto.id, null, dto, ip);
      return dto;
    });
  }

  update(principal: AccessClaims, id: string, patch: ServiceUpdate, ip: string | null): Promise<Service> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.service.findFirst({ where: { id, organizationId: principal.org }, include });
      if (!current) throw notFound("Service");
      await this.assertRefs(tx, principal.org, patch);
      if (patch.levelPrices !== undefined) {
        await tx.serviceLevelPrice.deleteMany({ where: { serviceId: id } });
        await tx.serviceLevelPrice.createMany({ data: patch.levelPrices.map((lp) => ({ ...lp, serviceId: id })) });
      }
      const row = await tx.service.update({
        where: { id },
        data: {
          ...(patch.categoryId !== undefined ? { categoryId: patch.categoryId } : {}),
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.description !== undefined
            ? { description: patch.description === null ? Prisma.DbNull : patch.description }
            : {}),
          ...(patch.durationMin !== undefined ? { durationMin: patch.durationMin } : {}),
          ...(patch.bufferAfterMin !== undefined ? { bufferAfterMin: patch.bufferAfterMin } : {}),
          ...(patch.priceCents !== undefined ? { priceCents: patch.priceCents } : {}),
          ...(patch.parallelizable !== undefined ? { parallelizable: patch.parallelizable } : {}),
          ...(patch.resourceTypeId !== undefined ? { resourceTypeId: patch.resourceTypeId } : {}),
          ...(patch.onlineBookable !== undefined ? { onlineBookable: patch.onlineBookable } : {}),
          ...(patch.active !== undefined ? { active: patch.active } : {}),
        },
        include,
      });
      const dto = this.toDto(row);
      await recordStaffAudit(this.audit, tx, principal, "service", "update", id, this.toDto(current), dto, ip);
      return dto;
    });
  }

  /** 400 on the first reference that is not a row of the organization. */
  private async assertRefs(
    tx: Prisma.TransactionClient,
    orgId: string,
    refs: { categoryId?: string | null; resourceTypeId?: string | null; levelPrices?: LevelPrice[] },
  ): Promise<void> {
    if (refs.categoryId) {
      const found = await tx.serviceCategory.findFirst({ where: { id: refs.categoryId, organizationId: orgId }, select: { id: true } });
      if (!found) throw invalidRef("categoryId", "Unknown category");
    }
    if (refs.resourceTypeId) {
      const found = await tx.resourceType.findFirst({ where: { id: refs.resourceTypeId, organizationId: orgId }, select: { id: true } });
      if (!found) throw invalidRef("resourceTypeId", "Unknown resource type");
    }
    const levelPrices = refs.levelPrices ?? [];
    if (levelPrices.length > 0) {
      const rows = await tx.level.findMany({
        where: { organizationId: orgId, id: { in: levelPrices.map((lp) => lp.levelId) } },
        select: { id: true },
      });
      const known = new Set(rows.map((r) => r.id));
      const i = levelPrices.findIndex((lp) => !known.has(lp.levelId));
      if (i >= 0) throw invalidRef(`levelPrices.${i}.levelId`, "Unknown level");
    }
  }

  private toDto(row: ServiceWithPrices): Service {
    return {
      id: row.id,
      categoryId: row.categoryId,
      name: row.name as LocalizedText,
      description: row.description as LocalizedText | null,
      durationMin: row.durationMin,
      bufferAfterMin: row.bufferAfterMin,
      priceCents: row.priceCents,
      parallelizable: row.parallelizable,
      resourceTypeId: row.resourceTypeId,
      onlineBookable: row.onlineBookable,
      active: row.active,
      levelPrices: [...row.levelPrices]
        .sort((a, b) => a.level.rank - b.level.rank)
        .map((lp) => ({ levelId: lp.levelId, durationMin: lp.durationMin, priceCents: lp.priceCents })),
    };
  }
}
