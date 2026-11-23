import { Module } from "@nestjs/common";
import { AuditModule } from "./audit/audit.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { BookingModule } from "./booking/booking.module.js";
import { CatalogModule } from "./catalog/catalog.module.js";
import { CommonModule } from "./common/common.module.js";
import { ConfigModule } from "./config/config.module.js";
import { CustomersModule } from "./customers/customers.module.js";
import { HealthModule } from "./health/health.module.js";
import { LocationsModule } from "./locations/locations.module.js";
import { MailModule } from "./mail/mail.module.js";
import { ManageModule } from "./manage/manage.module.js";
import { PublicModule } from "./public/public.module.js";
import { PushModule } from "./push/push.module.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { QueueModule } from "./queue/queue.module.js";
import { RateLimitModule } from "./rate-limit/rate-limit.module.js";
import { RedisModule } from "./redis/redis.module.js";
import { StaffModule } from "./staff/staff.module.js";
import { TenancyModule } from "./tenancy/tenancy.module.js";

@Module({
  imports: [
    ConfigModule,
    CommonModule,
    PrismaModule,
    RedisModule,
    QueueModule,
    RateLimitModule,
    TenancyModule,
    AuditModule,
    MailModule,
    AuthModule,
    CatalogModule,
    StaffModule,
    LocationsModule,
    PublicModule,
    BookingModule,
    CustomersModule,
    PushModule,
    ManageModule,
    HealthModule,
  ],
})
export class AppModule {}
