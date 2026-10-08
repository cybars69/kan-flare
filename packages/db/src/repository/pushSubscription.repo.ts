import { and, eq, inArray } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import { pushSubscriptions } from "@kan/db/schema";
import { generateUID } from "@kan/shared/utils";

/** Saves a device's subscription, moving it to this user if it existed. */
export const upsert = async (
  db: dbClient,
  input: {
    userId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    userAgent?: string | null;
  },
) => {
  await db
    .insert(pushSubscriptions)
    .values({
      publicId: generateUID(),
      userId: input.userId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent ?? null,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        userId: input.userId,
        p256dh: input.p256dh,
        auth: input.auth,
        userAgent: input.userAgent ?? null,
        updatedAt: new Date(),
      },
    });
};

export const deleteForUser = async (
  db: dbClient,
  args: { userId: string; endpoint: string },
) => {
  const deleted = await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.userId, args.userId),
        eq(pushSubscriptions.endpoint, args.endpoint),
      ),
    )
    .returning({ id: pushSubscriptions.id });
  return deleted.length;
};

export const getAllForUser = (db: dbClient, userId: string) =>
  db
    .select({
      id: pushSubscriptions.id,
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));

/** Removes subscriptions the push service reported as gone. */
export const deleteByIds = async (db: dbClient, ids: number[]) => {
  if (ids.length === 0) return;
  await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, ids));
};
