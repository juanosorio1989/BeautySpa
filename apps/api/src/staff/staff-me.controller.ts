import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse } from "@nestjs/swagger";
import { createZodDto } from "nestjs-zod";
import { StaffMeSchema, type AccessClaims, type StaffMe } from "@beautyspa/contracts";
import { Principal, StaffAuth } from "../auth/decorators.js";
import { StaffMeService } from "./staff-me.service.js";

class StaffMeDto extends createZodDto(StaffMeSchema) {}

/** The signed-in staff user (any staff role). */
@Controller("staff/me")
export class StaffMeController {
  constructor(private readonly me: StaffMeService) {}

  @StaffAuth()
  @Get()
  @ApiOkResponse({ type: StaffMeDto })
  get(@Principal() p: AccessClaims): Promise<StaffMe> {
    return this.me.me(p);
  }
}
