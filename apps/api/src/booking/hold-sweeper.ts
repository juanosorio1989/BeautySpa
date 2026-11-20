import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { AuditService } from "../audit/audit.service.js";
import { CLOCK, type Clock } from "../common/clock.js";
import { ENV, type Env } from "../config/env.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { BOOKING_TX_OPTIONS, lockOrgBookings, releaseExpiredHolds } from "./appointment-writer.js";

/**
 * Releases expired holds every `HOLD_SWEEP_INTERVAL_MS` (0 disables it). In-process for now
 * (design call 12); plan 05 moves it to the BullMQ `maintenance` queue.
 */
@Injectable()
export class HoldSweeper implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(HoldSweeper.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onApplicationBootstrap(): void {
    const ms = this.env.HOLD_SWEEP_INTERVAL_MS;
    if (ms <= 0) return;
    this.timer = setInterval(() => {
      this.sweep().catch((err: unknown) =>
        this.logger.error(`Hold sweep failed: ${(err as Error).message}`, (err as Error).stack),
      );
    }, ms);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /**
   * One run: per organization with expired holds, takes the org booking lock, releases them and writes one
   * `appointment.hold_release` audit row (`after: { released }`) in the same transaction.
   * Returns the total released.
   */
  async sweep(): Promise<number> {
    const orgs = await this.prisma.appointment.findMany({
      where: { status: "HELD", holdExpiresAt: { lte: new Date(this.clock.now()) } },
      distinct: ["organizationId"],
      select: { organizationId: true },
    });
    let total = 0;
    for (const { organizationId } of orgs) {
      total += await this.prisma.$transaction(async (tx) => {
        await lockOrgBookings(tx, organizationId);
        // Read after the lock so `now` never predates the wait.
        const now = new Date(this.clock.now());
        const released = await releaseExpiredHolds(tx, organizationId, now);
        if (released > 0) {
          await this.audit.record(
            {
              orgId: organizationId,
              actorType: "SYSTEM",
              actorId: null,
              action: "appointment.hold_release",
              entity: "appointment",
              entityId: null,
              before: null,
              after: { released },
            },
            tx,
          );
        }
        return released;
      }, BOOKING_TX_OPTIONS);
    }
    return total;
  }
}
