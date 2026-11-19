import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { EmployeesController } from "./employees.controller.js";
import { EmployeesService } from "./employees.service.js";
import { TimeOffController } from "./time-off.controller.js";
import { TimeOffService } from "./time-off.service.js";
import { WorkingHoursController } from "./working-hours.controller.js";
import { WorkingHoursService } from "./working-hours.service.js";

@Module({
  imports: [AuditModule, AuthModule],
  controllers: [EmployeesController, WorkingHoursController, TimeOffController],
  providers: [EmployeesService, WorkingHoursService, TimeOffService],
  exports: [EmployeesService],
})
export class StaffModule {}
