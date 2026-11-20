import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { Context, Mode, WeeklyHours } from "@beautyspa/availability";
import { localDayBoundsUtc, type IsoDate } from "@beautyspa/datetime";
import { readLocationSettings } from "../common/location-settings.js";
import { dayHoursFromRows } from "../common/wall-time.js";
import { PrismaService } from "../prisma/prisma.service.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface LoadOptions {
  mode: Mode;
  now: number;
  date: IsoDate;
  excludeAppointmentId?: string;
  override?: boolean;
}

const weekly = (rows: { weekday: number; start: Date; end: Date }[]) => dayHoursFromRows(rows) as WeeklyHours[];

/** Reads the rows the availability engine needs for one day (plus a 24 h margin each side) into its `Context`. */
@Injectable()
export class BookingContextService {
  constructor(private readonly prisma: PrismaService) {}

  async load(
    db: Prisma.TransactionClient | PrismaService,
    orgId: string,
    location: { id: string; timezone: string },
    opts: LoadOptions,
  ): Promise<Context> {
    const day = localDayBoundsUtc(opts.date, location.timezone);
    const from = new Date(day.start - DAY_MS);
    const to = new Date(day.end + DAY_MS);

    const [loc, closures, staff, services, resources, segments] = await Promise.all([
      db.location.findFirstOrThrow({
        where: { id: location.id, organizationId: orgId },
        select: { settings: true, hours: true },
      }),
      db.locationClosure.findMany({
        where: { locationId: location.id, startsAt: { lt: to }, endsAt: { gt: from } },
      }),
      db.staffUser.findMany({
        where: {
          organizationId: orgId,
          active: true,
          employeeProfile: { isNot: null },
          staffLocations: { some: { locationId: location.id } },
        },
        include: {
          employeeProfile: true,
          employeeServices: { where: { service: { active: true } }, select: { serviceId: true } },
          workingHours: { where: { locationId: location.id } },
          timeOff: {
            where: {
              OR: [{ locationId: null }, { locationId: location.id }],
              startsAt: { lt: to },
              endsAt: { gt: from },
            },
          },
        },
      }),
      db.service.findMany({ where: { organizationId: orgId, active: true }, include: { levelPrices: true } }),
      db.resource.findMany({ where: { organizationId: orgId, locationId: location.id, active: true } }),
      db.appointmentSegment.findMany({
        where: {
          organizationId: orgId,
          occupies: true,
          startsAt: { lt: to },
          blockEndsAt: { gt: from },
          ...(opts.excludeAppointmentId ? { appointmentId: { not: opts.excludeAppointmentId } } : {}),
          // Expired holds are free for reads (design call 3).
          NOT: { appointment: { status: "HELD", holdExpiresAt: { lte: new Date(opts.now) } } },
        },
        select: { staffUserId: true, resourceId: true, startsAt: true, blockEndsAt: true },
      }),
    ]);

    const settings = readLocationSettings(loc.settings);
    return {
      location: {
        timezone: location.timezone,
        slotIntervalMin: settings.slotIntervalMin,
        minLeadMinutes: settings.minLeadMinutes,
        bookingHorizonDays: settings.bookingHorizonDays,
        hours: weekly(loc.hours.map((h) => ({ weekday: h.weekday, start: h.opens, end: h.closes }))),
        closures: closures.map((c) => ({ start: c.startsAt.getTime(), end: c.endsAt.getTime() })),
      },
      employees: staff.map((s) => ({
        id: s.id,
        levelId: s.employeeProfile?.levelId ?? null,
        bookableOnline: s.employeeProfile?.bookableOnline ?? false,
        serviceIds: s.employeeServices.map((e) => e.serviceId),
        workingHours: weekly(s.workingHours.map((w) => ({ weekday: w.weekday, start: w.startTime, end: w.endTime }))),
        timeOff: s.timeOff.map((t) => ({ start: t.startsAt.getTime(), end: t.endsAt.getTime() })),
      })),
      services: services.map((s) => ({
        id: s.id,
        durationMin: s.durationMin,
        bufferAfterMin: s.bufferAfterMin,
        priceCents: s.priceCents,
        parallelizable: s.parallelizable,
        resourceTypeId: s.resourceTypeId,
        onlineBookable: s.onlineBookable,
        levelOverrides: Object.fromEntries(
          s.levelPrices.map((p) => [p.levelId, { durationMin: p.durationMin, priceCents: p.priceCents }]),
        ),
      })),
      resources: resources.map((r) => ({ id: r.id, resourceTypeId: r.resourceTypeId, name: r.name })),
      busy: segments.map((g) => ({
        employeeId: g.staffUserId,
        resourceId: g.resourceId,
        start: g.startsAt.getTime(),
        blockEnd: g.blockEndsAt.getTime(),
      })),
      mode: opts.mode,
      now: opts.now,
      ...(opts.override !== undefined ? { override: opts.override } : {}),
    };
  }
}
