import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { ApiCreatedResponse, ApiOkResponse } from "@nestjs/swagger";
import type { Request } from "express";
import { createZodDto } from "nestjs-zod";
import {
  ClosureInputSchema,
  ClosureQuerySchema,
  ClosureSchema,
  ClosureUpdateSchema,
  type AccessClaims,
  type Closure,
} from "@beautyspa/contracts";
import { Principal, StaffAuth } from "../auth/decorators.js";
import { requestMeta } from "../auth/request-meta.js";
import { IdPipe } from "../common/id-pipe.js";
import { ClosuresService } from "./closures.service.js";

class ClosureInputDto extends createZodDto(ClosureInputSchema) {}
class ClosureUpdateDto extends createZodDto(ClosureUpdateSchema) {}
class ClosureQueryDto extends createZodDto(ClosureQuerySchema) {}
class ClosureDto extends createZodDto(ClosureSchema) {}

@Controller("staff/closures")
export class ClosuresController {
  constructor(private readonly closures: ClosuresService) {}

  /** Closures overlapping `[from, to)`; `locationId` may be omitted only with a single location. */
  @StaffAuth()
  @Get()
  @ApiOkResponse({ type: [ClosureDto] })
  list(@Principal() p: AccessClaims, @Query() query: ClosureQueryDto): Promise<Closure[]> {
    return this.closures.list(p.org, query);
  }

  @StaffAuth("OWNER")
  @Post()
  @ApiCreatedResponse({ type: ClosureDto })
  create(@Principal() p: AccessClaims, @Body() body: ClosureInputDto, @Req() req: Request): Promise<Closure> {
    return this.closures.create(p, body, requestMeta(req).ip);
  }

  @StaffAuth("OWNER")
  @Patch(":id")
  @ApiOkResponse({ type: ClosureDto })
  update(
    @Principal() p: AccessClaims,
    @Param("id", IdPipe) id: string,
    @Body() body: ClosureUpdateDto,
    @Req() req: Request,
  ): Promise<Closure> {
    return this.closures.update(p, id, body, requestMeta(req).ip);
  }

  @StaffAuth("OWNER")
  @Delete(":id")
  @HttpCode(204)
  remove(@Principal() p: AccessClaims, @Param("id", IdPipe) id: string, @Req() req: Request): Promise<void> {
    return this.closures.remove(p, id, requestMeta(req).ip);
  }
}
