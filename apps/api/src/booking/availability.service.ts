import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { AccessClaims, AvailabilityQuery, Slot } from "@beautyspa/contracts";
import { AvailabilityError, findSlots } from "@beautyspa/availability";
import { CLOCK, type Clock } from "../common/clock.js";
import { invalidRef, notFound } from "../common/http-errors.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { LocationService } from "../tenancy/location.service.js";
import { TenancyService } from "../tenancy/tenancy.service.js";
import { BookingContextService } from "./booking-context.service.js";
import { toSlotDto } from "./plan-mapping.js";

/**
 * Read-only slot search; the mode comes from the token (no token or customer: online; staff: staff).
 * Staff `override=true` also lists times outside hours and closures, each flagged `outsideHours`.
 */
@Injectable()
export class AvailabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenancy: TenancyService,
    private readonly locations: LocationService,
    private readonly context: BookingContextService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async slots(principal: AccessClaims | undefined, query: AvailabilityQuery): Promise<Slot[]> {
    const staff = principal?.typ === "staff";
    if (query.override && !staff) throw invalidRef("override", "Override is for staff only");
    const orgId = await this.tenancy.getOrgId();
    const location = await this.locations.resolve(orgId, query.locationId);
    if (query.excludeAppointmentId !== undefined) {
      await this.assertMayExclude(principal, orgId, query.excludeAppointmentId);
    }
    const ctx = await this.context.load(this.prisma, orgId, location, {
      mode: staff ? "STAFF" : "ONLINE",
      now: this.clock.now(),
      date: query.date,
      ...(query.excludeAppointmentId !== undefined ? { excludeAppointmentId: query.excludeAppointmentId } : {}),
    });
    const search = { ...ctx, choices: query.services, date: query.date };
    try {
      const normal = findSlots(search);
      if (!query.override) return normal.map(toSlotDto);
      // Same snapshot, hours and closures relaxed; overlaps stay forbidden.
      const normalStarts = new Set(normal.map((s) => s.start));
      return findSlots({ ...search, override: true }).map((s) => ({
        ...toSlotDto(s),
        outsideHours: !normalStarts.has(s.start),
      }));
    } catch (err) {
      if (err instanceof AvailabilityError && (err.code === "UNKNOWN_SERVICE" || err.code === "UNKNOWN_EMPLOYEE")) {
        throw invalidRef("services", "Unknown service or employee");
      }
      throw err;
    }
  }

  private async assertMayExclude(principal: AccessClaims | undefined, orgId: string, id: string): Promise<void> {
    if (!principal) {
      throw new UnauthorizedException({ code: "UNAUTHORIZED", message: "Authentication required" });
    }
    const found = await this.prisma.appointment.findFirst({
      where: { id, organizationId: orgId, ...(principal.typ === "customer" ? { customerId: principal.sub } : {}) },
      select: { id: true },
    });
    if (!found) throw notFound("Appointment");
  }
}
