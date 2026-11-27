import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { AppointmentStatus, Prisma } from "@prisma/client";
import { employeeFreeTime } from "@beautyspa/availability";
import type { AccessClaims, Agenda, AgendaQuery, LocalizedText } from "@beautyspa/contracts";
import { localDayBoundsUtc } from "@beautyspa/datetime";
import { CLOCK, type Clock } from "../common/clock.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { staffDisplayName } from "../staff/staff-me.service.js";
import { LocationService } from "../tenancy/location.service.js";
import { BookingContextService } from "./booking-context.service.js";
import { APPOINTMENT_INCLUDE, startOf, toStaffAppointmentDto } from "./appointment-mapping.js";

const STATUSES: AppointmentStatus[] = ["BOOKED", "CHECKED_IN", "COMPLETED", "NO_SHOW"];

/** Staff day agenda. */
@Injectable()
export class AgendaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly locations: LocationService,
    private readonly context: BookingContextService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * `BOOKED`, `CHECKED_IN`, `COMPLETED` and `NO_SHOW` (plus `CANCELLED` with `includeCancelled`) appointments of the location whose earliest
   * segment starts inside the local `date`, by start. An EMPLOYEE only gets their own
   * (another `employeeId` is 403).
   */
  async day(principal: AccessClaims, query: AgendaQuery): Promise<Agenda> {
    let employeeId = query.employeeId;
    if (principal.role === "EMPLOYEE") {
      if (employeeId !== undefined && employeeId !== principal.sub) {
        throw new ForbiddenException({ code: "FORBIDDEN", message: "Employees see only their own agenda" });
      }
      employeeId = principal.sub;
    }
    const location = await this.locations.resolve(principal.org, query.locationId);
    const { start, end } = localDayBoundsUtc(query.date, location.timezone);
    const and: Prisma.AppointmentWhereInput[] = [
      { segments: { some: { startsAt: { gte: new Date(start), lt: new Date(end) } } } },
    ];
    if (employeeId !== undefined) and.push({ segments: { some: { staffUserId: employeeId } } });
    const rows = await this.prisma.appointment.findMany({
      where: {
        organizationId: principal.org,
        locationId: location.id,
        status: { in: query.includeCancelled ? [...STATUSES, "CANCELLED"] : STATUSES },
        AND: and,
      },
      include: APPOINTMENT_INCLUDE,
    });
    const dayRows = rows
      .filter((r) => {
        const s = startOf(r);
        return s >= start && s < end;
      })
      .sort((a, b) => startOf(a) - startOf(b) || a.id.localeCompare(b.id));
    const appointments = dayRows.map(toStaffAppointmentDto);
    const segments = dayRows.flatMap((r) => r.segments);
    const [employees, services, resources] = await Promise.all([
      this.employees(principal.org, location, query, employeeId, principal.role === "EMPLOYEE", segments),
      this.services(principal.org, segments),
      this.resources(principal.org, segments),
    ]);
    return {
      date: query.date,
      locationId: location.id,
      timezone: location.timezone,
      appointments,
      employees,
      services,
      resources,
    };
  }

  /** Active employees of the location (only `employeeId` when filtered) plus those referenced by segments. */
  private async employees(
    org: string,
    location: { id: string; timezone: string },
    query: AgendaQuery,
    employeeId: string | undefined,
    selfOnly: boolean,
    segments: { staffUserId: string }[],
  ): Promise<Agenda["employees"]> {
    const ctx = await this.context.load(this.prisma, org, location, {
      mode: "STAFF",
      now: this.clock.now(),
      date: query.date,
    });
    const inputs = new Map(ctx.employees.map((e) => [e.id, e]));
    const ids = new Set<string>(employeeId !== undefined ? [] : inputs.keys());
    if (employeeId !== undefined && (selfOnly || inputs.has(employeeId))) ids.add(employeeId);
    if (!selfOnly) for (const s of segments) ids.add(s.staffUserId);
    const rows = await this.prisma.staffUser.findMany({
      where: { organizationId: org, id: { in: [...ids] } },
      select: { id: true, email: true, active: true, employeeProfile: { select: { displayName: true } } },
    });
    return rows
      .map((r) => {
        const input = inputs.get(r.id);
        const active = r.active && input !== undefined;
        const ranges =
          active && input
            ? employeeFreeTime({
                employee: input,
                location: ctx.location,
                date: query.date,
                busy: [],
                ignoreHours: false,
              })
            : [];
        return {
          id: r.id,
          displayName: staffDisplayName(r),
          active,
          ranges: ranges.map((x) => ({ start: new Date(x.start).toISOString(), end: new Date(x.end).toISOString() })),
        };
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName, "en") || a.id.localeCompare(b.id));
  }

  private async services(org: string, segments: { serviceId: string }[]): Promise<Agenda["services"]> {
    const ids = [...new Set(segments.map((s) => s.serviceId))];
    const rows = await this.prisma.service.findMany({
      where: { organizationId: org, id: { in: ids } },
      select: { id: true, name: true },
    });
    return rows.map((r) => ({ id: r.id, name: r.name as LocalizedText })).sort((a, b) => a.id.localeCompare(b.id));
  }

  private async resources(org: string, segments: { resourceId: string | null }[]): Promise<Agenda["resources"]> {
    const ids = [...new Set(segments.flatMap((s) => (s.resourceId ? [s.resourceId] : [])))];
    const rows = await this.prisma.resource.findMany({
      where: { organizationId: org, id: { in: ids } },
      select: { id: true, name: true },
    });
    return rows.sort((a, b) => a.id.localeCompare(b.id));
  }
}
