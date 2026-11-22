import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { WorkerModule } from "./worker/worker.module.js";

/** Worker process: BullMQ consumers (maintenance; notifications from Task 6), no HTTP server. */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
}

main().catch((err: unknown) => {
  const e = err instanceof Error ? err : new Error(String(err));
  new Logger("Worker").error(`Worker failed to start: ${e.message}`, e.stack);
  process.exit(1);
});
