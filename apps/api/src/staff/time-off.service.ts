import { ForbiddenException, Injectable } from "@nestjs/common";
import type { Prisma, TimeOff as TimeOffRow } from "@prisma/client";
import {
  refineInstantRange,
  type AccessClaims,
  type TimeOff,
  type TimeOffInput,
  type TimeOffQuery,
  type TimeOffUpdate,
} from "@beautyspa/contracts";
import { AuditService } from "../audit/audit.service.js";
import { recordStaffAudit } from "../audit/staff-audit.js";
import { invalidRef, notFound } from "../common/http-errors.js";
import { PrismaService } from "../prisma/prisma.service.js";

/** Vacation and blocked time of staff members; overlapping rows are allowed. */
@Injectable()
export class TimeOffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Rows overlapping `[from, to)`, by `startsAt`. An EMPLOYEE sees only their own (403 for another `employeeId`). */
  async list(principal: AccessClaims, q: TimeOffQuery): Promise<TimeOff[]> {
    let employeeId = q.employeeId;
    if (principal.role === "EMPLOYEE") {
      if (employeeId !== undefined && employeeId !== principal.sub) {
        throw new ForbiddenException({ code: "FORBIDDEN", message: "You can only read your own time off" });
      }
      employeeId = principal.sub;
    }
    const rows = await this.prisma.timeOff.findMany({
      where: {
        organizationId: principal.org,
        startsAt: { lt: new Date(q.to) },
        endsAt: { gt: new Date(q.from) },
        ...(employeeId !== undefined ? { staffUserId: employeeId } : {}),
        ...(q.locationId !== undefined ? { locationId: q.locationId } : {}),
      },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    });
    return rows.map(toDto);
  }

  create(principal: AccessClaims, input: TimeOffInput, ip: string | null): Promise<TimeOff> {
    return this.prisma.$transaction(async (tx) => {
      const staff = await tx.staffUser.findFirst({
        where: { id: input.employeeId, organizationId: principal.org },
        select: { organizationId: true },
      });
      if (!staff) throw invalidRef("employeeId", "Unknown employee");
      await this.assertLocation(tx, input.employeeId, input.locationId);
      const row = await tx.timeOff.create({
        data: {
          organizationId: staff.organizationId,
          staffUserId: input.employeeId,
          locationId: input.locationId,
          startsAt: new Date(input.startsAt),
          endsAt: new Date(input.endsAt),
          kind: input.kind,
          note: input.note,
        },
      });
      const dto = toDto(row);
      await recordStaffAudit(this.audit, tx, principal, "time_off", "create", dto.id, null, dto, ip);
      return dto;
    });
  }

  update(principal: AccessClaims, id: string, patch: TimeOffUpdate, ip: string | null): Promise<TimeOff> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.timeOff.findFirst({ where: { id, organizationId: principal.org } });
      if (!current) throw notFound("Time off");
      const before = toDto(current);
      const merged = {
        locationId: patch.locationId !== undefined ? patch.locationId : current.locationId,
        startsAt: patch.startsAt ?? before.startsAt,
        endsAt: patch.endsAt ?? before.endsAt,
        kind: patch.kind ?? current.kind,
        note: patch.note !== undefined ? patch.note : current.note,
      };
      let message: string | undefined;
      refineInstantRange(merged, { addIssue: (i: { message?: string }) => (message ??= i.message) } as never);
      if (message !== undefined) throw invalidRef("endsAt", message);
      if (patch.locationId !== undefined) await this.assertLocation(tx, current.staffUserId, merged.locationId);
      const row = await tx.timeOff.update({
        where: { id },
        data: {
          locationId: merged.locationId,
          startsAt: new Date(merged.startsAt),
          endsAt: new Date(merged.endsAt),
          kind: merged.kind,
          note: merged.note,
        },
      });
      const after = toDto(row);
      await recordStaffAudit(this.audit, tx, principal, "time_off", "update", id, before, after, ip);
      return after;
    });
  }

  remove(principal: AccessClaims, id: string, ip: string | null): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.timeOff.findFirst({ where: { id, organizationId: principal.org } });
      if (!current) throw notFound("Time off");
      await tx.timeOff.delete({ where: { id } });
      await recordStaffAudit(this.audit, tx, principal, "time_off", "delete", id, toDto(current), null, ip);
    });
  }

  /** A non-null location must be one of the member's locations (400 on `locationId`). */
  private async assertLocation(tx: Prisma.TransactionClient, staffId: string, locationId: string | null): Promise<void> {
    if (locationId === null) return;
    const link = await tx.staffLocation.findFirst({
      where: { staffUserId: staffId, locationId },
      select: { staffUserId: true },
    });
    if (!link) throw invalidRef("locationId", "Employee is not assigned to this location");
  }
}

function toDto(r: TimeOffRow): TimeOff {
  return {
    id: r.id,
    employeeId: r.staffUserId,
    locationId: r.locationId,
    startsAt: r.startsAt.toISOString(),
    endsAt: r.endsAt.toISOString(),
    kind: r.kind,
    note: r.note,
  };
}

