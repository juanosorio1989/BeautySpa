/**
 * `pnpm --filter @beautyspa/api secrets:gen`: fills missing secrets in the
 * repo-root `.env` (copied from `.env.example` when absent). Prints only key
 * names, never values.
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { addMissingSecrets, defaultGenerators } from "./secrets.js";

const root = resolve(__dirname, "../../..");
const envPath = resolve(root, ".env");

if (!existsSync(envPath)) copyFileSync(resolve(root, ".env.example"), envPath);

const { text, added } = addMissingSecrets(readFileSync(envPath, "utf8"), defaultGenerators());
if (added.length > 0) {
  writeFileSync(envPath, text);
  console.log(`Added: ${added.join(", ")}`);
} else {
  console.log("Nothing to add");
}
