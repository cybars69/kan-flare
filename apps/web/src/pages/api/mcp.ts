import type { NextApiRequest, NextApiResponse } from "next";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { getCloudflareContext } from "@opennextjs/cloudflare";

import type { KanClient } from "@kan/mcp/client";
import { withApiLogging } from "@kan/api/utils/apiLogging";
import { getApiToken } from "@kan/api/utils/apiToken";
import {
  ensureOAuthResources,
  getAppOrigin,
  oauthChallenge,
  resolveOAuthUser,
} from "@kan/api/utils/oauth";
import {
  getCachedPaidWorkspaceEligibility,
  setCachedPaidWorkspaceEligibility,
} from "@kan/api/utils/paidWorkspaceCache";
import { isOAuthAccessToken } from "@kan/auth";
import { createKanMcpServer } from "@kan/mcp";
import { createKanClient, KanApiError } from "@kan/mcp/client";
import { isPaidWorkspacePlan } from "@kan/shared/utils";

import { env } from "~/env";
import { auth, db } from "~/server/auth";

interface WorkspaceMembership {
  workspace: { plan: string };
}

async function hasPaidWorkspace(
  client: KanClient,
  apiToken: string,
): Promise<boolean> {
  if (await getCachedPaidWorkspaceEligibility(apiToken)) {
    return true;
  }

  const memberships = await client.request<WorkspaceMembership[]>(
    "GET",
    "/workspaces",
  );
  const eligible = memberships.some((m) =>
    isPaidWorkspacePlan(m.workspace.plan),
  );

  if (eligible) {
    await setCachedPaidWorkspaceEligibility(apiToken);
  }

  return eligible;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // The configured URL, or this request's origin on an unconfigured install.
  const baseUrl = (env.NEXT_PUBLIC_BASE_URL ?? getAppOrigin()).replace(
    /\/$/,
    "",
  );
  if (!baseUrl) {
    res.status(500).json({ error: "The app's URL is not known" });
    return;
  }

  // No credentials: point the client at kan-flare's OAuth sign-in (RFC 9728).
  // API keys (`Authorization: Bearer kan_…`) work too.
  const apiToken = getApiToken(req);
  if (!apiToken) {
    await ensureOAuthResources(db, baseUrl);
    res.setHeader(
      "WWW-Authenticate",
      oauthChallenge("mcp", undefined, baseUrl),
    );
    res.status(401).json({ error: "Sign in with OAuth or use an API key" });
    return;
  }
  // Check OAuth tokens up front, so an expired one gets the challenge that
  // makes clients refresh or sign in again.
  if (
    isOAuthAccessToken(apiToken) &&
    !(await resolveOAuthUser(auth, db, apiToken))
  ) {
    res.setHeader(
      "WWW-Authenticate",
      oauthChallenge("mcp", "invalid_token", baseUrl),
    );
    res.status(401).json({ error: "Invalid or expired access token" });
    return;
  }

  // Call our own REST API through the WORKER_SELF_REFERENCE service binding
  // when it exists, so the request stays inside Cloudflare.
  const self = (() => {
    try {
      const { env: bindings } = getCloudflareContext() as unknown as {
        env: { WORKER_SELF_REFERENCE?: { fetch: typeof fetch } };
      };
      return bindings.WORKER_SELF_REFERENCE;
    } catch {
      return undefined;
    }
  })();
  const client = createKanClient({
    baseUrl,
    apiToken,
    fetch: self ? (input, init) => self.fetch(input, init) : undefined,
  });

  if (env.NEXT_PUBLIC_KAN_ENV === "cloud") {
    let eligible: boolean;
    try {
      eligible = await hasPaidWorkspace(client, apiToken);
    } catch (error) {
      if (error instanceof KanApiError && error.status === 401) {
        res.status(401).json({ error: "Invalid API key" });
        return;
      }
      if (error instanceof KanApiError && error.status === 429) {
        res.status(429).json({ error: error.message });
        return;
      }
      throw error;
    }
    if (!eligible) {
      res.status(403).json({
        error:
          "The hosted MCP server requires a Team, Pro, or Enterprise workspace plan.",
      });
      return;
    }
  }

  const server = createKanMcpServer(client);
  // The web-standard transport, fed a Request built from req.headers. The
  // Node transport converts through Hono, which reads req.rawHeaders; under
  // OpenNext those don't carry the Accept header, so every call got 406.
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined) {
      headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    }
  }
  const webRequest = new Request(new URL(req.url ?? "/api/mcp", baseUrl), {
    method: req.method,
    headers,
    body: JSON.stringify(req.body),
  });

  try {
    await server.connect(transport);
    const response = await transport.handleRequest(webRequest, {
      parsedBody: req.body as unknown,
    });
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.send(Buffer.from(await response.arrayBuffer()));
  } finally {
    await transport.close();
    await server.close();
  }
}

export default withApiLogging(handler, { transport: "mcp" });
