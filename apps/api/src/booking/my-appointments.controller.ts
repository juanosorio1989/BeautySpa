import { Body, Controller, Get, HttpCode, Param, Post, Req } from "@nestjs/common";
import { ApiOkResponse } from "@nestjs/swagger";
import type { Request } from "express";
import { createZodDto } from "nestjs-zod";
import {
  AppointmentSchema,
  CancelInputSchema,
  MyAppointmentsSchema,
  RepeatSchema,
  RescheduleInputSchema,
  type AccessClaims,
  type Appointment,
  type MyAppointments,
  type Repeat,
} from "@beautyspa/contracts";
import { CustomerAuth, Principal } from "../auth/decorators.js";
import { requestMeta } from "../auth/request-meta.js";
import { IdPipe } from "../common/id-pipe.js";
import { MyAppointmentsService } from "./my-appointments.service.js";

class MyAppointmentsDto extends createZodDto(MyAppointmentsSchema) {}
class AppointmentDto extends createZodDto(AppointmentSchema) {}
class CancelInputDto extends createZodDto(CancelInputSchema) {}
class RescheduleInputDto extends createZodDto(RescheduleInputSchema) {}
class RepeatDto extends createZodDto(RepeatSchema) {}

/** The signed-in customer's appointments: list, cancel, reschedule and repeat. */
@Controller("me/appointments")
export class MyAppointmentsController {
  constructor(private readonly appointments: MyAppointmentsService) {}

  @CustomerAuth()
  @Get()
  @ApiOkResponse({ type: MyAppointmentsDto })
  list(@Principal() p: AccessClaims): Promise<MyAppointments> {
    return this.appointments.list(p);
  }

  @CustomerAuth()
  @Post(":id/cancel")
  @HttpCode(200)
  @ApiOkResponse({ type: AppointmentDto })
  cancel(
    @Principal() p: AccessClaims,
    @Param("id", IdPipe) id: string,
    @Body() body: CancelInputDto,
    @Req() req: Request,
  ): Promise<Appointment> {
    return this.appointments.cancel(p, id, body, requestMeta(req).ip);
  }

  @CustomerAuth()
  @Post(":id/reschedule")
  @HttpCode(200)
  @ApiOkResponse({ type: AppointmentDto })
  reschedule(
    @Principal() p: AccessClaims,
    @Param("id", IdPipe) id: string,
    @Body() body: RescheduleInputDto,
    @Req() req: Request,
  ): Promise<Appointment> {
    return this.appointments.reschedule(p, id, body, requestMeta(req).ip);
  }

  @CustomerAuth()
  @Post(":id/repeat")
  @HttpCode(200)
  @ApiOkResponse({ type: RepeatDto })
  repeat(@Principal() p: AccessClaims, @Param("id", IdPipe) id: string): Promise<Repeat> {
    return this.appointments.repeat(p, id);
  }
}
