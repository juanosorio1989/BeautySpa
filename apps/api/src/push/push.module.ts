import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { PushController } from "./push.controller.js";
import { PushService } from "./push.service.js";

/** `GET /push/public-key` and `/me/push-subscriptions`. */
@Module({ imports: [AuditModule, AuthModule], controllers: [PushController], providers: [PushService] })
export class PushModule {}
