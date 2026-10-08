import { createHash, randomBytes } from "node:crypto";
import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import type { TestUser } from "../support/test-user";
import { AuthPage } from "../support/pages/auth-page";
import { SelfHostedOnboardingPage } from "../support/pages/self-hosted-onboarding-page";
import { createTestUser } from "../support/test-user";

// A pretend MCP client. Its redirect URI is intercepted by Playwright, so
// nothing needs to listen there.
const REDIRECT_URI = "https://mcp-client.example/callback";

const base64url = (bytes: Buffer) => bytes.toString("base64url");

/** The value, or a test failure naming what was missing. */
function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`Missing ${what}`);
  return value;
}

interface AuthServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
  code_challenge_methods_supported?: string[];
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

const mcpRequest = (token?: string) => ({
  headers: {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  },
  data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
});

async function discover(request: APIRequestContext) {
  const challenge = await request.post("/api/mcp", mcpRequest());
  expect(challenge.status()).toBe(401);
  const header = challenge.headers()["www-authenticate"] ?? "";
  const metadataUrl = /resource_metadata="([^"]+)"/.exec(header)?.[1];
  expect(metadataUrl).toBeTruthy();

  const resourceMetadata = (await (
    await request.get(must(metadataUrl, "resource_metadata URL"))
  ).json()) as {
    resource: string;
    authorization_servers: string[];
  };
  expect(resourceMetadata.resource).toMatch(/\/api\/mcp$/);

  // RFC 8414: the issuer's path goes after the well-known segment.
  const issuer = new URL(
    must(resourceMetadata.authorization_servers[0], "authorization server"),
  );
  const metadata = (await (
    await request.get(
      `${issuer.origin}/.well-known/oauth-authorization-server${issuer.pathname}`,
    )
  ).json()) as AuthServerMetadata;
  expect(metadata.issuer).toBe(issuer.href.replace(/\/$/, ""));
  expect(metadata.code_challenge_methods_supported).toContain("S256");
  return { resource: resourceMetadata.resource, metadata };
}

async function authorize(
  page: Page,
  metadata: AuthServerMetadata,
  clientId: string,
  resource: string,
  user: TestUser,
  decision: "Allow" | "Deny" | "remembered",
  appName = "E2E MCP Client",
) {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const state = base64url(randomBytes(8));

  let callback: URL | undefined;
  await page.route(`${REDIRECT_URI}**`, async (route) => {
    callback = new URL(route.request().url());
    await route.fulfill({ status: 200, body: "ok" });
  });

  const url = new URL(metadata.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope: "openid profile email offline_access",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource,
  }).toString();
  await page.goto(url.toString());

  // Not signed in: the OAuth server sends the browser to kan-flare's login.
  await page.waitForURL(/\/login\?.*sig=/);
  await page.getByPlaceholder("Enter your email address").fill(user.email);
  await page.getByPlaceholder("Enter your password").fill(user.password);
  await page.getByRole("button", { name: "Continue with email" }).click();

  if (decision === "remembered") {
    // Already allowed: no consent screen, straight back to the client.
    await expect.poll(() => callback?.toString()).toBeTruthy();
    const received = must(callback, "redirect to the client");
    expect(received.searchParams.get("state")).toBe(state);
    return { callback: received, verifier };
  }

  await page.waitForURL(/\/oauth\/consent\?/);
  await expect(
    page.getByRole("heading", { name: `${appName} wants to connect` }),
  ).toBeVisible();
  await expect(
    page.getByText(`It will be able to, as ${user.email}:`),
  ).toBeVisible();
  await page.getByRole("button", { name: decision, exact: true }).click();

  await expect.poll(() => callback?.toString()).toBeTruthy();
  const received = must(callback, "redirect to the client");
  expect(received.searchParams.get("state")).toBe(state);
  return { callback: received, verifier };
}

