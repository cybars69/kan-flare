import type { NextApiRequest, NextApiResponse } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { tokenOrIpIdentifier, withRateLimit } from "./rateLimit.js";

const cloudflare = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
}));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env: cloudflare.env }),
}));

function makeReq(headers: Record<string, string> = {}): NextApiRequest {
  return {
    headers,
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as NextApiRequest;
}

describe("tokenOrIpIdentifier", () => {
  it("falls back to IP when no token is present", () => {
    const req = makeReq({ "x-forwarded-for": "203.0.113.5" });

    expect(tokenOrIpIdentifier(req)).toBe("203.0.113.5");
  });

  it("keys two different tokens into independent buckets", () => {
    const reqA = makeReq({ authorization: "Bearer token-a" });
    const reqB = makeReq({ authorization: "Bearer token-b" });

    expect(tokenOrIpIdentifier(reqA)).not.toBe(tokenOrIpIdentifier(reqB));
  });

  it("keys the same token to the same bucket regardless of caller IP", () => {
    const reqA = makeReq({
      authorization: "Bearer same-token",
      "x-forwarded-for": "203.0.113.5",
    });
    const reqB = makeReq({
      authorization: "Bearer same-token",
      "x-forwarded-for": "198.51.100.9",
    });

    expect(tokenOrIpIdentifier(reqA)).toBe(tokenOrIpIdentifier(reqB));
  });

  it("does not use the raw token as the bucket key", () => {
    const req = makeReq({ authorization: "Bearer super-secret-token" });

    expect(tokenOrIpIdentifier(req)).not.toContain("super-secret-token");
  });

  it("also accepts an x-api-key header", () => {
    const req = makeReq({ "x-api-key": "kan_test_token" });

    expect(tokenOrIpIdentifier(req)).toMatch(/^token_[0-9a-f]{64}$/);
  });
});

function makeRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
  };
  return res;
}

const call = async (
  handler: ReturnType<typeof withRateLimit>,
  { url = "/api/trpc/x", ip = "203.0.113.5" } = {},
) => {
  const req = {
    url,
    headers: { "cf-connecting-ip": ip },
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as NextApiRequest;
  const res = makeRes();
  await handler(req, res as unknown as NextApiResponse);
  return res.statusCode;
};

describe("withRateLimit", () => {
  beforeEach(() => {
    cloudflare.env = {};
  });

  it("prefers cf-connecting-ip, which clients can't forge", () => {
    const req = makeReq({
      "cf-connecting-ip": "198.51.100.1",
      "x-forwarded-for": "203.0.113.5",
    });
    expect(tokenOrIpIdentifier(req)).toBe("198.51.100.1");
  });

  it("uses the matching Workers binding with a scoped key", async () => {
    const limit = vi.fn().mockResolvedValue({ success: false });
    cloudflare.env = { RATE_LIMIT_100: { limit } };
    const handler = vi.fn();

    const status = await call(
      withRateLimit({ points: 100, duration: 60 }, handler),
      { url: "/api/files/attachments/a.pdf?sig=x", ip: "198.51.100.7" },
    );

    expect(status).toBe(429);
    expect(handler).not.toHaveBeenCalled();
    expect(limit).toHaveBeenCalledWith({ key: "/api/files:198.51.100.7" });
  });

  it("falls back to in-memory counting without a binding", async () => {
    const limited = withRateLimit({ points: 2, duration: 60 }, vi.fn());
    const ip = "192.0.2.10";

    expect(await call(limited, { ip })).toBe(200);
    expect(await call(limited, { ip })).toBe(200);
    expect(await call(limited, { ip })).toBe(429);
    // Another route family has its own budget.
    expect(await call(limited, { ip, url: "/api/upload/avatar" })).toBe(200);
  });

  it("runs the handler once when it throws", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("boom"));
    const wrapped = withRateLimit({ points: 5, duration: 60 }, handler);

    await expect(call(wrapped, { ip: "192.0.2.20" })).rejects.toThrow("boom");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("lets requests through when the limiter itself fails", async () => {
    cloudflare.env = {
      RATE_LIMIT_100: { limit: vi.fn().mockRejectedValue(new Error("down")) },
    };
    const handler = vi.fn();

    expect(
      await call(withRateLimit({ points: 100, duration: 60 }, handler)),
    ).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
