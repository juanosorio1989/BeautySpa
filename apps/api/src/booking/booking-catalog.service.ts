import { Inject, Injectable } from "@nestjs/common";
import type { AccessClaims, BookingCatalog, LocalizedText } from "@beautyspa/contracts";
import { CategoriesService } from "../catalog/categories.service.js";
import { ServiceCatalogService } from "../catalog/service-catalog.service.js";
import { CLOCK, type Clock } from "../common/clock.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { LocationService } from "../tenancy/location.service.js";

const POPULAR_DAYS = 90;
const POPULAR_MAX = 6;
const en = (t: unknown) => (t as LocalizedText).en;

/** Everything quick booking needs, STAFF view: includes services and employees not offered online. */
@Injectable()
export class BookingCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly locations: LocationService,
    private readonly categoriesReader: CategoriesService,
    private readonly serviceCatalog: ServiceCatalogService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async get(principal: AccessClaims, locationId?: string): Promise<BookingCatalog> {
    const org = principal.org;
    const location = await this.locations.resolve(org, locationId);
    const since = new Date(this.clock.now() - POPULAR_DAYS * 24 * 60 * 60 * 1000);
    const [categoryRows, serviceRows, employeeRows, counts] = await Promise.all([
      this.categoriesReader.list(org),
      this.serviceCatalog.list(org, { active: true }),
      this.prisma.staffUser.findMany({
        where: {
          organizationId: org,
          active: true,
          employeeProfile: { isNot: null },
          staffLocations: { some: { locationId: location.id } },
        },
        select: {
          id: true,
          employeeProfile: { select: { displayName: true, levelId: true } },
          employeeServices: { select: { serviceId: true } },
        },
      }),
      this.prisma.appointmentSegment.groupBy({
        by: ["serviceId"],
        where: {
          organizationId: org,
          startsAt: { gte: since, lte: new Date(this.clock.now()) },
          appointment: { locationId: location.id, status: { notIn: ["HELD", "CANCELLED"] } },
        },
        _count: { _all: true },
      }),
    ]);

    const categories = categoryRows.map((c) => ({ id: c.id, name: c.name }));
    const services = serviceRows.map((s) => ({
      id: s.id,
      categoryId: s.categoryId,
      name: s.name,
      durationMin: s.durationMin,
      priceCents: s.priceCents,
      parallelizable: s.parallelizable,
      onlineBookable: s.onlineBookable,
    }));
    const activeIds = new Set(services.map((s) => s.id));
    const employees = employeeRows
      .map((e) => ({
        id: e.id,
        displayName: e.employeeProfile!.displayName,
        levelId: e.employeeProfile!.levelId,
        serviceIds: e.employeeServices
          .map((x) => x.serviceId)
          .filter((id) => activeIds.has(id))
          .sort(),
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, "en") || a.id.localeCompare(b.id));

    const countOf = new Map(counts.map((c) => [c.serviceId, c._count._all]));
    const popularServiceIds = services
      .filter((s) => countOf.has(s.id))
      .sort(
        (a, b) =>
          countOf.get(b.id)! - countOf.get(a.id)! ||
          en(a.name).localeCompare(en(b.name), "en") ||
          a.id.localeCompare(b.id),
      )
      .slice(0, POPULAR_MAX)
      .map((s) => s.id);

    return {
      categories,
      services,
      employees,
      popularServiceIds,
    };
  }
}
