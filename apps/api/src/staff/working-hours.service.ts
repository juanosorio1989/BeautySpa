import { ForbiddenException, Injectable } from "@nestjs/common";
import type { AccessClaims, DayHours, WorkingHours } from "@beautyspa/contracts";
import { AuditService } from "../audit/audit.service.js";
import { recordStaffAudit } from "../audit/staff-audit.js";
import { invalidRef, notFound } from "../common/http-errors.js";
import { dayHoursFromRows, wallToTime } from "../common/wall-time.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { LocationService } from "../tenancy/location.service.js";

/**
 * Weekly working hours per employee and location. Rows are replaced as a set
 * (no row-level CRUD); several shifts per weekday make the gaps the breaks.
 */
@Injectable()
export class WorkingHoursService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly locations: LocationService,
  ) {}

  /** OWNER and RECEPTION read anyone; an EMPLOYEE only their own (403 otherwise). */
  async get(principal: AccessClaims, staffId: string, locationId?: string): Promise<WorkingHours> {
    if (principal.role === "EMPLOYEE" && staffId !== principal.sub) {
      throw new ForbiddenException({ code: "FORBIDDEN", message: "You can only read your own working hours" });
    }
    const staff = await this.prisma.staffUser.findFirst({
      where: { id: staffId, organizationId: principal.org },
      select: { id: true },
    });
    if (!staff) throw notFound("Employee");
    const location = await this.locations.resolve(principal.org, locationId);
    const rows = await this.prisma.workingHours.findMany({
      where: { organizationId: principal.org, staffUserId: staffId, locationId: location.id },
      select: { weekday: true, startTime: true, endTime: true },
    });
    return { employeeId: staffId, locationId: location.id, days: toDays(rows) };
  }

  /** Replaces all rows of `(staffId, location)` in one transaction with its audit row. */
  async replace(
    principal: AccessClaims,
    staffId: string,
    locationId: string | undefined,
    days: DayHours[],
    ip: string | null,
  ): Promise<WorkingHours> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM staff_user
        WHERE id = ${staffId}::uuid AND organization_id = ${principal.org}::uuid
        FOR UPDATE`;
      if (locked.length === 0) throw notFound("Employee");
      const staff = await tx.staffUser.findUniqueOrThrow({ where: { id: staffId }, select: { organizationId: true } });
      const location = await this.locations.resolve(principal.org, locationId, tx);
      const link = await tx.staffLocation.findFirst({
        where: { staffUserId: staffId, locationId: location.id },
        select: { staffUserId: true },
      });
      if (!link) throw invalidRef("locationId", "Employee is not assigned to this location");

      const where = { organizationId: staff.organizationId, staffUserId: staffId, locationId: location.id };
      const old = await tx.workingHours.findMany({ where, select: { weekday: true, startTime: true, endTime: true } });
      await tx.workingHours.deleteMany({ where });
      await tx.workingHours.createMany({
        data: days.map((d) => ({
          ...where,
          weekday: d.weekday,
          startTime: wallToTime(d.start),
          endTime: wallToTime(d.end),
        })),
      });
      const result: WorkingHours = { employeeId: staffId, locationId: location.id, days: toDays(
        days.map((d) => ({ weekday: d.weekday, startTime: wallToTime(d.start), endTime: wallToTime(d.end) })),
      ) };
      await recordStaffAudit(
        this.audit,
        tx,
        principal,
        "working_hours",
        "update",
        `${staffId}:${location.id}`,
        { days: toDays(old) },
        { days: result.days },
        ip,
      );
      return result;
    });
  }
}

function toDays(rows: { weekday: number; startTime: Date; endTime: Date }[]): DayHours[] {
  return dayHoursFromRows(rows.map((r) => ({ weekday: r.weekday, start: r.startTime, end: r.endTime })));
}
