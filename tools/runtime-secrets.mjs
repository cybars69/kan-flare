/**
 * Reads the Worker secrets from the repo-root .env: every non-empty value
 * except NEXT_PUBLIC_* (compiled into the build) and names already set as
 * `vars` in the root wrangler.jsonc (Wrangler rejects a name that is both).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";
import { unstable_readConfig } from "wrangler";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
export const webDir = join(repoRoot, "apps/web");
export const wranglerConfig = join(repoRoot, "wrangler.jsonc");
export const envFile = join(repoRoot, ".env");

/** The Wrangler config (optionally for a named Wrangler `env`). */
export const readWranglerConfig = (env) =>
  unstable_readConfig({ config: wranglerConfig, env });

/** The repo-root .env as an object, or {} when there is none. */
export const readDotEnv = () =>
  existsSync(envFile) ? parse(readFileSync(envFile)) : {};

export function readRuntimeSecrets(env, { allowMissing = false } = {}) {
  if (!existsSync(envFile)) {
    if (allowMissing) return { secrets: {}, names: [], skippedAsVars: [] };
    throw new Error(`Could not read ${envFile}. Copy .env.example to .env.`);
  }
  const parsed = readDotEnv();

  const vars = new Set(Object.keys(readWranglerConfig(env).vars ?? {}));
  const secrets = {};
  const skippedAsVars = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (key.startsWith("NEXT_PUBLIC_") || value.trim() === "") continue;
    if (vars.has(key)) {
      skippedAsVars.push(key);
      continue;
    }
    secrets[key] = value;
  }

  return { secrets, names: Object.keys(secrets).sort(), skippedAsVars };
}
