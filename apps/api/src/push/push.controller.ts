import { Body, Controller, Delete, Get, HttpCode, Post, Req } from "@nestjs/common";
import { ApiNoContentResponse, ApiOkResponse } from "@nestjs/swagger";
import type { Request } from "express";
import { createZodDto } from "nestjs-zod";
import {
  PushPublicKeySchema,
  PushSubscriptionInputSchema,
  PushUnsubscribeInputSchema,
  type AccessClaims,
  type PushPublicKey,
} from "@beautyspa/contracts";
import { CustomerAuth, Principal, Public } from "../auth/decorators.js";
import { requestMeta } from "../auth/request-meta.js";
import { PushService } from "./push.service.js";

class PushPublicKeyDto extends createZodDto(PushPublicKeySchema) {}
class PushSubscriptionInputDto extends createZodDto(PushSubscriptionInputSchema) {}
class PushUnsubscribeInputDto extends createZodDto(PushUnsubscribeInputSchema) {}

/** Web push: the public VAPID key and the signed-in customer's device subscriptions. */
@Controller()
export class PushController {
  constructor(private readonly push: PushService) {}

  @Public()
  @Get("push/public-key")
  @ApiOkResponse({ type: PushPublicKeyDto })
  publicKey(): PushPublicKey {
    return this.push.publicKey();
  }

  @CustomerAuth()
  @Post("me/push-subscriptions")
  @HttpCode(204)
  @ApiNoContentResponse()
  async subscribe(
    @Principal() p: AccessClaims,
    @Body() body: PushSubscriptionInputDto,
    @Req() req: Request,
  ): Promise<void> {
    await this.push.subscribe(p, body, requestMeta(req).ip);
  }

  @CustomerAuth()
  @Delete("me/push-subscriptions")
  @HttpCode(204)
  @ApiNoContentResponse()
  async unsubscribe(
    @Principal() p: AccessClaims,
    @Body() body: PushUnsubscribeInputDto,
    @Req() req: Request,
  ): Promise<void> {
    await this.push.unsubscribe(p, body, requestMeta(req).ip);
  }
}
