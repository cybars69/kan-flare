import { createHash } from "crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { getCloudflareContext } from "@opennextjs/cloudflare";

import { createLogger } from "@kan/logger";

import { getApiToken } from "./apiToken";

const log = createLogger("rateLimit");

export interface RateLimitOptions {
  points?: number;
  duration?: number;
  identifier?: (req: NextApiRequest) => string | Promise<string>;
  errorMessage?: string;
  /**
   * Budget shared by requests with the same scope. Defaults to the first two
   * path segments (e.g. `/api/trpc`), so each route family has its own budget.
   */
  scope?: string;
}

const defaultIdentifier = (req: NextApiRequest): string => {
  // On Cloudflare, cf-connecting-ip is set by the edge and can't be forged
  // by the client, unlike x-forwarded-for, so it comes first.
  const cfConnectingIp = req.headers["cf-connecting-ip"];
  const forwardedFor = req.headers["x-forwarded-for"];
  const realIp = req.headers["x-real-ip"];

  const ip =
    (typeof cfConnectingIp === "string" ? cfConnectingIp : null) ??
    (typeof forwardedFor === "string"
      ? forwardedFor.split(",")[0]?.trim()
      : null) ??
    (typeof realIp === "string" ? realIp : null) ??
    req.socket.remoteAddress ??
    "unknown";

  return ip;
};

export const tokenOrIpIdentifier = (req: NextApiRequest): string => {
  const token = getApiToken(req);
  if (token) {
    return `token_${createHash("sha256").update(token).digest("hex")}`;
  }
  return defaultIdentifier(req);
};

const DEFAULT_OPTIONS = {
  points: 100,
  duration: 60,
  errorMessage: "Too many requests, please try again later.",
  identifier: defaultIdentifier,
} as const;

/** The Workers Rate Limiting binding. */
interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/**
 * Bindings are declared per limit in wrangler.jsonc ("ratelimits"), named
 * RATE_LIMIT_<points> with a 60-second period, e.g. RATE_LIMIT_100.
 */
const getBinding = (points: number, duration: number) => {
  if (duration !== 60) return undefined;
  try {
    const { env } = getCloudflareContext() as unknown as {
      env: Record<string, RateLimitBinding | undefined>;
    };
    return env[`RATE_LIMIT_${points}`];
  } catch {
    // Outside a Cloudflare request (unit tests).
    return undefined;
  }
};

/**
 * Fixed-window counter per isolate, used when no binding matches. Counts are
 * not shared between Worker instances, so this only blunts abuse.
 */
const memoryWindows = new Map<string, { count: number; resetAt: number }>();
const consumeInMemory = (key: string, points: number, duration: number) => {
  const now = Date.now();
  const window = memoryWindows.get(key);
  if (!window || window.resetAt <= now) {
    memoryWindows.set(key, { count: 1, resetAt: now + duration * 1000 });
    return true;
  }
  window.count += 1;
  return window.count <= points;
};

const warned = new Set<string>();

export function withRateLimit(
  options: RateLimitOptions,
  handler: (
    req: NextApiRequest,
    res: NextApiResponse,
  ) => Promise<unknown> | unknown,
) {
  if (process.env.DISABLE_RATE_LIMIT === "true") {
    return handler;
  }

  const points = options.points ?? DEFAULT_OPTIONS.points;
  const duration = options.duration ?? DEFAULT_OPTIONS.duration;
  const identifier = options.identifier ?? DEFAULT_OPTIONS.identifier;
  const errorMessage = options.errorMessage ?? DEFAULT_OPTIONS.errorMessage;

  return async (req: NextApiRequest, res: NextApiResponse) => {
    let allowed = true;
    try {
      const scope =
        options.scope ??
        (req.url ?? "").split("?")[0]?.split("/").slice(0, 3).join("/");
      const key = `${scope}:${await identifier(req)}`;

      const binding = getBinding(points, duration);
      if (binding) {
        allowed = (await binding.limit({ key })).success;
      } else {
        const limitName = `RATE_LIMIT_${points}/${duration}s`;
        if (!warned.has(limitName)) {
          warned.add(limitName);
          log.debug(
            { limit: limitName },
            "No rate limit binding for this limit; using in-memory counting",
          );
        }
        allowed = consumeInMemory(key, points, duration);
      }
    } catch (error) {
      // Never block a request because the limiter itself failed.
      log.warn({ err: error }, "Rate limiter failed; allowing request");
    }

    if (!allowed) {
      return res.status(429).json({ message: errorMessage });
    }
    return handler(req, res);
  };
}
