import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { HoldSweeper } from "../booking/hold-sweeper.js";
import { CommonModule } from "../common/common.module.js";
import { ConfigModule } from "../config/config.module.js";
import { MailModule } from "../mail/mail.module.js";
import { ReminderScanner } from "../notifications/reminder-scanner.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { QueueModule } from "../queue/queue.module.js";
import { RedisModule } from "../redis/redis.module.js";
import { MaintenanceProcessor } from "./maintenance.processor.js";

/** Root module of the worker process (`worker.ts`): consumes the BullMQ queues; no HTTP. */
@Module({
  imports: [ConfigModule, CommonModule, PrismaModule, RedisModule, AuditModule, MailModule, QueueModule],
  providers: [HoldSweeper, ReminderScanner, MaintenanceProcessor],
})
export class WorkerModule {}
