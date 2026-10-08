/**
 * Reads the Worker secrets from the repo-root .env: every non-empty value
 * except NEXT_PUBLIC_* (compiled into the build) and names already set as
 * `vars` in apps/web/wrangler.jsonc (Wrangler rejects a name that is both).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";
import { unstable_readConfig } from "wrangler";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
export const webDir = join(repoRoot, "apps/web");

/** The Wrangler config (optionally for a named Wrangler `env`). */
export const readWranglerConfig = (env) =>
  unstable_readConfig({ config: join(webDir, "wrangler.jsonc"), env });

export function readRuntimeSecrets(env) {
  const envFile = join(repoRoot, ".env");
  let parsed;
  try {
    parsed = parse(readFileSync(envFile));
  } catch {
    throw new Error(`Could not read ${envFile}. Copy .env.example to .env.`);
  }

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
