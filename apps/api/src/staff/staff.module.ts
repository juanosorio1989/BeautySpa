import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { EmployeesController } from "./employees.controller.js";
import { EmployeesService } from "./employees.service.js";

@Module({
  imports: [AuditModule, AuthModule],
  controllers: [EmployeesController],
  providers: [EmployeesService],
  exports: [EmployeesService],
})
export class StaffModule {}
