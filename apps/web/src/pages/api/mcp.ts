import type { NextApiRequest, NextApiResponse } from "next";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { getCloudflareContext } from "@opennextjs/cloudflare";

import type { KanClient } from "@kan/mcp/client";
import { withApiLogging } from "@kan/api/utils/apiLogging";
import { getApiToken } from "@kan/api/utils/apiToken";
import {
  getCachedPaidWorkspaceEligibility,
  setCachedPaidWorkspaceEligibility,
} from "@kan/api/utils/paidWorkspaceCache";
import { createKanMcpServer } from "@kan/mcp";
import { createKanClient, KanApiError } from "@kan/mcp/client";
import { isPaidWorkspacePlan } from "@kan/shared/utils";

import { env } from "~/env";

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

  const apiToken = getApiToken(req);
  if (!apiToken) {
    res.setHeader("WWW-Authenticate", 'Bearer realm="kan"');
    res.status(401).json({ error: "Missing API key" });
    return;
  }

  const rawBaseUrl = env.NEXT_PUBLIC_BASE_URL;
  if (!rawBaseUrl) {
    res.status(500).json({ error: "NEXT_PUBLIC_BASE_URL is not configured" });
    return;
  }
  const baseUrl = rawBaseUrl.replace(/\/$/, "");

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
