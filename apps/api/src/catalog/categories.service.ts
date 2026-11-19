import { Injectable } from "@nestjs/common";
import type { Prisma, ServiceCategory } from "@prisma/client";
import type { AccessClaims, Category, CategoryInput, CategoryUpdate, LocalizedText } from "@beautyspa/contracts";
import { AuditService } from "../audit/audit.service.js";
import { notFound } from "../common/http-errors.js";
import { PrismaService } from "../prisma/prisma.service.js";

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(orgId: string): Promise<Category[]> {
    const rows = await this.prisma.serviceCategory.findMany({ where: { organizationId: orgId } });
    return rows.map((r) => this.toDto(r)).sort((a, b) => a.sort - b.sort || a.name.en.localeCompare(b.name.en));
  }

  async get(orgId: string, id: string): Promise<Category> {
    const row = await this.prisma.serviceCategory.findFirst({ where: { id, organizationId: orgId } });
    if (!row) throw notFound("Category");
    return this.toDto(row);
  }

  create(principal: AccessClaims, input: CategoryInput, ip: string | null): Promise<Category> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.serviceCategory.create({
        data: { organizationId: principal.org, name: input.name, sort: input.sort },
      });
      const dto = this.toDto(row);
      await this.record(tx, principal, "create", dto.id, null, dto, ip);
      return dto;
    });
  }

  update(principal: AccessClaims, id: string, patch: CategoryUpdate, ip: string | null): Promise<Category> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.serviceCategory.findFirst({ where: { id, organizationId: principal.org } });
      if (!current) throw notFound("Category");
      const row = await tx.serviceCategory.update({
        where: { id },
        data: {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.sort !== undefined ? { sort: patch.sort } : {}),
        },
      });
      const dto = this.toDto(row);
      await this.record(tx, principal, "update", id, this.toDto(current), dto, ip);
      return dto;
    });
  }

  remove(principal: AccessClaims, id: string, ip: string | null): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.serviceCategory.findFirst({ where: { id, organizationId: principal.org } });
      if (!current) throw notFound("Category");
      await tx.serviceCategory.delete({ where: { id } });
      await this.record(tx, principal, "delete", id, this.toDto(current), null, ip);
    });
  }

  private record(
    tx: Prisma.TransactionClient,
    p: AccessClaims,
    op: "create" | "update" | "delete",
    id: string,
    before: Category | null,
    after: Category | null,
    ip: string | null,
  ): Promise<void> {
    return this.audit.record(
      { orgId: p.org, actorType: "STAFF", actorId: p.sub, action: `service_category.${op}`, entity: "service_category", entityId: id, before, after, ip },
      tx,
    );
  }

  private toDto(row: ServiceCategory): Category {
    return { id: row.id, name: row.name as LocalizedText, sort: row.sort };
  }
}
