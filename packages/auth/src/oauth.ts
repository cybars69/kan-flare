import type {
  ClientMetadataResourceFetch,
  OAuthOptions,
  Scope,
} from "@better-auth/oauth-provider";
import type { BetterAuthPlugin } from "better-auth";
import { cimd } from "@better-auth/cimd";
import {
  getOAuthProviderApi,
  oauthProvider,
} from "@better-auth/oauth-provider";
import { createAuthEndpoint } from "better-auth/api";
import { z } from "zod";

/*
 * kan-flare as an OAuth 2.1 authorization server. MCP clients (Claude,
 * Cursor…) and other apps send people through kan-flare's own sign-in and a
 * consent screen, then call /api/mcp and the REST API with the access token.
 * API keys keep working alongside.
 */

/** Scopes a client may request. Access tokens act as the user, like API keys. */
export const OAUTH_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
] as const;

/** Prefixes that tell OAuth tokens apart from API keys (`kan_…`). */
export const OAUTH_ACCESS_TOKEN_PREFIX = "kan_oat_";
export const OAUTH_REFRESH_TOKEN_PREFIX = "kan_ort_";

export const isOAuthAccessToken = (token: string) =>
  token.startsWith(OAUTH_ACCESS_TOKEN_PREFIX);

/** Paths of the protected resources, appended to the app's origin. */
export const OAUTH_RESOURCE_PATHS = {
  mcp: "/api/mcp",
  api: "/api/v1",
} as const;

export const oauthOptions = {
  loginPage: "/login",
  consentPage: "/oauth/consent",
  scopes: [...OAUTH_SCOPES],
  // Opaque tokens: verified with one database lookup (no JWKS fetch from the
  // Worker to itself), and revoking a connection takes effect at once.
  disableJwtPlugin: true,
  prefix: {
    opaqueAccessToken: OAUTH_ACCESS_TOKEN_PREFIX,
    refreshToken: OAUTH_REFRESH_TOKEN_PREFIX,
  },
  // MCP clients register themselves (RFC 7591) or identify with a Client ID
  // Metadata Document (the cimd plugin), with no account needed first.
  allowDynamicClientRegistration: true,
  allowUnauthenticatedClientRegistration: true,
  clientRegistrationDefaultScopes: [...OAUTH_SCOPES],
  // Resources are kan-flare's own APIs, created per origin on first use
  // (ensureOAuthResources); any registered client may ask for them.
  enforcePerClientResources: false,
  accessTokenExpiresIn: 60 * 60, // 1 hour; clients refresh with offline_access
  refreshTokenExpiresIn: 60 * 60 * 24 * 30, // 30 days
} satisfies OAuthOptions<Scope[]>;

export interface OAuthTokenInfo {
  userId: string;
  clientId: string | undefined;
  scopes: string[];
}

/**
 * Server-only endpoint that resolves an OAuth access token to its user, for
 * the REST API and MCP. Called as `auth.api.resolveOAuthAccessToken`.
 */
const oauthTokenResolver = () =>
  ({
    id: "kan-oauth-token-resolver",
    endpoints: {
      resolveOAuthAccessToken: createAuthEndpoint(
        "/kan/resolve-oauth-access-token",
        {
          method: "POST",
          body: z.object({ token: z.string() }),
          metadata: { SERVER_ONLY: true },
        },
        async (ctx): Promise<OAuthTokenInfo | null> => {
          const { token } = ctx.body;
          if (!isOAuthAccessToken(token)) return null;
          try {
            const payload = await getOAuthProviderApi(
              ctx,
              oauthOptions,
            ).requireActiveAccessToken(token);
            if (typeof payload.sub !== "string") return null;
            const scope = (payload as { scope?: unknown }).scope;
            const clientId = (payload as { client_id?: unknown }).client_id;
            return {
              userId: payload.sub,
              clientId: typeof clientId === "string" ? clientId : undefined,
              scopes: typeof scope === "string" ? scope.split(" ") : [],
            };
          } catch {
            // Unknown, expired or revoked.
            return null;
          }
        },
      ),
    },
  }) satisfies BetterAuthPlugin;

/**
 * Fetches a client's metadata document (CIMD: the client_id is an HTTPS URL,
 * as Claude's connector uses). The cimd plugin enforces the timeout and size
 * limits. On Workers, the `global_fetch_strictly_public` compatibility flag
 * keeps fetch on the public internet; obvious local targets are refused here
 * as well, since Node (tests, `next dev`) has no such guard.
 */
export const fetchClientMetadataResource: ClientMetadataResourceFetch = (
  input,
  init,
) => {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  if (url.protocol !== "https:") {
    throw new TypeError("Client metadata documents must be served over HTTPS");
  }
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    /^[\d.]+$/.test(host) ||
    host.includes(":")
  ) {
    throw new TypeError("Client metadata documents must use a public hostname");
  }
  return fetch(url, init);
};

export const createOAuthPlugins = () => [
  oauthProvider(oauthOptions),
  cimd({ fetchClientMetadataResource }),
  oauthTokenResolver(),
];
