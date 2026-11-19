import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { ClosuresController } from "./closures.controller.js";
import { ClosuresService } from "./closures.service.js";
import { SettingsController } from "./settings.controller.js";
import { SettingsService } from "./settings.service.js";

@Module({
  imports: [AuditModule],
  controllers: [SettingsController, ClosuresController],
  providers: [SettingsService, ClosuresService],
  exports: [SettingsService],
})
export class LocationsModule {}
