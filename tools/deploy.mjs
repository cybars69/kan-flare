#!/usr/bin/env node
/**
 * Builds and deploys kan-flare to Cloudflare in one command.
 *
 *   pnpm --filter @kan/web deploy                  # production
 *   pnpm --filter @kan/web deploy --env staging
 *   pnpm --filter @kan/web deploy --skip-build     # reuse .open-next
 *
 * 1. Build with OpenNext (NEXT_PUBLIC_* come from the repo-root .env).
 * 2. If the D1 database exists, apply pending migrations before the new code
 *    goes live; a failed migration stops the deploy.
 * 3. Deploy, uploading the secrets from .env with this version
 *    (--secrets-file). Missing D1/R2/etc. resources are created here.
 * 4. Apply migrations again, which creates the tables on the first deploy.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  readRuntimeSecrets,
  readWranglerConfig,
  webDir,
} from "./runtime-secrets.mjs";

const args = process.argv.slice(2);
const envIndex = args.indexOf("--env");
const wranglerEnv = envIndex >= 0 ? args[envIndex + 1] : undefined;
const envArgs = wranglerEnv ? ["--env", wranglerEnv] : [];
const target = wranglerEnv ? `"${wranglerEnv}"` : "production";

const run = (
  command,
  commandArgs,
  { allowFailure = false, quiet = false } = {},
) => {
  const result = spawnSync("pnpm", ["exec", command, ...commandArgs], {
    cwd: webDir,
    stdio: quiet ? "pipe" : "inherit",
    env: { ...process.env, CI: "true" },
  });
  if (result.status !== 0 && !allowFailure) {
    console.error(`\n✘ ${command} ${commandArgs.join(" ")} failed.`);
    process.exit(result.status ?? 1);
  }
  return result.status === 0;
};

const database =
  readWranglerConfig(wranglerEnv).d1_databases?.[0]?.database_name;
if (!database) {
  console.error("No D1 database configured in apps/web/wrangler.jsonc.");
  process.exit(1);
}
const migrate = () =>
  run("wrangler", [
    "d1",
    "migrations",
    "apply",
    database,
    "--remote",
    ...envArgs,
  ]);

console.log(`\n▶ Deploying kan-flare to ${target}\n`);

if (!args.includes("--skip-build")) {
  console.log("▶ Building");
  run("opennextjs-cloudflare", ["build"]);
}

const databaseExists = run("wrangler", ["d1", "info", database, ...envArgs], {
  allowFailure: true,
  quiet: true,
});
if (databaseExists) {
  console.log(`\n▶ Migrating ${database} before deploy`);
  migrate();
} else {
  console.log(
    `\n▶ ${database} doesn't exist yet; it is created by this deploy`,
  );
}

const { secrets, names, skippedAsVars } = readRuntimeSecrets(wranglerEnv);
if (skippedAsVars.length) {
  console.log(
    `  Not uploading as secrets (they are vars): ${skippedAsVars.join(", ")}`,
  );
}
const secretsDir = mkdtempSync(join(tmpdir(), "kan-flare-secrets-"));
const secretsFile = join(secretsDir, "secrets.json");
try {
  writeFileSync(secretsFile, JSON.stringify(secrets), { mode: 0o600 });
  chmodSync(secretsFile, 0o600);
  console.log(
    `\n▶ Deploying with ${names.length} secret(s): ${names.join(", ") || "none"}`,
  );
  run("opennextjs-cloudflare", [
    "deploy",
    ...envArgs,
    ...(names.length ? ["--secrets-file", secretsFile] : []),
  ]);
} finally {
  rmSync(secretsDir, { recursive: true, force: true });
}

console.log(`\n▶ Migrating ${database} after deploy`);
migrate();

console.log(`\n✔ Deployed to ${target}`);
