import { Body, Controller, Get, Param, Put, Query, Req } from "@nestjs/common";
import { ApiOkResponse, ApiQuery } from "@nestjs/swagger";
import type { Request } from "express";
import { ZodValidationPipe, createZodDto } from "nestjs-zod";
import {
  IdSchema,
  WorkingHoursPutSchema,
  WorkingHoursSchema,
  type AccessClaims,
  type WorkingHours,
} from "@beautyspa/contracts";
import { Principal, StaffAuth } from "../auth/decorators.js";
import { requestMeta } from "../auth/request-meta.js";
import { IdPipe } from "../common/id-pipe.js";
import { WorkingHoursService } from "./working-hours.service.js";

const OptionalIdPipe = new ZodValidationPipe(IdSchema.optional());

class WorkingHoursPutDto extends createZodDto(WorkingHoursPutSchema) {}
class WorkingHoursDto extends createZodDto(WorkingHoursSchema) {}

/** `locationId` may be omitted only in an organization with a single location. */
@Controller("staff/employees/:id/working-hours")
export class WorkingHoursController {
  constructor(private readonly hours: WorkingHoursService) {}

  /** OWNER, RECEPTION; an EMPLOYEE only for their own id (403 otherwise). */
  @StaffAuth()
  @Get()
  @ApiQuery({ name: "locationId", required: false })
  @ApiOkResponse({ type: WorkingHoursDto })
  get(
    @Principal() p: AccessClaims,
    @Param("id", IdPipe) id: string,
    @Query("locationId", OptionalIdPipe) locationId?: string,
  ): Promise<WorkingHours> {
    return this.hours.get(p, id, locationId);
  }

  /** Replaces all shifts of the employee at the location. 400 on `locationId` when the employee is not assigned to it. */
  @StaffAuth("OWNER")
  @Put()
  @ApiQuery({ name: "locationId", required: false })
  @ApiOkResponse({ type: WorkingHoursDto })
  replace(
    @Principal() p: AccessClaims,
    @Param("id", IdPipe) id: string,
    @Query("locationId", OptionalIdPipe) locationId: string | undefined,
    @Body() body: WorkingHoursPutDto,
    @Req() req: Request,
  ): Promise<WorkingHours> {
    return this.hours.replace(p, id, locationId, body.days, requestMeta(req).ip);
  }
}
