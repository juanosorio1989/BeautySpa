import { Controller, Get, Query } from "@nestjs/common";
import { ApiOkResponse, ApiQuery } from "@nestjs/swagger";
import { ZodValidationPipe, createZodDto } from "nestjs-zod";
import {
  IdSchema,
  PublicEmployeeSchema,
  PublicLocationSchema,
  PublicServicesResponseSchema,
  type PublicEmployee,
  type PublicLocation,
  type PublicServicesResponse,
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

  /** Listing rules live in `PublicCatalogService.listedServices`. */
  @Public()
  @Get("services")
  @ApiQuery({ name: "locationId", required: false })
  @ApiOkResponse({ type: PublicServicesDto })
  async listServices(@Query("locationId", OptionalIdPipe) locationId?: string): Promise<PublicServicesResponse> {
    const orgId = await this.tenancy.getOrgId();
    const location = await this.locations.resolve(orgId, locationId);
    const employees = await this.catalog.bookableEmployees(orgId, location.id);
    return this.catalog.listedServices(orgId, location.id, employees);
  }

  @Public()
  @Get("employees")
  @ApiQuery({ name: "locationId", required: false })
  @ApiOkResponse({ type: [PublicEmployeeDto] })
  async listEmployees(@Query("locationId", OptionalIdPipe) locationId?: string): Promise<PublicEmployee[]> {
    const orgId = await this.tenancy.getOrgId();
    const location = await this.locations.resolve(orgId, locationId);
    const employees = await this.catalog.bookableEmployees(orgId, location.id);
    const listedIds = new Set(
      (await this.catalog.listedServices(orgId, location.id, employees)).services.map((x) => x.id),
    );
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
