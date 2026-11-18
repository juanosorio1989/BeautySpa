import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuditModule } from "../audit/audit.module.js";
import { AccessGuard } from "./access.guard.js";
import { RefreshTokenService } from "./refresh-token.service.js";
import { SessionController } from "./session.controller.js";
import { SessionService } from "./session.service.js";
import { TokenService } from "./token.service.js";

@Module({
  imports: [AuditModule],
  controllers: [SessionController],
  providers: [TokenService, RefreshTokenService, SessionService, { provide: APP_GUARD, useClass: AccessGuard }],
  exports: [TokenService, RefreshTokenService, SessionService],
})
export class AuthModule {}
