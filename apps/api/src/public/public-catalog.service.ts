import { Injectable } from "@nestjs/common";
import type { Category, Level, LocalizedText, PublicService } from "@beautyspa/contracts";
import { PrismaService } from "../prisma/prisma.service.js";

export interface BookableEmployee {
  id: string;
  displayName: string;
  bio: LocalizedText | null;
  photoUrl: string | null;
  level: Level | null;
  /** Every service the employee is qualified for, active or not: callers must filter with `listedServices`. */
  serviceIds: string[];
}

/** Reads behind the public catalog; `bookableEmployees` is also used by booking (plan 04). */
@Injectable()
export class PublicCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Active staff with a `bookableOnline` profile assigned to the location, with level and
   * all their qualified service ids (including inactive or non-listed services; filter
   * through `listedServices`).
   */
  async bookableEmployees(orgId: string, locationId: string): Promise<BookableEmployee[]> {
    const rows = await this.prisma.staffUser.findMany({
      where: {
        organizationId: orgId,
        active: true,
        employeeProfile: { is: { bookableOnline: true } },
        staffLocations: { some: { locationId } },
      },
      include: { employeeProfile: { include: { level: true } }, employeeServices: { select: { serviceId: true } } },
    });
    return rows.map((r) => {
      const p = r.employeeProfile!;
      return {
        id: r.id,
        displayName: p.displayName,
        bio: p.bio as LocalizedText | null,
        photoUrl: p.photoUrl,
        level: p.level ? { id: p.level.id, name: p.level.name as LocalizedText, rank: p.level.rank } : null,
        serviceIds: r.employeeServices.map((s) => s.serviceId),
      };
    });
  }

  /**
   * The services bookable online at the location, with the categories that have one.
   * A service is listed when it is `active && onlineBookable`, at least one of `employees`
   * (from `bookableEmployees`) does it, and, if it has a `resourceTypeId`, the location has
   * an active resource of that type. `fromPriceCents` is the cheapest qualified employee's
   * price (level override, else `priceCents`). Services sort by category `sort`
   * (uncategorized last), then `name.en`.
   */
  async listedServices(
    orgId: string,
    locationId: string,
    employees: BookableEmployee[],
  ): Promise<{ categories: Category[]; services: PublicService[] }> {
    const [services, resources] = await Promise.all([
      this.prisma.service.findMany({
        where: { organizationId: orgId, active: true, onlineBookable: true },
        include: { levelPrices: true },
      }),
      this.prisma.resource.findMany({
        where: { organizationId: orgId, locationId, active: true },
        select: { resourceTypeId: true },
      }),
    ]);
    const typesAvailable = new Set(resources.map((r) => r.resourceTypeId));

    const listed: PublicService[] = [];
    for (const s of services) {
      if (s.resourceTypeId !== null && !typesAvailable.has(s.resourceTypeId)) continue;
      const candidates = employees
        .filter((e) => e.serviceIds.includes(s.id))
        .map((e) => s.levelPrices.find((p) => p.levelId === e.level?.id)?.priceCents ?? s.priceCents);
      if (candidates.length === 0) continue;
      listed.push({
        id: s.id,
        categoryId: s.categoryId,
        name: s.name as LocalizedText,
        description: s.description as LocalizedText | null,
        durationMin: s.durationMin,
        priceCents: s.priceCents,
        fromPriceCents: Math.min(...candidates),
        parallelizable: s.parallelizable,
      });
    }

    const usedCategoryIds = [...new Set(listed.map((s) => s.categoryId).filter((id): id is string => id !== null))];
    const categoryRows = usedCategoryIds.length
      ? await this.prisma.serviceCategory.findMany({ where: { organizationId: orgId, id: { in: usedCategoryIds } } })
      : [];
    const categories: Category[] = categoryRows
      .map((c) => ({ id: c.id, name: c.name as LocalizedText, sort: c.sort }))
      .sort((a, b) => a.sort - b.sort || a.name.en.localeCompare(b.name.en, "en"));
    const sortOf = new Map(categories.map((c) => [c.id, c.sort]));
    const rank = (s: PublicService) => (s.categoryId ? (sortOf.get(s.categoryId) ?? Infinity) : Infinity);
    listed.sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      return ra === rb ? a.name.en.localeCompare(b.name.en, "en") : ra < rb ? -1 : 1;
    });
    return { categories, services: listed };
  }
}
