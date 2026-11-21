import { Controller, Get, Query } from "@nestjs/common";
import { ApiOkResponse } from "@nestjs/swagger";
import { createZodDto } from "nestjs-zod";
import { AgendaQuerySchema, AgendaSchema, type AccessClaims, type Agenda } from "@beautyspa/contracts";
import { Principal, StaffAuth } from "../auth/decorators.js";
import { AgendaService } from "./agenda.service.js";

class AgendaDto extends createZodDto(AgendaSchema) {}
class AgendaQueryDto extends createZodDto(AgendaQuerySchema) {}

/** The staff day agenda. */
@Controller("staff/agenda")
export class AgendaController {
  constructor(private readonly agenda: AgendaService) {}

  /** Any staff role; an EMPLOYEE is limited to their own appointments by the service. */
  @StaffAuth()
  @Get()
  @ApiOkResponse({ type: AgendaDto })
  day(@Principal() p: AccessClaims, @Query() query: AgendaQueryDto): Promise<Agenda> {
    return this.agenda.day(p, query);
  }
}
