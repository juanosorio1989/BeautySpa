import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

/**
 * Vitest globalSetup: applies every pending migration (including the raw-SQL
 * booking constraints) to the test database once per run. Tests then truncate
 * all tables before each case (see helpers.ts).
 *
 * `prisma migrate deploy` is used instead of `prisma migrate reset`: it never
 * drops data, and Prisma refuses `migrate reset` when run by an AI agent
 * without explicit user consent. If a migration was edited locally, reset the
 * test database by hand: `DATABASE_URL=$DATABASE_URL_TEST pnpm exec prisma migrate reset`.
 */
export default function setup(): void {
  const url = testDatabaseUrl();
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    cwd: resolve(__dirname, "../.."),
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
  });
}

/** DATABASE_URL_TEST, refusing anything whose database name does not contain "test". */
export function testDatabaseUrl(): string {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error("DATABASE_URL_TEST is required for integration tests");
  const dbName = new URL(url).pathname.replace(/^\//, "");
  if (!dbName.includes("test")) {
    throw new Error(`Refusing to reset database "${dbName}": name must contain "test"`);
  }
  return url;
}
