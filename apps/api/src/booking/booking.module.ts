import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { AppointmentWriter } from "./appointment-writer.js";
import { AvailabilityController } from "./availability.controller.js";
import { AvailabilityService } from "./availability.service.js";
import { BookingContextService } from "./booking-context.service.js";
import { HoldSweeper } from "./hold-sweeper.js";
import { HoldsController } from "./holds.controller.js";
import { HoldsService } from "./holds.service.js";

@Module({
  imports: [AuditModule],
  controllers: [AvailabilityController, HoldsController],
  providers: [BookingContextService, AvailabilityService, AppointmentWriter, HoldsService, HoldSweeper],
  exports: [BookingContextService, AppointmentWriter],
})
export class BookingModule {}
