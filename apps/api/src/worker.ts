import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { WorkerModule } from "./worker/worker.module.js";

/** Worker process: BullMQ consumers (maintenance; notifications from Task 6), no HTTP server. */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
}

void main();
