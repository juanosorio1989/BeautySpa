import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { CategoriesController } from "./categories.controller.js";
import { CategoriesService } from "./categories.service.js";
import { LevelsController } from "./levels.controller.js";
import { LevelsService } from "./levels.service.js";
import { ResourceTypesController } from "./resource-types.controller.js";
import { ResourceTypesService } from "./resource-types.service.js";
import { ResourcesController } from "./resources.controller.js";
import { ResourcesService } from "./resources.service.js";

@Module({
  imports: [AuditModule],
  controllers: [CategoriesController, LevelsController, ResourceTypesController, ResourcesController],
  providers: [CategoriesService, LevelsService, ResourceTypesService, ResourcesService],
  exports: [CategoriesService, LevelsService, ResourceTypesService, ResourcesService],
})
export class CatalogModule {}
