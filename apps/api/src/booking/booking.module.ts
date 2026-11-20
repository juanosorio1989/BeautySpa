import { Module } from "@nestjs/common";
import { AvailabilityController } from "./availability.controller.js";
import { AvailabilityService } from "./availability.service.js";
import { BookingContextService } from "./booking-context.service.js";

@Module({
  controllers: [AvailabilityController],
  providers: [BookingContextService, AvailabilityService],
  exports: [BookingContextService],
})
export class BookingModule {}
