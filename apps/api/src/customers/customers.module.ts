import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { StaffCustomersController } from "./staff-customers.controller.js";
import { StaffCustomersService } from "./staff-customers.service.js";

@Module({
  imports: [AuditModule],
  controllers: [StaffCustomersController],
  providers: [StaffCustomersService],
})
export class CustomersModule {}
