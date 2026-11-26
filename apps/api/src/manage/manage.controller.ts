import { Body, Controller, Get, HttpCode, Param, Post, Req, Res } from "@nestjs/common";
import { ApiOkResponse, ApiProduces } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { createZodDto } from "nestjs-zod";
import { ManageCancelInputSchema, ManageViewSchema, type ManageView } from "@beautyspa/contracts";
import { Public } from "../auth/decorators.js";
import { requestMeta } from "../auth/request-meta.js";
import { RateLimitService } from "../rate-limit/rate-limit.service.js";
import { ManageService } from "./manage.service.js";

class ManageViewDto extends createZodDto(ManageViewSchema) {}
class ManageCancelInputDto extends createZodDto(ManageCancelInputSchema) {}

/** 30 requests per IP per minute across every manage route, invalid tokens included. */
const PER_IP = { limit: 30, windowSec: 60 };

/**
 * The manage link from email and push: no login, the signed token is the capability. Every response
 * (errors included) is `Cache-Control: no-store` and `Referrer-Policy: no-referrer`; every invalid link is the
 * same 404.
 */
@Controller("manage")
export class ManageController {
  constructor(
    private readonly manage: ManageService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Public()
  @Get(":token")
  @ApiOkResponse({ type: ManageViewDto })
  async view(
    @Param("token") token: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ManageView> {
    await this.guard(req, res);
    return this.manage.view(token);
  }

  @Public()
  @Post(":token/confirm")
  @HttpCode(200)
  @ApiOkResponse({ type: ManageViewDto })
  async confirm(
    @Param("token") token: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ManageView> {
    await this.guard(req, res);
    return this.manage.confirm(token, requestMeta(req).ip);
  }

  @Public()
  @Post(":token/cancel")
  @HttpCode(200)
  @ApiOkResponse({ type: ManageViewDto })
  async cancel(
    @Param("token") token: string,
    @Body() body: ManageCancelInputDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ManageView> {
    await this.guard(req, res);
    return this.manage.cancel(token, body, requestMeta(req).ip);
  }

  @Public()
  @Get(":token/calendar.ics")
  @ApiProduces("text/calendar")
  @ApiOkResponse({ description: "The appointment as an iCalendar file (METHOD:PUBLISH)" })
  async calendar(
    @Param("token") token: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    await this.guard(req, res);
    const ics = await this.manage.calendar(token);
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="appointment.ics"');
    return ics;
  }

  /** Sets the privacy headers first (so 404/409/429 carry them too), then counts the request against the IP. */
  private async guard(req: Request, res: Response): Promise<void> {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    const ip = requestMeta(req).ip ?? "unknown";
    await this.rateLimit.enforce(`manage:ip:${this.rateLimit.hashKeyPart(ip)}`, PER_IP.limit, PER_IP.windowSec);
  }
}
