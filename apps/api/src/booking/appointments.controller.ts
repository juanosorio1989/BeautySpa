import { Body, Controller, Post, Req } from "@nestjs/common";
import { ApiCreatedResponse } from "@nestjs/swagger";
import type { Request } from "express";
import { createZodDto } from "nestjs-zod";
import { AppointmentSchema, BookInputSchema, type AccessClaims, type Appointment } from "@beautyspa/contracts";
import { CustomerAuth, Principal } from "../auth/decorators.js";
import { requestMeta } from "../auth/request-meta.js";
import { AppointmentsService } from "./appointments.service.js";

class BookInputDto extends createZodDto(BookInputSchema) {}
class AppointmentDto extends createZodDto(AppointmentSchema) {}

/** Confirms a hold as a booking (10 per customer per hour). */
@Controller("appointments")
export class AppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  @CustomerAuth()
  @Post()
  @ApiCreatedResponse({ type: AppointmentDto })
  book(@Principal() p: AccessClaims, @Body() body: BookInputDto, @Req() req: Request): Promise<Appointment> {
    return this.appointments.book(p, body, requestMeta(req).ip);
  }
}
