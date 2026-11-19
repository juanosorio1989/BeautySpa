import { Injectable } from "@nestjs/common";
import type { ResourceType as ResourceTypeRow } from "@prisma/client";
import type {
  AccessClaims,
  LocalizedText,
  ResourceType,
  ResourceTypeInput,
  ResourceTypeUpdate,
} from "@beautyspa/contracts";
import { AuditService } from "../audit/audit.service.js";
import { recordStaffAudit } from "../audit/staff-audit.js";
import { isForeignKeyViolation } from "../common/db-errors.js";
import { inUse, notFound } from "../common/http-errors.js";
import { PrismaService } from "../prisma/prisma.service.js";

@Injectable()
export class ResourceTypesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(orgId: string): Promise<ResourceType[]> {
    const rows = await this.prisma.resourceType.findMany({ where: { organizationId: orgId } });
    return rows.map((r) => this.toDto(r)).sort((a, b) => a.name.en.localeCompare(b.name.en, "en"));
  }

  async get(orgId: string, id: string): Promise<ResourceType> {
    const row = await this.prisma.resourceType.findFirst({ where: { id, organizationId: orgId } });
    if (!row) throw notFound("Resource type");
    return this.toDto(row);
  }

  create(principal: AccessClaims, input: ResourceTypeInput, ip: string | null): Promise<ResourceType> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.resourceType.create({ data: { organizationId: principal.org, name: input.name } });
      const dto = this.toDto(row);
      await recordStaffAudit(this.audit, tx, principal, "resource_type", "create", dto.id, null, dto, ip);
      return dto;
    });
  }

  update(principal: AccessClaims, id: string, patch: ResourceTypeUpdate, ip: string | null): Promise<ResourceType> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.resourceType.findFirst({ where: { id, organizationId: principal.org } });
      if (!current) throw notFound("Resource type");
      const row = await tx.resourceType.update({
        where: { id },
        data: { ...(patch.name !== undefined ? { name: patch.name } : {}) },
      });
      const dto = this.toDto(row);
      await recordStaffAudit(this.audit, tx, principal, "resource_type", "update", id, this.toDto(current), dto, ip);
      return dto;
    });
  }

  async remove(principal: AccessClaims, id: string, ip: string | null): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const current = await tx.resourceType.findFirst({ where: { id, organizationId: principal.org } });
        if (!current) throw notFound("Resource type");
        await tx.resourceType.delete({ where: { id } });
        await recordStaffAudit(this.audit, tx, principal, "resource_type", "delete", id, this.toDto(current), null, ip);
      });
    } catch (err) {
      if (isForeignKeyViolation(err)) throw inUse("Resource type");
      throw err;
    }
  }

  private toDto(row: ResourceTypeRow): ResourceType {
    return { id: row.id, name: row.name as LocalizedText };
  }
}
