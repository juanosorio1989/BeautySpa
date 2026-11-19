import { Global, Module } from "@nestjs/common";
import { LocationService } from "./location.service.js";
import { TenancyService } from "./tenancy.service.js";

@Global()
@Module({ providers: [TenancyService, LocationService], exports: [TenancyService, LocationService] })
export class TenancyModule {}
