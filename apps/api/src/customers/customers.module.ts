import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { BookingModule } from "../booking/booking.module.js";
import { MeController } from "./me.controller.js";
import { MeService } from "./me.service.js";
import { StaffCustomersController } from "./staff-customers.controller.js";
import { StaffCustomersService } from "./staff-customers.service.js";

@Module({
  imports: [AuditModule, AuthModule, BookingModule],
  controllers: [StaffCustomersController, MeController],
  providers: [StaffCustomersService, MeService],
})
export class CustomersModule {}
