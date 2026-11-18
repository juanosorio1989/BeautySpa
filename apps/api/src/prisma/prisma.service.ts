import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

/**
 * Prisma client as a Nest provider. It connects lazily on the first query
 * (no `$connect` at startup), so modules and tests that never touch the
 * database do not need one. Reads DATABASE_URL.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
