import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module.js";
import { HealthModule } from "./health/health.module.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { RateLimitModule } from "./rate-limit/rate-limit.module.js";
import { RedisModule } from "./redis/redis.module.js";
import { TenancyModule } from "./tenancy/tenancy.module.js";

@Module({ imports: [ConfigModule, PrismaModule, RedisModule, RateLimitModule, TenancyModule, HealthModule] })
export class AppModule {}
