import { Body, Controller, Delete, Get, HttpCode, Patch, Req } from "@nestjs/common";
import { ApiNoContentResponse, ApiOkResponse } from "@nestjs/swagger";
import type { Request } from "express";
import { createZodDto } from "nestjs-zod";
import {
  CustomerExportSchema,
  MePatchSchema,
  MeSchema,
  type AccessClaims,
  type CustomerExport,
  type Me,
} from "@beautyspa/contracts";
import { CustomerAuth, Principal } from "../auth/decorators.js";
import { requestMeta } from "../auth/request-meta.js";
import { MeService } from "./me.service.js";

class MeDto extends createZodDto(MeSchema) {}
class MePatchDto extends createZodDto(MePatchSchema) {}
class CustomerExportDto extends createZodDto(CustomerExportSchema) {}

/** The signed-in customer's profile, data export and account deletion. */
@Controller("me")
export class MeController {
  constructor(private readonly me: MeService) {}

  @CustomerAuth()
  @Get()
  @ApiOkResponse({ type: MeDto })
  get(@Principal() p: AccessClaims): Promise<Me> {
    return this.me.get(p);
  }

  @CustomerAuth()
  @Patch()
  @ApiOkResponse({ type: MeDto })
  patch(@Principal() p: AccessClaims, @Body() body: MePatchDto, @Req() req: Request): Promise<Me> {
    return this.me.patch(p, body, requestMeta(req).ip);
  }

  @CustomerAuth()
  @Get("export")
  @ApiOkResponse({ type: CustomerExportDto })
  export(@Principal() p: AccessClaims): Promise<CustomerExport> {
    return this.me.export(p);
  }

  @CustomerAuth()
  @Delete()
  @HttpCode(204)
  @ApiNoContentResponse()
  async remove(@Principal() p: AccessClaims, @Req() req: Request): Promise<void> {
    await this.me.remove(p, requestMeta(req).ip);
  }
}
