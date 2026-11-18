import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse } from "@nestjs/swagger";
import { createZodDto } from "nestjs-zod";
import { HealthResponseSchema } from "@beautyspa/contracts";

class HealthResponseDto extends createZodDto(HealthResponseSchema) {}

@Controller("health")
export class HealthController {
  @Get()
  @ApiOkResponse({ type: HealthResponseDto })
  check(): { status: "ok" } {
    return { status: "ok" };
  }
}
