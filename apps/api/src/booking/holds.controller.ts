import { Body, Controller, Post, Req } from "@nestjs/common";
import { ApiCreatedResponse } from "@nestjs/swagger";
import type { Request } from "express";
import { createZodDto } from "nestjs-zod";
import { HoldInputSchema, HoldSchema, type Hold } from "@beautyspa/contracts";
import { Public } from "../auth/decorators.js";
import { requestMeta } from "../auth/request-meta.js";
import { HoldsService } from "./holds.service.js";

class HoldInputDto extends createZodDto(HoldInputSchema) {}
class HoldDto extends createZodDto(HoldSchema) {}

/** Anonymous hold of a slot's plan while the visitor signs in (30 per IP per 10 minutes). */
@Controller("holds")
export class HoldsController {
  constructor(private readonly holds: HoldsService) {}

  @Public()
  @Post()
  @ApiCreatedResponse({ type: HoldDto })
  create(@Body() body: HoldInputDto, @Req() req: Request): Promise<Hold> {
    return this.holds.create(body, requestMeta(req).ip);
  }
}
