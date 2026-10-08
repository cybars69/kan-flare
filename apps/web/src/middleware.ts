import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { env } from "~/env";

const MCP_HOSTNAMES = new Set(["mcp.kan.bn", "mcp-staging.kan.bn"]);

const OAUTH_DISCOVERY_PATHS = new Set([
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-authorization-server",
]);

function resolveLoginUrl(request: NextRequest) {
  const publicBaseUrl = env.NEXT_PUBLIC_BASE_URL;

  if (publicBaseUrl?.length) {
    try {
      return new URL("/login", publicBaseUrl);
    } catch {
      // Runtime-injected values may bypass the build-time environment schema.
    }
  }

  return new URL("/login", request.url);
}

export function middleware(request: NextRequest) {
  const host = request.headers.get("host")?.split(":")[0];

  // There is no OAuth server; MCP uses API keys. Answer discovery requests
  // with 404 on every host, or the catch-all workspace page answers 200 with
  // HTML and MCP clients wrongly offer an OAuth sign-in.
  if (OAUTH_DISCOVERY_PATHS.has(request.nextUrl.pathname)) {
    return new NextResponse(null, { status: 404 });
  }

  if (request.nextUrl.pathname === "/" && host && MCP_HOSTNAMES.has(host)) {
    const url = request.nextUrl.clone();
    url.pathname = "/api/mcp";
    return NextResponse.rewrite(url);
  }

  if (request.nextUrl.pathname === "/") {
    if (env.NEXT_PUBLIC_KAN_ENV !== "cloud") {
      return NextResponse.redirect(resolveLoginUrl(request));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-authorization-server",
  ],
};
