import { Controller, Get, Query } from "@nestjs/common";
import { ApiOkResponse, ApiQuery } from "@nestjs/swagger";
import { ZodValidationPipe, createZodDto } from "nestjs-zod";
import {
  IdSchema,
  PublicEmployeeSchema,
  PublicLocationSchema,
  PublicServicesResponseSchema,
  type Category,
  type PublicEmployee,
  type PublicLocation,
  type PublicService,
  type PublicServicesResponse,
  type LocalizedText,
} from "@beautyspa/contracts";
import { Public } from "../auth/decorators.js";
import { dayHoursFromRows } from "../common/wall-time.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { LocationService } from "../tenancy/location.service.js";
import { TenancyService } from "../tenancy/tenancy.service.js";
import { PublicCatalogService } from "./public-catalog.service.js";

const OptionalIdPipe = new ZodValidationPipe(IdSchema.optional());

class PublicLocationDto extends createZodDto(PublicLocationSchema) {}
class PublicServicesDto extends createZodDto(PublicServicesResponseSchema) {}
class PublicEmployeeDto extends createZodDto(PublicEmployeeSchema) {}

const byText = (a: string, b: string) => a.localeCompare(b, "en");

/** Unauthenticated catalog reads for the booking site. `locationId` may be omitted only with a single location. */
@Controller("public")
export class PublicController {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly prisma: PrismaService,
    private readonly locations: LocationService,
    private readonly catalog: PublicCatalogService,
  ) {}

  @Public()
  @Get("locations")
  @ApiOkResponse({ type: [PublicLocationDto] })
  async listLocations(): Promise<PublicLocation[]> {
    const orgId = await this.tenancy.getOrgId();
    const rows = await this.prisma.location.findMany({ where: { organizationId: orgId }, include: { hours: true } });
    return rows
      .map((l) => ({
        id: l.id,
        name: l.name,
        address: l.address,
        phone: l.phone,
        timezone: l.timezone,
        hours: dayHoursFromRows(l.hours.map((h) => ({ weekday: h.weekday, start: h.opens, end: h.closes }))),
      }))
      .sort((a, b) => byText(a.name, b.name));
  }

  /**
   * A service is listed when it is active and online-bookable, at least one listed
   * employee does it, and (if it needs a resource type) the location has an active
   * resource of that type.
   */
  @Public()
  @Get("services")
  @ApiQuery({ name: "locationId", required: false })
  @ApiOkResponse({ type: PublicServicesDto })
  async listServices(@Query("locationId", OptionalIdPipe) locationId?: string): Promise<PublicServicesResponse> {
    const orgId = await this.tenancy.getOrgId();
    const location = await this.locations.resolve(orgId, locationId);
    const employees = await this.catalog.bookableEmployees(orgId, location.id);

    const [services, resources] = await Promise.all([
      this.prisma.service.findMany({
        where: { organizationId: orgId, active: true, onlineBookable: true },
        include: { levelPrices: true },
      }),
      this.prisma.resource.findMany({
        where: { organizationId: orgId, locationId: location.id, active: true },
        select: { resourceTypeId: true },
      }),
    ]);
    const typesAvailable = new Set(resources.map((r) => r.resourceTypeId));

    const listed: PublicService[] = [];
    for (const s of services) {
      if (s.resourceTypeId !== null && !typesAvailable.has(s.resourceTypeId)) continue;
      const prices = s.levelPrices;
      const candidates = employees
        .filter((e) => e.serviceIds.includes(s.id))
        .map((e) => prices.find((p) => p.levelId === e.level?.id)?.priceCents ?? s.priceCents);
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
      .sort((a, b) => a.sort - b.sort || byText(a.name.en, b.name.en));
    const sortOf = new Map(categories.map((c) => [c.id, c.sort]));
    const rank = (s: PublicService) => (s.categoryId ? (sortOf.get(s.categoryId) ?? Infinity) : Infinity);

    listed.sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      return ra === rb ? byText(a.name.en, b.name.en) : ra < rb ? -1 : 1;
    });
    return { categories, services: listed };
  }

  @Public()
  @Get("employees")
  @ApiQuery({ name: "locationId", required: false })
  @ApiOkResponse({ type: [PublicEmployeeDto] })
  async listEmployees(@Query("locationId", OptionalIdPipe) locationId?: string): Promise<PublicEmployee[]> {
    const orgId = await this.tenancy.getOrgId();
    const location = await this.locations.resolve(orgId, locationId);
    const [employees, listedIds] = await Promise.all([
      this.catalog.bookableEmployees(orgId, location.id),
      this.listServices(location.id).then((r) => new Set(r.services.map((s) => s.id))),
    ]);
    return employees
      .map((e) => ({
        id: e.id,
        displayName: e.displayName,
        bio: e.bio,
        photoUrl: e.photoUrl,
        level: e.level,
        serviceIds: e.serviceIds.filter((id) => listedIds.has(id)),
      }))
      .sort((a, b) => byText(a.displayName, b.displayName));
  }
}
