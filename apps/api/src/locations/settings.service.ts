import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { type AccessClaims, type StaffSettings, type StaffSettingsPatch } from "@beautyspa/contracts";
import { AuditService } from "../audit/audit.service.js";
import { recordStaffAudit } from "../audit/staff-audit.js";
import { notFound } from "../common/http-errors.js";
import { readLocationSettings } from "../common/location-settings.js";
import { dayHoursFromRows, wallToTime } from "../common/wall-time.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { LocationService } from "../tenancy/location.service.js";

/** Location profile, booking settings and weekly opening hours (replaced as a set). */
@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly locations: LocationService,
  ) {}

  async get(orgId: string, locationId?: string): Promise<StaffSettings> {
    const location = await this.locations.resolve(orgId, locationId);
    return this.load(this.prisma, orgId, location.id);
  }

  patch(
    principal: AccessClaims,
    locationId: string | undefined,
    patch: StaffSettingsPatch,
    ip: string | null,
  ): Promise<StaffSettings> {
    return this.prisma.$transaction(async (tx) => {
      const resolved = await this.locations.resolve(principal.org, locationId, tx);
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM location
        WHERE id = ${resolved.id}::uuid AND organization_id = ${principal.org}::uuid
        FOR UPDATE`;
      if (locked.length === 0) throw notFound("Location");
      const before = await this.load(tx, principal.org, resolved.id);
      const row = await tx.location.findUniqueOrThrow({ where: { id: resolved.id }, select: { settings: true } });

      const data: Prisma.LocationUpdateInput = {};
      if (patch.name !== undefined) data.name = patch.name;
      if (patch.address !== undefined) data.address = patch.address;
      if (patch.phone !== undefined) data.phone = patch.phone;
      if (patch.timezone !== undefined) data.timezone = patch.timezone;
      if (patch.settings !== undefined) {
        const stored =
          row.settings !== null && typeof row.settings === "object" && !Array.isArray(row.settings) ? row.settings : {};
        data.settings = { ...stored, ...patch.settings } as Prisma.InputJsonObject;
      }
      if (Object.keys(data).length > 0) await tx.location.update({ where: { id: resolved.id }, data });

      if (patch.hours !== undefined) {
        await tx.locationHours.deleteMany({ where: { locationId: resolved.id } });
        await tx.locationHours.createMany({
          data: patch.hours.map((h) => ({
            locationId: resolved.id,
            weekday: h.weekday,
            opens: wallToTime(h.start),
            closes: wallToTime(h.end),
          })),
        });
      }

      const after = await this.load(tx, principal.org, resolved.id);
      await recordStaffAudit(this.audit, tx, principal, "location", "update", resolved.id, before, after, ip);
      return after;
    });
  }

  private async load(db: Prisma.TransactionClient, orgId: string, locationId: string): Promise<StaffSettings> {
    const loc = await db.location.findFirst({
      where: { id: locationId, organizationId: orgId },
      include: { hours: true },
    });
    if (!loc) throw notFound("Location");
    return {
      location: { id: loc.id, name: loc.name, address: loc.address, phone: loc.phone, timezone: loc.timezone },
      settings: readLocationSettings(loc.settings),
      hours: dayHoursFromRows(loc.hours.map((h) => ({ weekday: h.weekday, start: h.opens, end: h.closes }))),
    };
  }
}
