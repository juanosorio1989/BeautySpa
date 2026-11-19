import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from "@nestjs/common";
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse } from "@nestjs/swagger";
import type { Request } from "express";
import { ZodValidationPipe, createZodDto } from "nestjs-zod";
import {
  IdSchema,
  CategoryInputSchema,
  CategoryUpdateSchema,
  CategorySchema,
  type AccessClaims,
  type Category,
} from "@beautyspa/contracts";
import { Principal, StaffAuth } from "../auth/decorators.js";
import { requestMeta } from "../auth/request-meta.js";
import { CategoriesService } from "./categories.service.js";

const IdPipe = new ZodValidationPipe(IdSchema);

class CategoryInputDto extends createZodDto(CategoryInputSchema) {}
class CategoryUpdateDto extends createZodDto(CategoryUpdateSchema) {}
class CategoryDto extends createZodDto(CategorySchema) {}

@Controller("staff/categories")
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @StaffAuth("OWNER")
  @Get()
  @ApiOkResponse({ type: [CategoryDto] })
  list(@Principal() p: AccessClaims): Promise<Category[]> {
    return this.categories.list(p.org);
  }

  @StaffAuth("OWNER")
  @Post()
  @ApiCreatedResponse({ type: CategoryDto })
  create(@Principal() p: AccessClaims, @Body() body: CategoryInputDto, @Req() req: Request): Promise<Category> {
    return this.categories.create(p, body, requestMeta(req).ip);
  }

  @StaffAuth("OWNER")
  @Get(":id")
  @ApiOkResponse({ type: CategoryDto })
  get(@Principal() p: AccessClaims, @Param("id", IdPipe) id: string): Promise<Category> {
    return this.categories.get(p.org, id);
  }

  @StaffAuth("OWNER")
  @Patch(":id")
  @ApiOkResponse({ type: CategoryDto })
  update(
    @Principal() p: AccessClaims,
    @Param("id", IdPipe) id: string,
    @Body() body: CategoryUpdateDto,
    @Req() req: Request,
  ): Promise<Category> {
    return this.categories.update(p, id, body, requestMeta(req).ip);
  }

  @StaffAuth("OWNER")
  @Delete(":id")
  @HttpCode(204)
  @ApiNoContentResponse()
  remove(@Principal() p: AccessClaims, @Param("id", IdPipe) id: string, @Req() req: Request): Promise<void> {
    return this.categories.remove(p, id, requestMeta(req).ip);
  }
}
