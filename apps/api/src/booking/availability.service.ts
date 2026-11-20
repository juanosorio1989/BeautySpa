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

/** Read-only slot search; the mode comes from the token (no token or customer: online; staff: staff). */
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
    const orgId = await this.tenancy.getOrgId();
    const location = await this.locations.resolve(orgId, query.locationId);
    if (query.excludeAppointmentId !== undefined) {
      await this.assertMayExclude(principal, orgId, query.excludeAppointmentId);
    }
    const ctx = await this.context.load(this.prisma, orgId, location, {
      mode: principal?.typ === "staff" ? "STAFF" : "ONLINE",
      now: this.clock.now(),
      date: query.date,
      ...(query.excludeAppointmentId !== undefined ? { excludeAppointmentId: query.excludeAppointmentId } : {}),
    });
    try {
      return findSlots({ ...ctx, choices: query.services, date: query.date }).map(toSlotDto);
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
