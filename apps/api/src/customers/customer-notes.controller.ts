import { Body, Controller, Get, Param, Put, Req } from "@nestjs/common";
import { ApiOkResponse } from "@nestjs/swagger";
import type { Request } from "express";
import { createZodDto } from "nestjs-zod";
import {
  CustomerNotesInputSchema,
  CustomerNotesSchema,
  type AccessClaims,
  type CustomerNotes,
} from "@beautyspa/contracts";
import { Principal, StaffAuth } from "../auth/decorators.js";
import { requestMeta } from "../auth/request-meta.js";
import { IdPipe } from "../common/id-pipe.js";
import { CustomerNotesService } from "./customer-notes.service.js";

class CustomerNotesDto extends createZodDto(CustomerNotesSchema) {}
class CustomerNotesInputDto extends createZodDto(CustomerNotesInputSchema) {}

/** Staff-only private notes on a customer (OWNER, RECEPTION). Another org's or a deleted customer is 404. */
@Controller("staff/customers")
export class CustomerNotesController {
  constructor(private readonly notes: CustomerNotesService) {}

  @StaffAuth("OWNER", "RECEPTION")
  @Get(":id/notes")
  @ApiOkResponse({ type: CustomerNotesDto })
  get(@Principal() p: AccessClaims, @Param("id", IdPipe) id: string): Promise<CustomerNotes> {
    return this.notes.get(p, id);
  }

  /** Trimmed, at most 2,000 characters; blank or null clears the notes. */
  @StaffAuth("OWNER", "RECEPTION")
  @Put(":id/notes")
  @ApiOkResponse({ type: CustomerNotesDto })
  put(
    @Principal() p: AccessClaims,
    @Param("id", IdPipe) id: string,
    @Body() body: CustomerNotesInputDto,
    @Req() req: Request,
  ): Promise<CustomerNotes> {
    return this.notes.put(p, id, body, requestMeta(req).ip);
  }
}
