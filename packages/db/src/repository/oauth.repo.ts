import { and, desc, eq } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import {
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRefreshToken,
  oauthResource,
} from "@kan/db/schema";

import { runBatch } from "../utils/d1";

/**
 * Makes sure kan-flare's own APIs exist as OAuth protected resources for this
 * origin. The OAuth Provider plugin only issues tokens for resources it has a
 * row for, and the origin isn't known until a request arrives (a fresh
 * "Deploy to Cloudflare" install has no configured URL). One statement;
 * existing rows are left alone.
 */
export const ensureResources = async (
  db: dbClient,
  resources: { identifier: string; name: string }[],
) => {
  if (resources.length === 0) return;
  const now = new Date();
  await db
    .insert(oauthResource)
    .values(
      resources.map((resource) => ({
        identifier: resource.identifier,
        name: resource.name,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .onConflictDoNothing({ target: oauthResource.identifier });
};

/** Apps the user has allowed to connect (one row per app), newest first. */
export const listConnectedApps = (db: dbClient, userId: string) =>
  db
    .select({
      clientId: oauthClient.clientId,
      name: oauthClient.name,
      uri: oauthClient.uri,
      icon: oauthClient.icon,
      scopes: oauthConsent.scopes,
      connectedAt: oauthConsent.createdAt,
      updatedAt: oauthConsent.updatedAt,
    })
    .from(oauthConsent)
    .innerJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
    .where(eq(oauthConsent.userId, userId))
    .orderBy(desc(oauthConsent.updatedAt), desc(oauthConsent.id));

/**
 * Disconnects an app: removes the user's consent and every access and
 * refresh token it holds for them, so it stops working at once and has to
 * ask again. Returns whether anything was connected.
 */
export const disconnectApp = async (
  db: dbClient,
  args: { userId: string; clientId: string },
) => {
  const forUser = <
    T extends
      | typeof oauthAccessToken
      | typeof oauthRefreshToken
      | typeof oauthConsent,
  >(
    table: T,
  ) => and(eq(table.userId, args.userId), eq(table.clientId, args.clientId));

  const [, , consents] = await runBatch(db, [
    db.delete(oauthAccessToken).where(forUser(oauthAccessToken)),
    db.delete(oauthRefreshToken).where(forUser(oauthRefreshToken)),
    db
      .delete(oauthConsent)
      .where(forUser(oauthConsent))
      .returning({ id: oauthConsent.id }),
  ]);
  return Array.isArray(consents) && consents.length > 0;
};
