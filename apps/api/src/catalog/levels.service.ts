import { Injectable } from "@nestjs/common";
import type { Level as LevelRow, Prisma } from "@prisma/client";
import type { AccessClaims, Level, LevelInput, LevelUpdate, LocalizedText } from "@beautyspa/contracts";
import { AuditService } from "../audit/audit.service.js";
import { notFound } from "../common/http-errors.js";
import { PrismaService } from "../prisma/prisma.service.js";

@Injectable()
export class LevelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(orgId: string): Promise<Level[]> {
    const rows = await this.prisma.level.findMany({ where: { organizationId: orgId }, orderBy: { rank: "asc" } });
    return rows.map((r) => this.toDto(r));
  }

  async get(orgId: string, id: string): Promise<Level> {
    const row = await this.prisma.level.findFirst({ where: { id, organizationId: orgId } });
    if (!row) throw notFound("Level");
    return this.toDto(row);
  }

  create(principal: AccessClaims, input: LevelInput, ip: string | null): Promise<Level> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.level.create({ data: { organizationId: principal.org, name: input.name, rank: input.rank } });
      const dto = this.toDto(row);
      await this.record(tx, principal, "create", dto.id, null, dto, ip);
      return dto;
    });
  }

  update(principal: AccessClaims, id: string, patch: LevelUpdate, ip: string | null): Promise<Level> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.level.findFirst({ where: { id, organizationId: principal.org } });
      if (!current) throw notFound("Level");
      const row = await tx.level.update({
        where: { id },
        data: {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.rank !== undefined ? { rank: patch.rank } : {}),
        },
      });
      const dto = this.toDto(row);
      await this.record(tx, principal, "update", id, this.toDto(current), dto, ip);
      return dto;
    });
  }

  remove(principal: AccessClaims, id: string, ip: string | null): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.level.findFirst({ where: { id, organizationId: principal.org } });
      if (!current) throw notFound("Level");
      await tx.level.delete({ where: { id } });
      await this.record(tx, principal, "delete", id, this.toDto(current), null, ip);
    });
  }

  private record(
    tx: Prisma.TransactionClient,
    p: AccessClaims,
    op: "create" | "update" | "delete",
    id: string,
    before: Level | null,
    after: Level | null,
    ip: string | null,
  ): Promise<void> {
    return this.audit.record(
      { orgId: p.org, actorType: "STAFF", actorId: p.sub, action: `level.${op}`, entity: "level", entityId: id, before, after, ip },
      tx,
    );
  }

  private toDto(row: LevelRow): Level {
    return { id: row.id, name: row.name as LocalizedText, rank: row.rank };
  }
}
