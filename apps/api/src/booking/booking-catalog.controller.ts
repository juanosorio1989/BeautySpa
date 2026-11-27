import { Controller, Get, Query } from "@nestjs/common";
import { ApiOkResponse, ApiQuery } from "@nestjs/swagger";
import { ZodValidationPipe, createZodDto } from "nestjs-zod";
import { BookingCatalogSchema, IdSchema, type AccessClaims, type BookingCatalog } from "@beautyspa/contracts";
import { Principal, StaffAuth } from "../auth/decorators.js";
import { BookingCatalogService } from "./booking-catalog.service.js";

const OptionalIdPipe = new ZodValidationPipe(IdSchema.optional());

class BookingCatalogDto extends createZodDto(BookingCatalogSchema) {}

/** Quick-booking catalog (OWNER, RECEPTION). */
@Controller("staff/booking-catalog")
export class BookingCatalogController {
  constructor(private readonly catalog: BookingCatalogService) {}

  @StaffAuth("OWNER", "RECEPTION")
  @Get()
  @ApiQuery({ name: "locationId", required: false })
  @ApiOkResponse({ type: BookingCatalogDto })
  get(@Principal() p: AccessClaims, @Query("locationId", OptionalIdPipe) locationId?: string): Promise<BookingCatalog> {
    return this.catalog.get(p, locationId);
  }
}
