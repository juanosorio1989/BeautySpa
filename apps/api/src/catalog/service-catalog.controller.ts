import { Body, Controller, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { ApiCreatedResponse, ApiOkResponse, ApiQuery } from "@nestjs/swagger";
import type { Request } from "express";
import { ZodValidationPipe, createZodDto } from "nestjs-zod";
import { z } from "zod";
import {
  IdSchema,
  ServiceInputSchema,
  ServiceSchema,
  ServiceUpdateSchema,
  type AccessClaims,
  type Service,
} from "@beautyspa/contracts";
import { Principal, StaffAuth } from "../auth/decorators.js";
import { requestMeta } from "../auth/request-meta.js";
import { IdPipe } from "../common/id-pipe.js";
import { ServiceCatalogService } from "./service-catalog.service.js";

const OptionalIdPipe = new ZodValidationPipe(IdSchema.optional());
const ActivePipe = new ZodValidationPipe(z.enum(["true", "false"]).optional());

class ServiceInputDto extends createZodDto(ServiceInputSchema) {}
class ServiceUpdateDto extends createZodDto(ServiceUpdateSchema) {}
class ServiceDto extends createZodDto(ServiceSchema) {}

/** Services are deactivated (`active: false`), never deleted: there is no DELETE route. */
@Controller("staff/services")
export class ServiceCatalogController {
  constructor(private readonly services: ServiceCatalogService) {}

  @StaffAuth("OWNER")
  @Get()
  @ApiQuery({ name: "active", required: false, enum: ["true", "false"] })
  @ApiQuery({ name: "categoryId", required: false })
  @ApiOkResponse({ type: [ServiceDto] })
  list(
    @Principal() p: AccessClaims,
    @Query("active", ActivePipe) active?: "true" | "false",
    @Query("categoryId", OptionalIdPipe) categoryId?: string,
  ): Promise<Service[]> {
    return this.services.list(p.org, {
      ...(active !== undefined ? { active: active === "true" } : {}),
      ...(categoryId !== undefined ? { categoryId } : {}),
    });
  }

  @StaffAuth("OWNER")
  @Post()
  @ApiCreatedResponse({ type: ServiceDto })
  create(@Principal() p: AccessClaims, @Body() body: ServiceInputDto, @Req() req: Request): Promise<Service> {
    return this.services.create(p, body, requestMeta(req).ip);
  }

  @StaffAuth("OWNER")
  @Get(":id")
  @ApiOkResponse({ type: ServiceDto })
  get(@Principal() p: AccessClaims, @Param("id", IdPipe) id: string): Promise<Service> {
    return this.services.get(p.org, id);
  }

  @StaffAuth("OWNER")
  @Patch(":id")
  @ApiOkResponse({ type: ServiceDto })
  update(
    @Principal() p: AccessClaims,
    @Param("id", IdPipe) id: string,
    @Body() body: ServiceUpdateDto,
    @Req() req: Request,
  ): Promise<Service> {
    return this.services.update(p, id, body, requestMeta(req).ip);
  }
}
