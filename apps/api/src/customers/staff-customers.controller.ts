import { Body, Controller, Get, Post, Query, Req } from "@nestjs/common";
import { ApiCreatedResponse, ApiOkResponse } from "@nestjs/swagger";
import type { Request } from "express";
import { createZodDto } from "nestjs-zod";
import {
  CustomerSearchQuerySchema,
  StaffCustomerCreateSchema,
  StaffCustomerSchema,
  type AccessClaims,
  type StaffCustomer,
} from "@beautyspa/contracts";
import { Principal, StaffAuth } from "../auth/decorators.js";
import { requestMeta } from "../auth/request-meta.js";
import { StaffCustomersService } from "./staff-customers.service.js";

class StaffCustomerDto extends createZodDto(StaffCustomerSchema) {}
class StaffCustomerCreateDto extends createZodDto(StaffCustomerCreateSchema) {}
class CustomerSearchQueryDto extends createZodDto(CustomerSearchQuerySchema) {}

/** Staff customer search and creation. */
@Controller("staff/customers")
export class StaffCustomersController {
  constructor(private readonly customers: StaffCustomersService) {}

  /** Any staff role; an EMPLOYEE only sees customers they served (service). */
  @StaffAuth()
  @Get()
  @ApiOkResponse({ type: [StaffCustomerDto] })
  search(@Principal() p: AccessClaims, @Query() query: CustomerSearchQueryDto): Promise<StaffCustomer[]> {
    return this.customers.search(p, query.q);
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
