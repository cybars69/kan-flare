#!/usr/bin/env node
/**
 * Builds and deploys kan-flare to Cloudflare.
 *
 *   pnpm run deploy                  # build, migrate, deploy, migrate
 *   pnpm run deploy --skip-build     # reuse apps/web/.open-next
 *   pnpm run build                   # build only (`--build-only`)
 *
 * The "Deploy to Cloudflare" button (Workers Builds) runs the root `build`
 * script, then `deploy`, which skips the build it already has.
 *
 * 1. Build with OpenNext. NEXT_PUBLIC_* come from the environment or the
 *    repo-root .env; sign-in defaults apply when neither sets them.
 * 2. If the D1 database exists, apply pending migrations before the new code
 *    goes live; a failed migration stops the deploy.
 * 3. Deploy. With a .env, its secrets ship with this version
 *    (--secrets-file). Without one (button deploys), secrets are the ones
 *    already set on the Worker. Missing D1/R2/etc. resources are created here.
 * 4. Apply migrations again, which creates the tables on the first deploy.
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  readDotEnv,
  readRuntimeSecrets,
  readWranglerConfig,
  webDir,
  wranglerConfig,
} from "./runtime-secrets.mjs";

const args = process.argv.slice(2);
const buildOnly = args.includes("--build-only");
const inWorkersBuilds = process.env.WORKERS_CI === "1";
const builtWorker = join(webDir, ".open-next/worker.js");
const skipBuild =
  args.includes("--skip-build") || (inWorkersBuilds && existsSync(builtWorker));
const configArgs = ["-c", wranglerConfig];

/** Build settings used when neither the environment nor .env sets them. */
const BUILD_DEFAULTS = {
  // Email + password sign-in works without any email setup.
  NEXT_PUBLIC_ALLOW_CREDENTIALS: "true",
  // Only the first account and people invited by email can sign up.
  NEXT_PUBLIC_DISABLE_SIGN_UP: "true",
};

const run = (
  command,
  commandArgs,
  { allowFailure = false, quiet = false, env = {} } = {},
) => {
  const result = spawnSync("pnpm", ["exec", command, ...commandArgs], {
    cwd: webDir,
    stdio: quiet ? "pipe" : "inherit",
    env: { ...process.env, CI: "true", ...env },
  });
  if (result.status !== 0 && !allowFailure) {
    console.error(`\n✘ ${command} ${commandArgs.join(" ")} failed.`);
    process.exit(result.status ?? 1);
  }
  return result.status === 0;
};

if (!skipBuild) {
  const dotEnv = readDotEnv();
  const defaults = Object.fromEntries(
    Object.entries(BUILD_DEFAULTS).filter(
      ([name]) => process.env[name] === undefined && dotEnv[name] === undefined,
    ),
  );
  console.log("▶ Building");
  if (Object.keys(defaults).length) {
    console.log(`  Defaults: ${Object.keys(defaults).join(", ")}`);
  }
  run("opennextjs-cloudflare", ["build", ...configArgs], { env: defaults });
}
if (buildOnly) process.exit(0);

const database = readWranglerConfig().d1_databases?.[0]?.database_name;
if (!database) {
  console.error("No D1 database configured in wrangler.jsonc.");
  process.exit(1);
}
const migrate = () =>
  run("wrangler", [
    "d1",
    "migrations",
    "apply",
    database,
    "--remote",
    ...configArgs,
  ]);

console.log("\n▶ Deploying kan-flare\n");

const databaseExists = run(
  "wrangler",
  ["d1", "info", database, ...configArgs],
  {
    allowFailure: true,
    quiet: true,
  },
);
if (databaseExists) {
  console.log(`\n▶ Migrating ${database} before deploy`);
  migrate();
} else {
  console.log(
    `\n▶ ${database} doesn't exist yet; it is created by this deploy`,
  );
}

const { secrets, names, skippedAsVars } = readRuntimeSecrets(undefined, {
  allowMissing: true,
});
if (skippedAsVars.length) {
  console.log(
    `  Not uploading as secrets (they are vars): ${skippedAsVars.join(", ")}`,
  );
}
let deployed = false;
const secretsDir = mkdtempSync(join(tmpdir(), "kan-flare-secrets-"));
const secretsFile = join(secretsDir, "secrets.json");
try {
  writeFileSync(secretsFile, JSON.stringify(secrets), { mode: 0o600 });
  chmodSync(secretsFile, 0o600);
  console.log(
    names.length
      ? `\n▶ Deploying with ${names.length} secret(s) from .env: ${names.join(", ")}`
      : "\n▶ Deploying (no .env secrets; keeping the Worker's own)",
  );
  deployed = run(
    "opennextjs-cloudflare",
    [
      "deploy",
      ...configArgs,
      ...(names.length ? ["--secrets-file", secretsFile] : []),
    ],
    // Don't exit from inside run(): process.exit skips `finally`, which
    // would leave the secrets file behind.
    { allowFailure: true },
  );
} finally {
  rmSync(secretsDir, { recursive: true, force: true });
}
if (!deployed) {
  console.error("\n✘ Deploy failed; nothing was migrated after it.");
  process.exit(1);
}

console.log(`\n▶ Migrating ${database} after deploy`);
migrate();

console.log("\n✔ Deployed");
