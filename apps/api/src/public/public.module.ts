import { Module } from "@nestjs/common";
import { PublicCatalogService } from "./public-catalog.service.js";
import { PublicController } from "./public.controller.js";

@Module({ controllers: [PublicController], providers: [PublicCatalogService], exports: [PublicCatalogService] })
export class PublicModule {}
