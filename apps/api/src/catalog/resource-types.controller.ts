import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from "@nestjs/common";
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse } from "@nestjs/swagger";
import type { Request } from "express";
import { createZodDto } from "nestjs-zod";
import {
  ResourceTypeInputSchema,
  ResourceTypeUpdateSchema,
  ResourceTypeSchema,
  type AccessClaims,
  type ResourceType,
} from "@beautyspa/contracts";
import { Principal, StaffAuth } from "../auth/decorators.js";
import { IdPipe } from "../common/id-pipe.js";
import { requestMeta } from "../auth/request-meta.js";
import { ResourceTypesService } from "./resource-types.service.js";

class ResourceTypeInputDto extends createZodDto(ResourceTypeInputSchema) {}
class ResourceTypeUpdateDto extends createZodDto(ResourceTypeUpdateSchema) {}
class ResourceTypeDto extends createZodDto(ResourceTypeSchema) {}

@Controller("staff/resource-types")
export class ResourceTypesController {
  constructor(private readonly resourceTypes: ResourceTypesService) {}

  @StaffAuth("OWNER")
  @Get()
  @ApiOkResponse({ type: [ResourceTypeDto] })
  list(@Principal() p: AccessClaims): Promise<ResourceType[]> {
    return this.resourceTypes.list(p.org);
  }

  @StaffAuth("OWNER")
  @Post()
  @ApiCreatedResponse({ type: ResourceTypeDto })
  create(@Principal() p: AccessClaims, @Body() body: ResourceTypeInputDto, @Req() req: Request): Promise<ResourceType> {
    return this.resourceTypes.create(p, body, requestMeta(req).ip);
  }

  @StaffAuth("OWNER")
  @Get(":id")
  @ApiOkResponse({ type: ResourceTypeDto })
  get(@Principal() p: AccessClaims, @Param("id", IdPipe) id: string): Promise<ResourceType> {
    return this.resourceTypes.get(p.org, id);
  }

  @StaffAuth("OWNER")
  @Patch(":id")
  @ApiOkResponse({ type: ResourceTypeDto })
  update(
    @Principal() p: AccessClaims,
    @Param("id", IdPipe) id: string,
    @Body() body: ResourceTypeUpdateDto,
    @Req() req: Request,
  ): Promise<ResourceType> {
    return this.resourceTypes.update(p, id, body, requestMeta(req).ip);
  }

  @StaffAuth("OWNER")
  @Delete(":id")
  @HttpCode(204)
  @ApiNoContentResponse()
  remove(@Principal() p: AccessClaims, @Param("id", IdPipe) id: string, @Req() req: Request): Promise<void> {
    return this.resourceTypes.remove(p, id, requestMeta(req).ip);
  }
}
