import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse } from "@nestjs/swagger";
import type { Request } from "express";
import { createZodDto } from "nestjs-zod";
import {
  TimeOffInputSchema,
  TimeOffQuerySchema,
  TimeOffSchema,
  TimeOffUpdateSchema,
  type AccessClaims,
  type TimeOff,
} from "@beautyspa/contracts";
import { Principal, StaffAuth } from "../auth/decorators.js";
import { requestMeta } from "../auth/request-meta.js";
import { IdPipe } from "../common/id-pipe.js";
import { TimeOffService } from "./time-off.service.js";

class TimeOffInputDto extends createZodDto(TimeOffInputSchema) {}
class TimeOffUpdateDto extends createZodDto(TimeOffUpdateSchema) {}
class TimeOffQueryDto extends createZodDto(TimeOffQuerySchema) {}
class TimeOffDto extends createZodDto(TimeOffSchema) {}

@Controller("staff/time-off")
export class TimeOffController {
  constructor(private readonly timeOff: TimeOffService) {}

  /** Rows overlapping `[from, to)`. An EMPLOYEE sees only their own; another `employeeId` is 403. */
  @StaffAuth()
  @Get()
  @ApiOkResponse({ type: [TimeOffDto] })
  list(@Principal() p: AccessClaims, @Query() query: TimeOffQueryDto): Promise<TimeOff[]> {
    return this.timeOff.list(p, query);
  }

  @StaffAuth("OWNER", "RECEPTION")
  @Post()
  @ApiCreatedResponse({ type: TimeOffDto })
  create(@Principal() p: AccessClaims, @Body() body: TimeOffInputDto, @Req() req: Request): Promise<TimeOff> {
    return this.timeOff.create(p, body, requestMeta(req).ip);
  }

  @StaffAuth("OWNER", "RECEPTION")
  @Patch(":id")
  @ApiOkResponse({ type: TimeOffDto })
  update(
    @Principal() p: AccessClaims,
    @Param("id", IdPipe) id: string,
    @Body() body: TimeOffUpdateDto,
    @Req() req: Request,
  ): Promise<TimeOff> {
    return this.timeOff.update(p, id, body, requestMeta(req).ip);
  }

  @StaffAuth("OWNER", "RECEPTION")
  @Delete(":id")
  @HttpCode(204)
  @ApiNoContentResponse()
  remove(@Principal() p: AccessClaims, @Param("id", IdPipe) id: string, @Req() req: Request): Promise<void> {
    return this.timeOff.remove(p, id, requestMeta(req).ip);
  }
}
