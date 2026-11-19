import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { CategoriesController } from "./categories.controller.js";
import { CategoriesService } from "./categories.service.js";
import { LevelsController } from "./levels.controller.js";
import { LevelsService } from "./levels.service.js";
import { ServiceCatalogController } from "./service-catalog.controller.js";
import { ServiceCatalogService } from "./service-catalog.service.js";
import { ResourceTypesController } from "./resource-types.controller.js";
import { ResourceTypesService } from "./resource-types.service.js";
import { ResourcesController } from "./resources.controller.js";
import { ResourcesService } from "./resources.service.js";

@Module({
  imports: [AuditModule],
  controllers: [
    CategoriesController,
    LevelsController,
    ResourceTypesController,
    ResourcesController,
    ServiceCatalogController,
  ],
  providers: [CategoriesService, LevelsService, ResourceTypesService, ResourcesService, ServiceCatalogService],
  exports: [CategoriesService, LevelsService, ResourceTypesService, ResourcesService, ServiceCatalogService],
})
export class CatalogModule {}
