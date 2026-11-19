import { Body, Controller, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { ApiCreatedResponse, ApiOkResponse, ApiQuery } from "@nestjs/swagger";
import type { Request } from "express";
import { ZodValidationPipe, createZodDto } from "nestjs-zod";
import {
  IdSchema,
  ResourceInputSchema,
  ResourceSchema,
  ResourceUpdateSchema,
  type AccessClaims,
  type Resource,
} from "@beautyspa/contracts";
import { Principal, StaffAuth } from "../auth/decorators.js";
import { requestMeta } from "../auth/request-meta.js";
import { ResourcesService } from "./resources.service.js";

const IdPipe = new ZodValidationPipe(IdSchema);
const OptionalIdPipe = new ZodValidationPipe(IdSchema.optional());

class ResourceInputDto extends createZodDto(ResourceInputSchema) {}
class ResourceUpdateDto extends createZodDto(ResourceUpdateSchema) {}
class ResourceDto extends createZodDto(ResourceSchema) {}

/** Resources are deactivated (`active: false`), never deleted: there is no DELETE route. */
@Controller("staff/resources")
export class ResourcesController {
  constructor(private readonly resources: ResourcesService) {}

  @StaffAuth("OWNER")
  @Get()
  @ApiQuery({ name: "locationId", required: false })
  @ApiOkResponse({ type: [ResourceDto] })
  list(@Principal() p: AccessClaims, @Query("locationId", OptionalIdPipe) locationId?: string): Promise<Resource[]> {
    return this.resources.list(p.org, locationId);
  }

  @StaffAuth("OWNER")
  @Post()
  @ApiCreatedResponse({ type: ResourceDto })
  create(@Principal() p: AccessClaims, @Body() body: ResourceInputDto, @Req() req: Request): Promise<Resource> {
    return this.resources.create(p, body, requestMeta(req).ip);
  }

  @StaffAuth("OWNER")
  @Get(":id")
  @ApiOkResponse({ type: ResourceDto })
  get(@Principal() p: AccessClaims, @Param("id", IdPipe) id: string): Promise<Resource> {
    return this.resources.get(p.org, id);
  }

  @StaffAuth("OWNER")
  @Patch(":id")
  @ApiOkResponse({ type: ResourceDto })
  update(
    @Principal() p: AccessClaims,
    @Param("id", IdPipe) id: string,
    @Body() body: ResourceUpdateDto,
    @Req() req: Request,
  ): Promise<Resource> {
    return this.resources.update(p, id, body, requestMeta(req).ip);
  }
}
