import { Inject, Injectable, Logger } from "@nestjs/common";
import { AuditService } from "../audit/audit.service.js";
import { CLOCK, type Clock } from "../common/clock.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { BOOKING_TX_OPTIONS, lockOrgBookings, releaseExpiredHoldsAudited } from "./appointment-writer.js";

/**
 * Releases expired holds. No timer of its own: the worker's repeatable `sweep-holds` job on queue
 * `maintenance` (`worker/maintenance.processor.ts`) calls `sweep()` every `HOLD_SWEEP_INTERVAL_MS`.
 */
@Injectable()
export class HoldSweeper {
  private readonly logger = new Logger(HoldSweeper.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * One run: per organization with expired holds, takes the org booking lock, releases them and writes one
   * `appointment.hold_release` audit row (`after: { released }`) in the same transaction. An org whose
   * transaction fails is logged (with stack) and skipped; the others still run. Returns the total released
   * by the orgs that succeeded.
   */
  async sweep(): Promise<number> {
    const orgs = await this.prisma.appointment.findMany({
      where: { status: "HELD", holdExpiresAt: { lte: new Date(this.clock.now()) } },
      distinct: ["organizationId"],
      select: { organizationId: true },
    });
    let total = 0;
    for (const { organizationId } of orgs) {
      try {
        total += await this.prisma.$transaction(async (tx) => {
          await lockOrgBookings(tx, organizationId);
          // Read after the lock so `now` never predates the wait.
          const now = new Date(this.clock.now());
          return releaseExpiredHoldsAudited(tx, this.audit, organizationId, now);
        }, BOOKING_TX_OPTIONS);
      } catch (err) {
        this.logger.error(
          `Hold sweep failed for organization ${organizationId}: ${(err as Error).message}`,
          (err as Error).stack,
        );
      }
    }
    return total;
  }
}
