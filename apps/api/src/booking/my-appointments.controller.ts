import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse } from "@nestjs/swagger";
import { createZodDto } from "nestjs-zod";
import { MyAppointmentsSchema, type AccessClaims, type MyAppointments } from "@beautyspa/contracts";
import { CustomerAuth, Principal } from "../auth/decorators.js";
import { MyAppointmentsService } from "./my-appointments.service.js";

class MyAppointmentsDto extends createZodDto(MyAppointmentsSchema) {}

/** The signed-in customer's appointments. */
@Controller("me/appointments")
export class MyAppointmentsController {
  constructor(private readonly appointments: MyAppointmentsService) {}

  @CustomerAuth()
  @Get()
  @ApiOkResponse({ type: MyAppointmentsDto })
  list(@Principal() p: AccessClaims): Promise<MyAppointments> {
    return this.appointments.list(p);
  }
}
