import { Controller, Get, Query, Req } from "@nestjs/common";
import { ApiOkResponse, ApiQuery } from "@nestjs/swagger";
import { createZodDto } from "nestjs-zod";
import { AvailabilityQuerySchema, SlotSchema, type AccessClaims, type Slot } from "@beautyspa/contracts";
import type { Request } from "express";
import { OptionalAuth, Principal } from "../auth/decorators.js";
import { requestMeta } from "../auth/request-meta.js";
import { RateLimitService } from "../rate-limit/rate-limit.service.js";
import { AvailabilityService } from "./availability.service.js";

class AvailabilityQueryDto extends createZodDto(AvailabilityQuerySchema) {}
class SlotDto extends createZodDto(SlotSchema) {}

const PER_IP = { limit: 120, windowSec: 60 };

/** Free slots for one day. Anonymous, customer and staff callers; the token picks the mode. */
@Controller("availability")
export class AvailabilityController {
  constructor(
    private readonly availability: AvailabilityService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @OptionalAuth()
  @Get()
  @ApiQuery({
    name: "services",
    required: true,
    schema: { type: "array", items: { type: "string", example: "<serviceId>:ANY" } },
    description: "Repeated `<serviceId>:<employeeId|ANY>`, 1 to 4",
  })
  @ApiOkResponse({ type: [SlotDto] })
  async list(
    @Principal() principal: AccessClaims | undefined,
    @Query() query: AvailabilityQueryDto,
    @Req() req: Request,
  ): Promise<Slot[]> {
    const ip = requestMeta(req).ip ?? "unknown";
    await this.rateLimit.enforce(`availability:ip:${this.rateLimit.hashKeyPart(ip)}`, PER_IP.limit, PER_IP.windowSec);
    return this.availability.slots(principal, query);
  }
}
