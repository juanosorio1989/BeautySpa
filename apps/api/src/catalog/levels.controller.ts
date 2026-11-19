import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from "@nestjs/common";
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse } from "@nestjs/swagger";
import type { Request } from "express";
import { createZodDto } from "nestjs-zod";
import { LevelInputSchema, LevelUpdateSchema, LevelSchema, type AccessClaims, type Level } from "@beautyspa/contracts";
import { Principal, StaffAuth } from "../auth/decorators.js";
import { IdPipe } from "../common/id-pipe.js";
import { requestMeta } from "../auth/request-meta.js";
import { LevelsService } from "./levels.service.js";

class LevelInputDto extends createZodDto(LevelInputSchema) {}
class LevelUpdateDto extends createZodDto(LevelUpdateSchema) {}
class LevelDto extends createZodDto(LevelSchema) {}

@Controller("staff/levels")
export class LevelsController {
  constructor(private readonly levels: LevelsService) {}

  @StaffAuth("OWNER")
  @Get()
  @ApiOkResponse({ type: [LevelDto] })
  list(@Principal() p: AccessClaims): Promise<Level[]> {
    return this.levels.list(p.org);
  }

  @StaffAuth("OWNER")
  @Post()
  @ApiCreatedResponse({ type: LevelDto })
  create(@Principal() p: AccessClaims, @Body() body: LevelInputDto, @Req() req: Request): Promise<Level> {
    return this.levels.create(p, body, requestMeta(req).ip);
  }

  @StaffAuth("OWNER")
  @Get(":id")
  @ApiOkResponse({ type: LevelDto })
  get(@Principal() p: AccessClaims, @Param("id", IdPipe) id: string): Promise<Level> {
    return this.levels.get(p.org, id);
  }

  @StaffAuth("OWNER")
  @Patch(":id")
  @ApiOkResponse({ type: LevelDto })
  update(
    @Principal() p: AccessClaims,
    @Param("id", IdPipe) id: string,
    @Body() body: LevelUpdateDto,
    @Req() req: Request,
  ): Promise<Level> {
    return this.levels.update(p, id, body, requestMeta(req).ip);
  }

  @StaffAuth("OWNER")
  @Delete(":id")
  @HttpCode(204)
  @ApiNoContentResponse()
  remove(@Principal() p: AccessClaims, @Param("id", IdPipe) id: string, @Req() req: Request): Promise<void> {
    return this.levels.remove(p, id, requestMeta(req).ip);
  }
}
