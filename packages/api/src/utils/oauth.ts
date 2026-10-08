import type { initAuth } from "@kan/auth/server";
import type { dbClient } from "@kan/db/client";
import {
  isOAuthAccessToken,
  OAUTH_RESOURCE_PATHS,
  OAUTH_SCOPES,
} from "@kan/auth";
import * as oauthRepo from "@kan/db/repository/oauth.repo";
import * as userRepo from "@kan/db/repository/user.repo";
import { createLogger } from "@kan/logger";

const log = createLogger("oauth");

type Auth = ReturnType<typeof initAuth>;
export type OAuthResourceKind = keyof typeof OAUTH_RESOURCE_PATHS;

/** The app's public origin (worker.mjs fills it in when it isn't configured). */
export const getAppOrigin = (): string =>
  (process.env.NEXT_PUBLIC_BASE_URL ?? "").replace(/\/$/, "");

/** OAuth issuer: Better Auth's base URL, where /oauth2/* lives. */
export const getIssuer = (origin = getAppOrigin()) => `${origin}/api/auth`;

export const getResourceUrl = (
  kind: OAuthResourceKind,
  origin = getAppOrigin(),
) => `${origin}${OAUTH_RESOURCE_PATHS[kind]}`;

/** RFC 9728 metadata URL for a resource (path-inserted form). */
export const getResourceMetadataUrl = (
  kind: OAuthResourceKind,
  origin = getAppOrigin(),
) =>
  `${origin}/.well-known/oauth-protected-resource${OAUTH_RESOURCE_PATHS[kind]}`;

const RESOURCE_NAMES: Record<OAuthResourceKind, string> = {
  mcp: "kan-flare MCP server",
  api: "kan-flare REST API",
};

/** Creates the resource rows the OAuth server needs for this origin. */
export async function ensureOAuthResources(
  db: dbClient,
  origin = getAppOrigin(),
) {
  if (!origin) return;
  try {
    await oauthRepo.ensureResources(
      db,
      (Object.keys(RESOURCE_NAMES) as OAuthResourceKind[]).map((kind) => ({
        identifier: getResourceUrl(kind, origin),
        name: RESOURCE_NAMES[kind],
      })),
    );
  } catch (error) {
    log.error({ err: error }, "Failed to register OAuth resources");
  }
}

/** RFC 9728 protected resource metadata. */
export function protectedResourceMetadata(
  kind: OAuthResourceKind,
  origin = getAppOrigin(),
) {
  return {
    resource: getResourceUrl(kind, origin),
    resource_name: RESOURCE_NAMES[kind],
    authorization_servers: [getIssuer(origin)],
    scopes_supported: [...OAUTH_SCOPES],
    bearer_methods_supported: ["header"],
  };
}

/** WWW-Authenticate value pointing clients at the OAuth sign-in. */
export function oauthChallenge(
  kind: OAuthResourceKind,
  error?: "invalid_token",
  origin = getAppOrigin(),
) {
  const parts = [
    `Bearer resource_metadata="${getResourceMetadataUrl(kind, origin)}"`,
    `scope="${OAUTH_SCOPES.join(" ")}"`,
  ];
  if (error) parts.push(`error="${error}"`);
  return parts.join(", ");
}

/**
 * The user an OAuth access token belongs to, or null when it isn't one, or
 * is unknown, expired or revoked.
 */
export async function resolveOAuthUser(
  auth: Auth,
  db: dbClient,
  token: string,
) {
  if (!isOAuthAccessToken(token)) return null;
  const info = await auth.api.resolveOAuthAccessToken({ body: { token } });
  if (!info) return null;
  const user = await userRepo.getAuthUserById(db, info.userId);
  return user ? { ...user, name: user.name ?? "" } : null;
}

export const getBearerToken = (headers: Headers): string | null =>
  headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1] ?? null;
