import { Inject, Injectable } from "@nestjs/common";
import type { Hold, HoldInput } from "@beautyspa/contracts";
import { utcToWall } from "@beautyspa/datetime";
import { AuditService } from "../audit/audit.service.js";
import { CLOCK, type Clock } from "../common/clock.js";
import { conflict } from "../common/http-errors.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RateLimitService } from "../rate-limit/rate-limit.service.js";
import { LocationService } from "../tenancy/location.service.js";
import { TenancyService } from "../tenancy/tenancy.service.js";
import { APPOINTMENT_INCLUDE, toAppointmentDto } from "./appointment-mapping.js";
import {
  AppointmentWriter,
  BOOKING_TX_OPTIONS,
  lockOrgBookings,
  releaseExpiredHoldsAudited,
  releaseHold,
} from "./appointment-writer.js";
import { BookingContextService } from "./booking-context.service.js";
import { toEngineSegments } from "./plan-mapping.js";

const PER_IP = { limit: 30, windowSec: 600 };
const MINUTE = 60_000;

/** Anonymous holds: a concrete plan copied from a slot, re-validated and written in one transaction. */
@Injectable()
export class HoldsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenancy: TenancyService,
    private readonly locations: LocationService,
    private readonly context: BookingContextService,
    private readonly writer: AppointmentWriter,
    private readonly audit: AuditService,
    private readonly rateLimit: RateLimitService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async create(input: HoldInput, ip: string | null): Promise<Hold> {
    await this.enforceIpLimit(ip);
    const orgId = await this.tenancy.getOrgId();
    const segments = toEngineSegments(input.segments);
    return this.prisma.$transaction(async (tx) => {
      const location = await this.locations.resolve(orgId, input.locationId, tx);
      await lockOrgBookings(tx, orgId);
      // Read after the lock so `now` never predates the wait.
      const now = this.clock.now();
      await releaseExpiredHoldsAudited(tx, this.audit, orgId, new Date(now));
      const earliest = Math.min(...segments.map((s) => s.start));
      const ctx = await this.context.load(tx, orgId, location, {
        mode: "ONLINE",
        now,
        date: utcToWall(earliest, location.timezone).date,
      });
      this.writer.validateOrThrow(ctx, segments);

      const expiresAt = new Date(now + ctx.settings.holdMinutes * MINUTE);
      const appt = await tx.appointment.create({
        data: {
          organizationId: location.organizationId,
          locationId: location.id,
          customerId: null,
          status: "HELD",
          source: "ONLINE",
          holdExpiresAt: expiresAt,
        },
        select: { id: true, organizationId: true },
      });
      await this.writer.insertSegments(tx, appt, segments);

      const row = await tx.appointment.findUniqueOrThrow({ where: { id: appt.id }, include: APPOINTMENT_INCLUDE });
      await this.audit.record(
        {
          orgId: location.organizationId,
          actorType: "CUSTOMER",
          actorId: null,
          action: "appointment.hold",
          entity: "appointment",
          entityId: appt.id,
          before: null,
          after: toAppointmentDto(row),
          ip,
        },
        tx,
      );
      return { holdId: appt.id, expiresAt: expiresAt.toISOString() };
    }, BOOKING_TX_OPTIONS);
  }

  /**
   * Releases a hold early (the visitor went back): 204 when released now or already cancelled,
   * 409 `CONFLICT` when booked or otherwise used, 404 when unknown or another organization's.
   * Shares the `create` per-IP limit. Audited only when this call released it.
   */
  async release(holdId: string, ip: string | null): Promise<void> {
    await this.enforceIpLimit(ip);
    const orgId = await this.tenancy.getOrgId();
    await this.prisma.$transaction(async (tx) => {
      await lockOrgBookings(tx, orgId);
      // Read after the lock so `now` never predates the wait.
      const now = new Date(this.clock.now());
      await releaseExpiredHoldsAudited(tx, this.audit, orgId, now);
      const result = await releaseHold(tx, orgId, holdId, now);
      if (result === "booked") throw conflict("The hold is already booked");
      if (result === "already") return;
      await this.audit.record(
        {
          orgId,
          actorType: "CUSTOMER",
          actorId: null,
          action: "appointment.hold_release",
          entity: "appointment",
          entityId: holdId,
          before: null,
          after: { released: 1 },
          ip,
        },
        tx,
      );
    }, BOOKING_TX_OPTIONS);
  }

  private async enforceIpLimit(ip: string | null): Promise<void> {
    await this.rateLimit.enforce(
      `holds:ip:${this.rateLimit.hashKeyPart(ip ?? "unknown")}`,
      PER_IP.limit,
      PER_IP.windowSec,
    );
  }
}
