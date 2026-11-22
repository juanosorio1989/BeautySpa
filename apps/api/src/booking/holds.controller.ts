import { Body, Controller, Delete, HttpCode, Param, Post, Req } from "@nestjs/common";
import { ApiCreatedResponse, ApiNoContentResponse } from "@nestjs/swagger";
import type { Request } from "express";
import { createZodDto } from "nestjs-zod";
import { HoldInputSchema, HoldSchema, type Hold } from "@beautyspa/contracts";
import { Public } from "../auth/decorators.js";
import { requestMeta } from "../auth/request-meta.js";
import { IdPipe } from "../common/id-pipe.js";
import { HoldsService } from "./holds.service.js";

class HoldInputDto extends createZodDto(HoldInputSchema) {}
class HoldDto extends createZodDto(HoldSchema) {}

/** Anonymous hold of a slot's plan while the visitor signs in, and its early release (30 per IP per 10 minutes, shared). */
@Controller("holds")
export class HoldsController {
  constructor(private readonly holds: HoldsService) {}

  @Public()
  @Post()
  @ApiCreatedResponse({ type: HoldDto })
  create(@Body() body: HoldInputDto, @Req() req: Request): Promise<Hold> {
    return this.holds.create(body, requestMeta(req).ip);
  }

  /** The hold id is the capability: no token, like `POST /holds`. */
  @Public()
  @Delete(":holdId")
  @HttpCode(204)
  @ApiNoContentResponse()
  release(@Param("holdId", IdPipe) holdId: string, @Req() req: Request): Promise<void> {
    return this.holds.release(holdId, requestMeta(req).ip);
  }
}
