import { Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { ENV, type Env } from "../config/env.js";
import { MAINTENANCE_QUEUE, NOTIFICATIONS_QUEUE } from "./queue-names.js";

/** BullMQ producer for queue `notifications`. */
export const NOTIFICATIONS_QUEUE_TOKEN = Symbol("NOTIFICATIONS_QUEUE");
/** BullMQ producer for queue `maintenance`. */
export const MAINTENANCE_QUEUE_TOKEN = Symbol("MAINTENANCE_QUEUE");
/** Dedicated ioredis connection shared by the producers (BullMQ requires `maxRetriesPerRequest: null`). */
export const QUEUE_CONNECTION = Symbol("QUEUE_CONNECTION");

/**
 * Producers only (`Queue`, never `Worker`): the API and the worker both import it; only the worker
 * module consumes. Same Redis DB as `REDIS_URL`, so tests' `flushdb` clears the queues too.
 */
@Global()
@Module({
  providers: [
    {
      provide: QUEUE_CONNECTION,
      inject: [ENV],
      useFactory: (env: Env) => new Redis(env.REDIS_URL, { maxRetriesPerRequest: null }),
    },
    {
      provide: NOTIFICATIONS_QUEUE_TOKEN,
      inject: [QUEUE_CONNECTION],
      useFactory: (connection: Redis) => new Queue(NOTIFICATIONS_QUEUE, { connection }),
    },
    {
      provide: MAINTENANCE_QUEUE_TOKEN,
      inject: [QUEUE_CONNECTION],
      useFactory: (connection: Redis) => new Queue(MAINTENANCE_QUEUE, { connection }),
    },
  ],
  exports: [NOTIFICATIONS_QUEUE_TOKEN, MAINTENANCE_QUEUE_TOKEN],
})
export class QueueModule implements OnApplicationShutdown {
  constructor(
    @Inject(NOTIFICATIONS_QUEUE_TOKEN) private readonly notifications: Queue,
    @Inject(MAINTENANCE_QUEUE_TOKEN) private readonly maintenance: Queue,
    @Inject(QUEUE_CONNECTION) private readonly connection: Redis,
  ) {}

  /** Closes the producers, then the shared connection (a `Queue` never closes a connection it was given). */
  async onApplicationShutdown(): Promise<void> {
    await Promise.all([this.notifications.close(), this.maintenance.close()]);
    await this.connection.quit();
  }
}
