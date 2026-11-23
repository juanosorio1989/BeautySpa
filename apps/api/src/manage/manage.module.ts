import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { BookingModule } from "../booking/booking.module.js";
import { MessageContextService } from "../notifications/message-context.service.js";
import { ManageController } from "./manage.controller.js";
import { ManageService } from "./manage.service.js";

/** Public manage-link endpoints (`/manage/:token`). `MessageContextService` builds the `.ics` as the worker does. */
@Module({
  imports: [AuditModule, BookingModule],
  controllers: [ManageController],
  providers: [ManageService, MessageContextService],
})
export class ManageModule {}
