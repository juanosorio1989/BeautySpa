import { Body, Controller, Get, Patch, Query, Req } from "@nestjs/common";
import { ApiOkResponse } from "@nestjs/swagger";
import type { Request } from "express";
import { createZodDto } from "nestjs-zod";
import {
  LocationQuerySchema,
  StaffSettingsPatchSchema,
  StaffSettingsSchema,
  type AccessClaims,
  type StaffSettings,
} from "@beautyspa/contracts";
import { Principal, StaffAuth } from "../auth/decorators.js";
import { requestMeta } from "../auth/request-meta.js";
import { SettingsService } from "./settings.service.js";

class LocationQueryDto extends createZodDto(LocationQuerySchema) {}
class StaffSettingsPatchDto extends createZodDto(StaffSettingsPatchSchema) {}
class StaffSettingsDto extends createZodDto(StaffSettingsSchema) {}

/** `locationId` may be omitted only in an organization with a single location. */
@Controller("staff/settings")
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @StaffAuth("OWNER")
  @Get()
  @ApiOkResponse({ type: StaffSettingsDto })
  get(@Principal() p: AccessClaims, @Query() query: LocationQueryDto): Promise<StaffSettings> {
    return this.settings.get(p.org, query.locationId);
  }

  /** Merges `settings`, replaces all `hours`, updates the other fields. One audit row `location.update`. */
  @StaffAuth("OWNER")
  @Patch()
  @ApiOkResponse({ type: StaffSettingsDto })
  patch(
    @Principal() p: AccessClaims,
    @Query() query: LocationQueryDto,
    @Body() body: StaffSettingsPatchDto,
    @Req() req: Request,
  ): Promise<StaffSettings> {
    return this.settings.patch(p, query.locationId, body, requestMeta(req).ip);
  }
}
