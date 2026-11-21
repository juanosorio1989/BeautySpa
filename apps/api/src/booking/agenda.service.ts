import { ForbiddenException, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { AccessClaims, Agenda, AgendaQuery } from "@beautyspa/contracts";
import { localDayBoundsUtc } from "@beautyspa/datetime";
import { PrismaService } from "../prisma/prisma.service.js";
import { LocationService } from "../tenancy/location.service.js";
import { APPOINTMENT_INCLUDE, startOf, toStaffAppointmentDto } from "./appointment-mapping.js";

/** Staff day agenda. */
@Injectable()
export class AgendaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly locations: LocationService,
  ) {}

  /**
   * `BOOKED`, `CHECKED_IN`, `COMPLETED` and `NO_SHOW` appointments of the location whose earliest
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
        status: { in: ["BOOKED", "CHECKED_IN", "COMPLETED", "NO_SHOW"] },
        AND: and,
      },
      include: APPOINTMENT_INCLUDE,
    });
    const appointments = rows
      .filter((r) => {
        const s = startOf(r);
        return s >= start && s < end;
      })
      .sort((a, b) => startOf(a) - startOf(b) || a.id.localeCompare(b.id))
      .map(toStaffAppointmentDto);
    return { date: query.date, locationId: location.id, timezone: location.timezone, appointments };
  }
}
