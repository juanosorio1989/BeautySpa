import { Body, Controller, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { ApiCreatedResponse, ApiOkResponse, ApiQuery } from "@nestjs/swagger";
import type { Request } from "express";
import { ZodValidationPipe, createZodDto } from "nestjs-zod";
import { z } from "zod";
import {
  EmployeeCreateSchema,
  EmployeeSchema,
  EmployeeUpdateSchema,
  IdSchema,
  type AccessClaims,
  type Employee,
} from "@beautyspa/contracts";
import { Principal, StaffAuth } from "../auth/decorators.js";
import { requestMeta } from "../auth/request-meta.js";
import { IdPipe } from "../common/id-pipe.js";
import { EmployeesService } from "./employees.service.js";

const OptionalIdPipe = new ZodValidationPipe(IdSchema.optional());
const ActivePipe = new ZodValidationPipe(z.enum(["true", "false"]).optional());

class EmployeeCreateDto extends createZodDto(EmployeeCreateSchema) {}
class EmployeeUpdateDto extends createZodDto(EmployeeUpdateSchema) {}
class EmployeeDto extends createZodDto(EmployeeSchema) {}

/**
 * Staff members (OWNER, RECEPTION, EMPLOYEE). Reads: OWNER, RECEPTION; writes: OWNER.
 * No DELETE route: deactivate with `active: false`. `POST /:id/invite` and
 * `/:id/reset-2fa` live in `StaffAdminController`.
 */
@Controller("staff/employees")
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @StaffAuth("OWNER", "RECEPTION")
  @Get()
  @ApiQuery({ name: "active", required: false, enum: ["true", "false"] })
  @ApiQuery({ name: "locationId", required: false })
  @ApiOkResponse({ type: [EmployeeDto] })
  list(
    @Principal() p: AccessClaims,
    @Query("active", ActivePipe) active?: "true" | "false",
    @Query("locationId", OptionalIdPipe) locationId?: string,
  ): Promise<Employee[]> {
    return this.employees.list(p.org, {
      ...(active !== undefined ? { active: active === "true" } : {}),
      ...(locationId !== undefined ? { locationId } : {}),
    });
  }

  /** 409 `CONFLICT` on a duplicate email; with `sendInvite` the invite is emailed after commit. */
  @StaffAuth("OWNER")
  @Post()
  @ApiCreatedResponse({ type: EmployeeDto })
  create(@Principal() p: AccessClaims, @Body() body: EmployeeCreateDto, @Req() req: Request): Promise<Employee> {
    return this.employees.create(p, body, requestMeta(req).ip);
  }

  @StaffAuth("OWNER", "RECEPTION")
  @Get(":id")
  @ApiOkResponse({ type: EmployeeDto })
  get(@Principal() p: AccessClaims, @Param("id", IdPipe) id: string): Promise<Employee> {
    return this.employees.get(p.org, id);
  }

  /** 403 when an OWNER changes their own `role`, `active` or `canLogin`. */
  @StaffAuth("OWNER")
  @Patch(":id")
  @ApiOkResponse({ type: EmployeeDto })
  update(
    @Principal() p: AccessClaims,
    @Param("id", IdPipe) id: string,
    @Body() body: EmployeeUpdateDto,
    @Req() req: Request,
  ): Promise<Employee> {
    return this.employees.update(p, id, body, requestMeta(req).ip);
  }
}
