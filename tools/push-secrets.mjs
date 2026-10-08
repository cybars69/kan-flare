#!/usr/bin/env node
/**
 * Pushes the runtime settings from the repo-root .env to the Worker as
 * secrets, in one `wrangler secret bulk` call.
 *
 * - NEXT_PUBLIC_* values are skipped: they are compiled into the build.
 * - Empty values are skipped.
 * - Values are sent on stdin, never written to disk or printed.
 *
 * Usage (from the repo root or apps/web):
 *   pnpm --filter @kan/web secrets:push              # production
 *   pnpm --filter @kan/web secrets:push --env staging
 *   pnpm --filter @kan/web secrets:push --dry-run    # list names only
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const envIndex = args.indexOf("--env");
const wranglerEnv = envIndex >= 0 ? args[envIndex + 1] : undefined;
const envFile = join(root, ".env");

let parsed;
try {
  parsed = parse(readFileSync(envFile));
} catch {
  console.error(`Could not read ${envFile}. Copy .env.example to .env first.`);
  process.exit(1);
}

const secrets = Object.fromEntries(
  Object.entries(parsed).filter(
    ([key, value]) => !key.startsWith("NEXT_PUBLIC_") && value.trim() !== "",
  ),
);
const names = Object.keys(secrets).sort();

if (names.length === 0) {
  console.error("No runtime values to push.");
  process.exit(1);
}

console.log(
  `${dryRun ? "Would push" : "Pushing"} ${names.length} secret(s) to ${
    wranglerEnv ? `the "${wranglerEnv}" environment` : "production"
  }: ${names.join(", ")}`,
);
if (dryRun) process.exit(0);

const wrangler = spawn(
  "pnpm",
  [
    "exec",
    "wrangler",
    "secret",
    "bulk",
    ...(wranglerEnv ? ["--env", wranglerEnv] : []),
  ],
  { cwd: join(root, "apps/web"), stdio: ["pipe", "inherit", "inherit"] },
);
wrangler.stdin.end(JSON.stringify(secrets));
wrangler.on("exit", (code) => process.exit(code ?? 1));
