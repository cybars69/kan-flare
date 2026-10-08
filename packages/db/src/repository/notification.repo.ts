import type { SQL } from "drizzle-orm";
import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import type { dbClient } from "@kan/db/client";
import type { NotificationType } from "@kan/db/schema";
import {
  boards,
  cards,
  comments,
  lists,
  notifications,
  users,
  workspaces,
} from "@kan/db/schema";
import { generateUID } from "@kan/shared/utils";

export const create = async (
  db: dbClient,
  notificationInput: {
    type: NotificationType;
    userId: string;
    cardId?: number;
    commentId?: number;
    workspaceId?: number;
    metadata?: string;
  },
) => {
  const [result] = await db
    .insert(notifications)
    .values({
      publicId: generateUID(),
      type: notificationInput.type,
      userId: notificationInput.userId,
      cardId: notificationInput.cardId,
      commentId: notificationInput.commentId,
      workspaceId: notificationInput.workspaceId,
      metadata: notificationInput.metadata,
    })
    .returning();

  return result;
};

export const exists = async (
  db: dbClient,
  args: {
    userId: string;
    type: NotificationType;
    cardId?: number;
    workspaceId?: number;
    commentId?: number;
  },
) => {
  const result = await db.query.notifications.findFirst({
    where: (notifications, { eq, and, isNull: isNullFn }) => {
      const conditions = [
        eq(notifications.userId, args.userId),
        eq(notifications.type, args.type),
        isNullFn(notifications.deletedAt),
      ];

      if (args.cardId) {
        conditions.push(eq(notifications.cardId, args.cardId));
      }

      if (args.workspaceId) {
        conditions.push(eq(notifications.workspaceId, args.workspaceId));
      }

      return and(...conditions);
    },
  });

  return !!result;
};

export const markAsRead = async (db: dbClient, notificationId: number) => {
  const [result] = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(eq(notifications.id, notificationId))
    .returning();

  return result;
};

export const getUnreadCount = async (db: dbClient, userId: string) => {
  const result = await db
    .select({ count: count() })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
        isNull(notifications.deletedAt),
      ),
    );

  return result[0]?.count ?? 0;
};

/**
 * Notifications a user may still see: not deleted, the card (if any) not
 * deleted, and the user still an active member of the workspace the
 * notification belongs to. Shared by the list and the unread count so the
 * badge always matches the list.
 */
const visibleTo = (userId: string): SQL | undefined =>
  and(
    eq(notifications.userId, userId),
    isNull(notifications.deletedAt),
    or(isNull(notifications.cardId), isNull(cards.deletedAt)),
    sql`EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm."userId" = ${userId}
        AND wm."workspaceId" = COALESCE(${boards.workspaceId}, ${notifications.workspaceId})
        AND wm."status" = 'active'
        AND wm."deletedAt" IS NULL
    )`,
  );

/**
 * One page of a user's notifications, newest first, with what the UI needs
 * to render them in the same query.
 *
 * Keyset pagination on id: the cursor is the publicId of the last item of
 * the previous page, resolved in a subquery, so internal ids never leave the
 * server. `id` is the rowid, so SQLite walks the (userId, deletedAt) index in
 * id order without sorting.
 */
export const listForUser = async (
  db: dbClient,
  args: { userId: string; limit: number; cursor?: string | null },
) => {
  const actor = alias(users, "actor");

  const rows = await db
    .select({
      publicId: notifications.publicId,
      type: notifications.type,
      createdAt: notifications.createdAt,
      readAt: notifications.readAt,
      cardPublicId: cards.publicId,
      cardTitle: cards.title,
      boardName: boards.name,
      workspaceName: workspaces.name,
      actorName: actor.name,
      actorEmail: actor.email,
    })
    .from(notifications)
    .leftJoin(cards, eq(cards.id, notifications.cardId))
    .leftJoin(lists, eq(lists.id, cards.listId))
    .leftJoin(boards, eq(boards.id, lists.boardId))
    .leftJoin(
      workspaces,
      eq(
        workspaces.id,
        sql`COALESCE(${boards.workspaceId}, ${notifications.workspaceId})`,
      ),
    )
    .leftJoin(comments, eq(comments.id, notifications.commentId))
    .leftJoin(actor, eq(actor.id, comments.createdBy))
    .where(
      and(
        visibleTo(args.userId),
        args.cursor
          ? lt(
              notifications.id,
              sql`(SELECT id FROM notification WHERE "publicId" = ${args.cursor} AND "userId" = ${args.userId})`,
            )
          : undefined,
      ),
    )
    .orderBy(desc(notifications.id))
    .limit(args.limit + 1);

  const hasMore = rows.length > args.limit;
  const items = hasMore ? rows.slice(0, args.limit) : rows;
  return {
    items,
    nextCursor: hasMore ? (items[items.length - 1]?.publicId ?? null) : null,
  };
};

/** Unread notifications the user can see (same rules as listForUser). */
export const getVisibleUnreadCount = async (db: dbClient, userId: string) => {
  const [result] = await db
    .select({ count: count() })
    .from(notifications)
    .leftJoin(cards, eq(cards.id, notifications.cardId))
    .leftJoin(lists, eq(lists.id, cards.listId))
    .leftJoin(boards, eq(boards.id, lists.boardId))
    .where(and(visibleTo(userId), isNull(notifications.readAt)));

  return result?.count ?? 0;
};

/** Marks the given notifications read, only if they belong to the user. */
export const markAsReadForUser = async (
  db: dbClient,
  args: { userId: string; publicIds: string[] },
) => {
  if (args.publicIds.length === 0) return 0;
  const updated = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.userId, args.userId),
        inArray(notifications.publicId, args.publicIds),
        isNull(notifications.readAt),
      ),
    )
    .returning({ publicId: notifications.publicId });
  return updated.length;
};

export const markAllAsReadForUser = async (db: dbClient, userId: string) => {
  const updated = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
        isNull(notifications.deletedAt),
      ),
    )
    .returning({ publicId: notifications.publicId });
  return updated.length;
};
