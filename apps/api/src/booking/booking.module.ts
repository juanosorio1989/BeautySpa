import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { AppointmentWriter } from "./appointment-writer.js";
import { AppointmentsController } from "./appointments.controller.js";
import { AppointmentsService } from "./appointments.service.js";
import { AvailabilityController } from "./availability.controller.js";
import { AvailabilityService } from "./availability.service.js";
import { BookingContextService } from "./booking-context.service.js";
import { BookingEvents, LoggingBookingEvents } from "./booking-events.js";
import { HoldSweeper } from "./hold-sweeper.js";
import { HoldsController } from "./holds.controller.js";
import { HoldsService } from "./holds.service.js";
import { MyAppointmentsController } from "./my-appointments.controller.js";
import { MyAppointmentsService } from "./my-appointments.service.js";

@Module({
  imports: [AuditModule],
  controllers: [AvailabilityController, HoldsController, AppointmentsController, MyAppointmentsController],
  providers: [
    BookingContextService,
    AvailabilityService,
    AppointmentWriter,
    HoldsService,
    HoldSweeper,
    AppointmentsService,
    MyAppointmentsService,
    { provide: BookingEvents, useClass: LoggingBookingEvents },
  ],
  exports: [BookingContextService, AppointmentWriter],
})
export class BookingModule {}
