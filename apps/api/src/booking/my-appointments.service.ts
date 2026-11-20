import { Inject, Injectable } from "@nestjs/common";
import type { AccessClaims, MyAppointments } from "@beautyspa/contracts";
import { CLOCK, type Clock } from "../common/clock.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { APPOINTMENT_INCLUDE, toAppointmentDto, type AppointmentRow } from "./appointment-mapping.js";

const PAST_LIMIT = 50;
const UPCOMING_STATUSES = new Set(["BOOKED", "CHECKED_IN"]);

const startOf = (row: AppointmentRow) => Math.min(...row.segments.map((s) => s.startsAt.getTime()));
const endOf = (row: AppointmentRow) => Math.max(...row.segments.map((s) => s.endsAt.getTime()));

/** The signed-in customer's own appointments. */
@Injectable()
export class MyAppointmentsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Every appointment of the caller except `HELD`. `upcoming`: `BOOKED` or `CHECKED_IN` ending
   * after now, ascending by start. `past`: everything else, descending by start, at most 50.
   * Start and end come from the segments (as in the DTO).
   */
  async list(principal: AccessClaims): Promise<MyAppointments> {
    const now = this.clock.now();
    const rows = await this.prisma.appointment.findMany({
      where: { organizationId: principal.org, customerId: principal.sub, status: { not: "HELD" } },
      include: APPOINTMENT_INCLUDE,
    });
    const withSegments = rows.filter((r) => r.segments.length > 0);
    const isUpcoming = (r: AppointmentRow) => UPCOMING_STATUSES.has(r.status) && endOf(r) > now;
    const upcoming = withSegments.filter(isUpcoming).sort((a, b) => startOf(a) - startOf(b));
    const past = withSegments
      .filter((r) => !isUpcoming(r))
      .sort((a, b) => startOf(b) - startOf(a))
      .slice(0, PAST_LIMIT);
    return { upcoming: upcoming.map(toAppointmentDto), past: past.map(toAppointmentDto) };
  }
}
