#!/usr/bin/env node
/**
 * Updates the Worker's secrets from the repo-root .env without deploying.
 * `pnpm run deploy` already uploads them with each version, so
 * use this only to change a secret between deploys.
 *
 *   pnpm secrets:push              # production
 *   pnpm secrets:push --dry-run    # list names only
 *
 * Values go to `wrangler secret bulk` on stdin; they are never printed.
 */
import { spawn } from "node:child_process";

import {
  readRuntimeSecrets,
  webDir,
  wranglerConfig,
} from "./runtime-secrets.mjs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const envIndex = args.indexOf("--env");
const wranglerEnv = envIndex >= 0 ? args[envIndex + 1] : undefined;

const { secrets, names, skippedAsVars } = readRuntimeSecrets(wranglerEnv);
if (skippedAsVars.length) {
  console.log(
    `Skipped (set as vars in wrangler.jsonc): ${skippedAsVars.join(", ")}`,
  );
}
if (names.length === 0) {
  console.error("No secrets to push.");
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
    "-c",
    wranglerConfig,
    ...(wranglerEnv ? ["--env", wranglerEnv] : []),
  ],
  { cwd: webDir, stdio: ["pipe", "inherit", "inherit"] },
);
wrangler.stdin.end(JSON.stringify(secrets));
wrangler.on("exit", (code) => process.exit(code ?? 1));
