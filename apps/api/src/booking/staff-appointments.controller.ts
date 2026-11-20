import { Body, Controller, HttpCode, Param, Patch, Post, Req } from "@nestjs/common";
import { ApiCreatedResponse, ApiOkResponse } from "@nestjs/swagger";
import type { Request } from "express";
import { createZodDto } from "nestjs-zod";
import {
  StaffAppointmentInputSchema,
  StaffAppointmentPatchSchema,
  StaffAppointmentSchema,
  StatusChangeSchema,
  WalkInInputSchema,
  type AccessClaims,
  type StaffAppointment,
} from "@beautyspa/contracts";
import { Principal, StaffAuth } from "../auth/decorators.js";
import { requestMeta } from "../auth/request-meta.js";
import { IdPipe } from "../common/id-pipe.js";
import { StaffAppointmentsService } from "./staff-appointments.service.js";
import { WalkInService } from "./walk-in.service.js";

class StaffAppointmentDto extends createZodDto(StaffAppointmentSchema) {}
class StaffAppointmentInputDto extends createZodDto(StaffAppointmentInputSchema) {}
class StaffAppointmentPatchDto extends createZodDto(StaffAppointmentPatchSchema) {}
class StatusChangeDto extends createZodDto(StatusChangeSchema) {}
class WalkInInputDto extends createZodDto(WalkInInputSchema) {}

/** Staff appointment writes: book, move, status changes and walk-ins. */
@Controller("staff")
export class StaffAppointmentsController {
  constructor(
    private readonly appointments: StaffAppointmentsService,
    private readonly walkIns: WalkInService,
  ) {}

  @StaffAuth("OWNER", "RECEPTION")
  @Post("appointments")
  @ApiCreatedResponse({ type: StaffAppointmentDto })
  create(
    @Principal() p: AccessClaims,
    @Body() body: StaffAppointmentInputDto,
    @Req() req: Request,
  ): Promise<StaffAppointment> {
    return this.appointments.create(p, body, requestMeta(req).ip);
  }

  @StaffAuth("OWNER", "RECEPTION")
  @Patch("appointments/:id")
  @ApiOkResponse({ type: StaffAppointmentDto })
  move(
    @Principal() p: AccessClaims,
    @Param("id", IdPipe) id: string,
    @Body() body: StaffAppointmentPatchDto,
    @Req() req: Request,
  ): Promise<StaffAppointment> {
    return this.appointments.move(p, id, body, requestMeta(req).ip);
  }

  /** Any staff role; EMPLOYEE limits are enforced by the service (design call 7). */
  @StaffAuth()
  @Post("appointments/:id/status")
  @HttpCode(200)
  @ApiOkResponse({ type: StaffAppointmentDto })
  changeStatus(
    @Principal() p: AccessClaims,
    @Param("id", IdPipe) id: string,
    @Body() body: StatusChangeDto,
    @Req() req: Request,
  ): Promise<StaffAppointment> {
    return this.appointments.changeStatus(p, id, body, requestMeta(req).ip);
  }

  @StaffAuth("OWNER", "RECEPTION")
  @Post("walk-in")
  @ApiCreatedResponse({ type: StaffAppointmentDto })
  walkIn(@Principal() p: AccessClaims, @Body() body: WalkInInputDto, @Req() req: Request): Promise<StaffAppointment> {
    return this.walkIns.create(p, body, requestMeta(req).ip);
  }
}
