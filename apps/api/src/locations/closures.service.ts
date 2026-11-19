import { Injectable } from "@nestjs/common";
import type { LocationClosure as ClosureRow } from "@prisma/client";
import { z } from "zod";
import {
  IsoInstantSchema,
  refineInstantRange,
  type AccessClaims,
  type Closure,
  type ClosureInput,
  type ClosureQuery,
  type ClosureUpdate,
} from "@beautyspa/contracts";
import { AuditService } from "../audit/audit.service.js";
import { recordStaffAudit } from "../audit/staff-audit.js";
import { invalidRef, notFound } from "../common/http-errors.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { LocationService } from "../tenancy/location.service.js";

const RangeSchema = z
  .object({ startsAt: IsoInstantSchema, endsAt: IsoInstantSchema })
  .superRefine(refineInstantRange);

/** Dates on which a location is closed; rows hang off the location, so the org check goes through it. */
@Injectable()
export class ClosuresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly locations: LocationService,
  ) {}

  /** Closures overlapping `[from, to)`, by `startsAt`. */
  async list(orgId: string, q: ClosureQuery): Promise<Closure[]> {
    const location = await this.locations.resolve(orgId, q.locationId);
    const rows = await this.prisma.locationClosure.findMany({
      where: {
        locationId: location.id,
        location: { organizationId: orgId },
        startsAt: { lt: new Date(q.to) },
        endsAt: { gt: new Date(q.from) },
      },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    });
    return rows.map(toDto);
  }

  create(principal: AccessClaims, input: ClosureInput, ip: string | null): Promise<Closure> {
    return this.prisma.$transaction(async (tx) => {
      const location = await this.locations.resolve(principal.org, input.locationId, tx);
      const row = await tx.locationClosure.create({
        data: {
          locationId: location.id,
          startsAt: new Date(input.startsAt),
          endsAt: new Date(input.endsAt),
          reason: input.reason,
        },
      });
      const dto = toDto(row);
      await recordStaffAudit(this.audit, tx, principal, "location_closure", "create", dto.id, null, dto, ip);
      return dto;
    });
  }

  update(principal: AccessClaims, id: string, patch: ClosureUpdate, ip: string | null): Promise<Closure> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT c.id FROM location_closure c JOIN location l ON l.id = c.location_id
        WHERE c.id = ${id}::uuid AND l.organization_id = ${principal.org}::uuid
        FOR UPDATE OF c`;
      if (locked.length === 0) throw notFound("Closure");
      const current = await tx.locationClosure.findUniqueOrThrow({ where: { id } });
      const before = toDto(current);
      const merged = {
        startsAt: patch.startsAt ?? before.startsAt,
        endsAt: patch.endsAt ?? before.endsAt,
        reason: patch.reason !== undefined ? patch.reason : current.reason,
      };
      const range = RangeSchema.safeParse(merged);
      if (!range.success) throw invalidRef("endsAt", range.error.issues[0]?.message ?? "Invalid range");
      const row = await tx.locationClosure.update({
        where: { id },
        data: { startsAt: new Date(merged.startsAt), endsAt: new Date(merged.endsAt), reason: merged.reason },
      });
      const after = toDto(row);
      await recordStaffAudit(this.audit, tx, principal, "location_closure", "update", id, before, after, ip);
      return after;
    });
  }

  remove(principal: AccessClaims, id: string, ip: string | null): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT c.id FROM location_closure c JOIN location l ON l.id = c.location_id
        WHERE c.id = ${id}::uuid AND l.organization_id = ${principal.org}::uuid
        FOR UPDATE OF c`;
      if (locked.length === 0) throw notFound("Closure");
      const current = await tx.locationClosure.findUniqueOrThrow({ where: { id } });
      await tx.locationClosure.delete({ where: { id } });
      await recordStaffAudit(this.audit, tx, principal, "location_closure", "delete", id, toDto(current), null, ip);
    });
  }
}

function toDto(r: ClosureRow): Closure {
  return {
    id: r.id,
    locationId: r.locationId,
    startsAt: r.startsAt.toISOString(),
    endsAt: r.endsAt.toISOString(),
    reason: r.reason,
  };
}
