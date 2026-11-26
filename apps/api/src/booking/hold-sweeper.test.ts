import { Logger } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuditService } from "../audit/audit.service.js";
import type { PrismaService } from "../prisma/prisma.service.js";
import { HoldSweeper } from "./hold-sweeper.js";

describe("HoldSweeper.sweep", () => {
  afterEach(() => vi.restoreAllMocks());

  it("logs a failing organization with its stack, keeps sweeping the others and counts only successes", async () => {
    const failure = new Error("deadlock detected");
    const transaction = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(3);
    const prisma = {
      appointment: { findMany: vi.fn().mockResolvedValue([{ organizationId: "org-a" }, { organizationId: "org-b" }]) },
      $transaction: transaction,
    } as unknown as PrismaService;
    const logged = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const sweeper = new HoldSweeper(prisma, {} as AuditService, { now: () => 0 });

    expect(await sweeper.sweep()).toBe(3);
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("org-a"), failure.stack);
  });
});
