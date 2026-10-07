import { createHash } from "crypto";

const TTL_SECONDS = 30;
const KEY_PREFIX = "mcp_paid_workspace:";

// Per-isolate cache; entries are short-lived, so sharing across instances
// is not needed.
const memoryCache = new Map<string, number>();

function hashToken(apiToken: string): string {
  return createHash("sha256").update(apiToken).digest("hex");
}

export function getCachedPaidWorkspaceEligibility(
  apiToken: string,
): Promise<boolean> {
  const key = `${KEY_PREFIX}${hashToken(apiToken)}`;
  const expiresAt = memoryCache.get(key);
  if (expiresAt === undefined) return Promise.resolve(false);
  if (expiresAt <= Date.now()) {
    memoryCache.delete(key);
    return Promise.resolve(false);
  }
  return Promise.resolve(true);
}

export function setCachedPaidWorkspaceEligibility(
  apiToken: string,
): Promise<void> {
  const key = `${KEY_PREFIX}${hashToken(apiToken)}`;
  memoryCache.set(key, Date.now() + TTL_SECONDS * 1000);
  return Promise.resolve();
}

export function clearPaidWorkspaceCache(): void {
  memoryCache.clear();
}
