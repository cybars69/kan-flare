#!/usr/bin/env node
/**
 * Generates the VAPID key pair push notifications are signed with and adds
 * it to the repo-root .env (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY). The next
 * deploy uploads both as Worker secrets.
 *
 *   node tools/generate-vapid-keys.mjs           # only if not set yet
 *   node tools/generate-vapid-keys.mjs --force   # replace existing keys
 *
 * Replacing the keys invalidates every device's subscription: people have
 * to turn push notifications on again. Values are never printed.
 */
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "dotenv";

import { repoRoot } from "./runtime-secrets.mjs";

const envFile = join(repoRoot, ".env");
const force = process.argv.includes("--force");
const current = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
const parsed = parse(current);

if (parsed.VAPID_PUBLIC_KEY && parsed.VAPID_PRIVATE_KEY && !force) {
  console.log(
    "VAPID keys are already set in .env; pass --force to replace them.",
  );
  process.exit(0);
}

const keys = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"],
);
const publicKey = Buffer.from(
  await crypto.subtle.exportKey("raw", keys.publicKey),
).toString("base64url");
const { d: privateKey } = await crypto.subtle.exportKey("jwk", keys.privateKey);

const values = { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey };
let next = current;
for (const [name, value] of Object.entries(values)) {
  const line = new RegExp(`^${name}=.*$`, "m");
  next = line.test(next)
    ? next.replace(line, `${name}=${value}`)
    : `${next}${next === "" || next.endsWith("\n") ? "" : "\n"}${name}=${value}\n`;
}
writeFileSync(envFile, next, { mode: 0o600 });
chmodSync(envFile, 0o600);
console.log(
  `${force ? "Replaced" : "Added"} VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in .env. Deploy to upload them.`,
);
