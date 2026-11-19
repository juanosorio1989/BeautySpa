import { Injectable } from "@nestjs/common";
import type { Prisma, Resource as ResourceRow } from "@prisma/client";
import type { AccessClaims, Resource, ResourceInput, ResourceUpdate } from "@beautyspa/contracts";
import { AuditService } from "../audit/audit.service.js";
import { invalidRef, notFound } from "../common/http-errors.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { LocationService } from "../tenancy/location.service.js";

@Injectable()
export class ResourcesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly locations: LocationService,
  ) {}

  async list(orgId: string, locationId?: string): Promise<Resource[]> {
    const rows = await this.prisma.resource.findMany({
      where: { organizationId: orgId, ...(locationId !== undefined ? { locationId } : {}) },
      orderBy: { name: "asc" },
    });
    return rows.map((r) => this.toDto(r));
  }

  async get(orgId: string, id: string): Promise<Resource> {
    const row = await this.prisma.resource.findFirst({ where: { id, organizationId: orgId } });
    if (!row) throw notFound("Resource");
    return this.toDto(row);
  }

  create(principal: AccessClaims, input: ResourceInput, ip: string | null): Promise<Resource> {
    return this.prisma.$transaction(async (tx) => {
      const location = await this.locations.resolve(principal.org, input.locationId, tx);
      await this.assertResourceType(tx, principal.org, input.resourceTypeId);
      const row = await tx.resource.create({
        data: {
          organizationId: principal.org,
          locationId: location.id,
          resourceTypeId: input.resourceTypeId,
          name: input.name,
          active: input.active,
        },
      });
      const dto = this.toDto(row);
      await this.record(tx, principal, "create", dto.id, null, dto, ip);
      return dto;
    });
  }

  update(principal: AccessClaims, id: string, patch: ResourceUpdate, ip: string | null): Promise<Resource> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.resource.findFirst({ where: { id, organizationId: principal.org } });
      if (!current) throw notFound("Resource");
      if (patch.resourceTypeId !== undefined) await this.assertResourceType(tx, principal.org, patch.resourceTypeId);
      const row = await tx.resource.update({
        where: { id },
        data: {
          ...(patch.resourceTypeId !== undefined ? { resourceTypeId: patch.resourceTypeId } : {}),
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.active !== undefined ? { active: patch.active } : {}),
        },
      });
      const dto = this.toDto(row);
      await this.record(tx, principal, "update", id, this.toDto(current), dto, ip);
      return dto;
    });
  }

  private async assertResourceType(tx: Prisma.TransactionClient, orgId: string, id: string): Promise<void> {
    const found = await tx.resourceType.findFirst({ where: { id, organizationId: orgId }, select: { id: true } });
    if (!found) throw invalidRef("resourceTypeId", "Unknown resource type");
  }

  private record(
    tx: Prisma.TransactionClient,
    p: AccessClaims,
    op: "create" | "update",
    id: string,
    before: Resource | null,
    after: Resource | null,
    ip: string | null,
  ): Promise<void> {
    return this.audit.record(
      { orgId: p.org, actorType: "STAFF", actorId: p.sub, action: `resource.${op}`, entity: "resource", entityId: id, before, after, ip },
      tx,
    );
  }

  private toDto(row: ResourceRow): Resource {
    return {
      id: row.id,
      locationId: row.locationId,
      resourceTypeId: row.resourceTypeId,
      name: row.name,
      active: row.active,
    };
  }
}
