/**
 * `pnpm --filter @beautyspa/api secrets:gen`: fills missing secrets in the
 * repo-root `.env` (copied from `.env.example` when absent). Prints only key
 * names, never values.
 */
import { chmodSync, copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { addMissingSecrets, defaultGenerators, SECRET_GROUPS } from "./secrets.js";

const root = resolve(__dirname, "../../..");
const envPath = resolve(root, ".env");

if (!existsSync(envPath)) copyFileSync(resolve(root, ".env.example"), envPath);

const { text, added, skipped } = addMissingSecrets(readFileSync(envPath, "utf8"), defaultGenerators(), SECRET_GROUPS);
if (added.length > 0) {
  writeFileSync(envPath, text);
  console.log(`Added: ${added.join(", ")}`);
} else {
  console.log("Nothing to add");
}
if (skipped.length > 0) {
  console.log(`Skipped (the other key of the pair is set; set both or empty both): ${skipped.join(", ")}`);
}
// The file holds private keys: owner read/write only, also when it already existed.
chmodSync(envPath, 0o600);
