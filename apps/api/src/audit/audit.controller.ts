import { Controller, Get, Query } from "@nestjs/common";
import { ApiOkResponse } from "@nestjs/swagger";
import { createZodDto } from "nestjs-zod";
import { AuditPageSchema, AuditQuerySchema, type AccessClaims, type AuditPage } from "@beautyspa/contracts";
import { Principal, StaffAuth } from "../auth/decorators.js";
import { AuditQueryService } from "./audit-query.service.js";

class AuditQueryDto extends createZodDto(AuditQuerySchema) {}
class AuditPageDto extends createZodDto(AuditPageSchema) {}

@Controller("staff/audit")
export class AuditController {
  constructor(private readonly audits: AuditQueryService) {}

  @StaffAuth("OWNER")
  @Get()
  @ApiOkResponse({ type: AuditPageDto })
  list(@Principal() p: AccessClaims, @Query() query: AuditQueryDto): Promise<AuditPage> {
    return this.audits.page(p.org, query);
  }
}
