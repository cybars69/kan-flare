import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { middleware } from "./middleware";

// `env` from ~/env, read through a mock so each test can set values.
const mockedEnv = vi.hoisted(() =>
  vi.fn<(key: string) => string | undefined>(),
);
vi.mock("~/env", () => ({
  env: new Proxy({}, { get: (_target, key) => mockedEnv(String(key)) }),
}));

describe("middleware", () => {
  beforeEach(() => {
    mockedEnv.mockReset();
  });

  it("uses the configured public URL for self-hosted login redirects", () => {
    mockedEnv.mockImplementation((key) => {
      if (key === "NEXT_PUBLIC_BASE_URL") return "https://kan.example.com";
      if (key === "NEXT_PUBLIC_KAN_ENV") return "self-hosted";
    });

    const response = middleware(new NextRequest("http://localhost:3000/"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://kan.example.com/login",
    );
  });

  it.each([undefined, ""])(
    "falls back to the request URL when the public URL is %s",
    (publicBaseUrl) => {
      mockedEnv.mockImplementation((key) => {
        if (key === "NEXT_PUBLIC_BASE_URL") return publicBaseUrl;
        if (key === "NEXT_PUBLIC_KAN_ENV") return "self-hosted";
      });

      const response = middleware(new NextRequest("http://localhost:3000/"));

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        "http://localhost:3000/login",
      );
    },
  );

  it("falls back to the request URL when the public URL is malformed", () => {
    mockedEnv.mockImplementation((key) => {
      if (key === "NEXT_PUBLIC_BASE_URL") return "kan.example.com";
      if (key === "NEXT_PUBLIC_KAN_ENV") return "self-hosted";
    });

    const response = middleware(new NextRequest("http://localhost:3000/"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/login",
    );
  });

  it.each(["mcp.kan.bn", "mcp-staging.kan.bn"])(
    "rewrites requests with Host: %s to /api/mcp",
    (host) => {
      mockedEnv.mockImplementation((key) => {
        if (key === "NEXT_PUBLIC_KAN_ENV") return "cloud";
      });

      const response = middleware(
        new NextRequest("http://localhost:3000/", { headers: { host } }),
      );

      const rewriteTarget = response.headers.get("x-middleware-rewrite");
      expect(rewriteTarget).not.toBeNull();
      expect(new URL(rewriteTarget!).pathname).toBe("/api/mcp");
    },
  );

  it("does not rewrite the main app domain", () => {
    mockedEnv.mockImplementation((key) => {
      if (key === "NEXT_PUBLIC_KAN_ENV") return "cloud";
    });

    const response = middleware(
      new NextRequest("http://localhost:3000/", {
        headers: { host: "kan.bn" },
      }),
    );

    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.headers.get("location")).toBeNull();
  });

  it.each([
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-authorization-server",
  ])(
    "returns 404 for %s on the MCP hostname instead of the app shell",
    (pathname) => {
      mockedEnv.mockImplementation((key) => {
        if (key === "NEXT_PUBLIC_KAN_ENV") return "cloud";
      });

      const response = middleware(
        new NextRequest(`http://localhost:3000${pathname}`, {
          headers: { host: "mcp.kan.bn" },
        }),
      );

      expect(response.status).toBe(404);
      expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    },
  );

  it("returns 404 for OAuth discovery paths on the main app domain too", () => {
    // No OAuth server exists; without this the workspace page answers 200
    // and MCP clients wrongly offer an OAuth sign-in.
    const response = middleware(
      new NextRequest(
        "https://tasks.example.com/.well-known/oauth-protected-resource",
        { headers: { host: "tasks.example.com" } },
      ),
    );

    expect(response.status).toBe(404);
  });
});
