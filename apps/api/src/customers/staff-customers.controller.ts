import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { ApiCreatedResponse, ApiOkResponse } from "@nestjs/swagger";
import type { Request } from "express";
import { createZodDto } from "nestjs-zod";
import {
  CustomerSearchQuerySchema,
  StaffCustomerAppointmentsSchema,
  StaffCustomerCreateSchema,
  StaffCustomerSchema,
  StaffCustomerSearchResultSchema,
  type AccessClaims,
  type StaffCustomer,
  type StaffCustomerAppointments,
  type StaffCustomerSearchResult,
} from "@beautyspa/contracts";
import { Principal, StaffAuth } from "../auth/decorators.js";
import { IdPipe } from "../common/id-pipe.js";
import { requestMeta } from "../auth/request-meta.js";
import { StaffCustomersService } from "./staff-customers.service.js";

class StaffCustomerDto extends createZodDto(StaffCustomerSchema) {}
class StaffCustomerSearchResultDto extends createZodDto(StaffCustomerSearchResultSchema) {}
class StaffCustomerAppointmentsDto extends createZodDto(StaffCustomerAppointmentsSchema) {}
class StaffCustomerCreateDto extends createZodDto(StaffCustomerCreateSchema) {}
class CustomerSearchQueryDto extends createZodDto(CustomerSearchQuerySchema) {}

/** Staff customer search and creation. */
@Controller("staff/customers")
export class StaffCustomersController {
  constructor(private readonly customers: StaffCustomersService) {}

  /** Any staff role; an EMPLOYEE only sees customers they served (service). */
  @StaffAuth()
  @Get()
  @ApiOkResponse({ type: [StaffCustomerSearchResultDto] })
  search(@Principal() p: AccessClaims, @Query() query: CustomerSearchQueryDto): Promise<StaffCustomerSearchResult[]> {
    return this.customers.search(p, query.q);
  }

  @StaffAuth("OWNER", "RECEPTION")
  @Get(":id")
  @ApiOkResponse({ type: StaffCustomerDto })
  get(@Principal() p: AccessClaims, @Param("id", IdPipe) id: string): Promise<StaffCustomer> {
    return this.customers.get(p, id);
  }

  /** `upcoming` ascending, `past` newest first, at most 20. */
  @StaffAuth("OWNER", "RECEPTION")
  @Get(":id/appointments")
  @ApiOkResponse({ type: StaffCustomerAppointmentsDto })
  appointments(@Principal() p: AccessClaims, @Param("id", IdPipe) id: string): Promise<StaffCustomerAppointments> {
    return this.customers.appointments(p, id);
  }

  @StaffAuth("OWNER", "RECEPTION")
  @Post()
  @ApiCreatedResponse({ type: StaffCustomerDto })
  create(
    @Principal() p: AccessClaims,
    @Body() body: StaffCustomerCreateDto,
    @Req() req: Request,
  ): Promise<StaffCustomer> {
    return this.customers.create(p, body, requestMeta(req).ip);
  }
}