test(
  "an MCP client signs in with OAuth and uses MCP and the REST API",
  { tag: "@self-hosted" },
  async ({ page, browser, request }) => {
    test.setTimeout(90_000);

    const user = createTestUser();
    await new AuthPage(page).signUp(user);
    await new SelfHostedOnboardingPage(page).createFirstWorkspace(
      "OAuth Workspace",
    );

    const { resource, metadata } = await discover(request);

    // Dynamic client registration, as a public client using PKCE.
    const registration = await request.post(metadata.registration_endpoint, {
      data: {
        client_name: "E2E MCP Client",
        redirect_uris: [REDIRECT_URI],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      },
    });
    expect(registration.status()).toBe(201);
    const { client_id: clientId } = (await registration.json()) as {
      client_id: string;
    };

    // A signed-out browser goes through login and consent.
    const context = await browser.newContext();
    const browserPage = await context.newPage();
    const { callback, verifier } = await authorize(
      browserPage,
      metadata,
      clientId,
      resource,
      user,
      "Allow",
    );
    const code = callback.searchParams.get("code");
    expect(code).toBeTruthy();

    const tokenResponse = await request.post(metadata.token_endpoint, {
      form: {
        grant_type: "authorization_code",
        code: must(code, "authorization code"),
        redirect_uri: REDIRECT_URI,
        client_id: clientId,
        code_verifier: verifier,
        resource,
      },
    });
    expect(tokenResponse.status()).toBe(200);
    const tokens = (await tokenResponse.json()) as TokenResponse;
    expect(tokens.access_token).toMatch(/^kan_oat_/);
    expect(tokens.refresh_token).toMatch(/^kan_ort_/);

    // MCP with the access token.
    const tools = await request.post(
      "/api/mcp",
      mcpRequest(tokens.access_token),
    );
    expect(tools.status()).toBe(200);
    const toolList = (await tools.json()) as {
      result: { tools: { name: string }[] };
    };
    expect(toolList.result.tools.length).toBeGreaterThan(10);

    // The REST API accepts the same token, as the same user.
    const me = await request.get("/api/v1/users/me", {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    expect(me.status()).toBe(200);
    expect(((await me.json()) as { email: string }).email).toBe(user.email);

    // Refreshing gives a working new access token.
    const refreshed = await request.post(metadata.token_endpoint, {
      form: {
        grant_type: "refresh_token",
        refresh_token: must(tokens.refresh_token, "refresh token"),
        client_id: clientId,
        resource,
      },
    });
    expect(refreshed.status()).toBe(200);
    const refreshedTokens = (await refreshed.json()) as TokenResponse;
    expect(
      (
        await request.post("/api/mcp", mcpRequest(refreshedTokens.access_token))
      ).status(),
    ).toBe(200);

    // An unknown token gets the challenge that makes clients sign in again.
    const bad = await request.post("/api/mcp", mcpRequest("kan_oat_nope"));
    expect(bad.status()).toBe(401);
    expect(bad.headers()["www-authenticate"]).toContain(
      'error="invalid_token"',
    );

    // Signing in again for the same app skips consent: it's remembered.
    const againContext = await browser.newContext();
    const { callback: again } = await authorize(
      await againContext.newPage(),
      metadata,
      clientId,
      resource,
      user,
      "remembered",
    );
    expect(again.searchParams.get("code")).toBeTruthy();
    await againContext.close();

    // Denying a different app sends it access_denied, not a code.
    const other = await request.post(metadata.registration_endpoint, {
      data: {
        client_name: "Other MCP Client",
        redirect_uris: [REDIRECT_URI],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      },
    });
    const { client_id: otherClientId } = (await other.json()) as {
      client_id: string;
    };
    const denyContext = await browser.newContext();
    const { callback: denied } = await authorize(
      await denyContext.newPage(),
      metadata,
      otherClientId,
      resource,
      user,
      "Deny",
      "Other MCP Client",
    );
    expect(denied.searchParams.get("error")).toBe("access_denied");
    expect(denied.searchParams.get("code")).toBeNull();

    // Disconnecting the app in Settings revokes its tokens at once.
    await page.goto("/settings/api");
    const appRow = page
      .getByRole("listitem")
      .filter({ hasText: "E2E MCP Client" });
    await expect(appRow).toBeVisible();
    await appRow
      .getByRole("button", { name: "Disconnect E2E MCP Client" })
      .click();
    await appRow
      .getByRole("button", { name: "Confirm disconnecting E2E MCP Client" })
      .click();
    await expect(page.getByText("App disconnected")).toBeVisible();
    await expect(appRow).toHaveCount(0);

    const afterDisconnect = await request.post(
      "/api/mcp",
      mcpRequest(refreshedTokens.access_token),
    );
    expect(afterDisconnect.status()).toBe(401);
    expect(afterDisconnect.headers()["www-authenticate"]).toContain(
      'error="invalid_token"',
    );
    const refreshAfterDisconnect = await request.post(metadata.token_endpoint, {
      form: {
        grant_type: "refresh_token",
        refresh_token: must(refreshedTokens.refresh_token, "refresh token"),
        client_id: clientId,
        resource,
      },
    });
    expect(refreshAfterDisconnect.ok()).toBe(false);

    await context.close();
    await denyContext.close();
  },
);
