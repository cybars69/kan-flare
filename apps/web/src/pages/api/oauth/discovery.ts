import type { NextApiRequest, NextApiResponse } from "next";
import {
  oauthProviderAuthServerMetadata,
  oauthProviderOpenIdConfigMetadata,
} from "@better-auth/oauth-provider";

import type { OAuthResourceKind } from "@kan/api/utils/oauth";
import {
  ensureOAuthResources,
  getAppOrigin,
  protectedResourceMetadata,
} from "@kan/api/utils/oauth";

import { auth, db } from "~/server/auth";

/*
 * OAuth discovery documents, reached through rewrites in next.config.js:
 *
 *   /.well-known/oauth-protected-resource[/api/mcp | /api/v1]   (RFC 9728)
 *   /.well-known/oauth-authorization-server[/api/auth]          (RFC 8414)
 *   /.well-known/openid-configuration[/api/auth]
 *
 * MCP clients start here after /api/mcp answers 401.
 */

const authServerMetadata = oauthProviderAuthServerMetadata(auth);
const openIdConfig = oauthProviderOpenIdConfigMetadata(auth);

const RESOURCE_KINDS = new Set<OAuthResourceKind>(["mcp", "api"]);

async function sendWebResponse(res: NextApiResponse, response: Response) {
  res.status(response.status);
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.send(Buffer.from(await response.arrayBuffer()));
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  // Public documents; browser-based MCP clients read them cross-origin.
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.status(204).end();
    return;
  }
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const origin = getAppOrigin();
  const doc = req.query.doc;

  if (doc === "protected-resource") {
    const kind = req.query.kind;
    const resourceKind: OAuthResourceKind =
      typeof kind === "string" && RESOURCE_KINDS.has(kind as OAuthResourceKind)
        ? (kind as OAuthResourceKind)
        : "mcp";
    // The OAuth server only issues tokens for resources it has rows for.
    await ensureOAuthResources(db, origin);
    res.setHeader("Cache-Control", "public, max-age=300");
    res.status(200).json(protectedResourceMetadata(resourceKind, origin));
    return;
  }

  if (doc === "authorization-server" || doc === "openid-configuration") {
    const request = new Request(new URL(req.url ?? "/", origin), {
      headers: req.headers as Record<string, string>,
    });
    const metadata =
      doc === "authorization-server" ? authServerMetadata : openIdConfig;
    await sendWebResponse(res, await metadata(request));
    return;
  }

  res.status(404).json({ error: "Not found" });
}
