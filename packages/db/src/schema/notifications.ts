import { relations } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

import { cards } from "./cards";
import { comments } from "./cards";
import { users } from "./users";
import { workspaces } from "./workspaces";

export const notificationTypes = [
  "mention",
  "workspace.member.added",
  "workspace.member.removed",
  "workspace.role.changed",
] as const;

export type NotificationType = (typeof notificationTypes)[number];


export const notifications = sqliteTable(
  "notification",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    publicId: text("publicId", { length: 12 }).notNull().unique(),
    type: text("type", { enum: notificationTypes }).notNull(),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    cardId: integer("cardId").references(() => cards.id, {
      onDelete: "cascade",
    }),
    commentId: integer("commentId").references(
      () => comments.id,
      { onDelete: "cascade" },
    ),
    workspaceId: integer("workspaceId").references(
      () => workspaces.id,
      { onDelete: "cascade" },
    ),
    metadata: text("metadata"),
    readAt: integer("readAt", { mode: "timestamp_ms" }),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).$defaultFn(() => new Date()).notNull(),
    deletedAt: integer("deletedAt", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("notification_user_deleted_idx").on(table.userId, table.deletedAt),
    index("notification_user_read_deleted_idx").on(
      table.userId,
      table.readAt,
      table.deletedAt,
    ),
    index("notification_user_type_card_idx").on(
      table.userId,
      table.type,
      table.cardId,
    ),
    index("notification_user_type_workspace_idx").on(
      table.userId,
      table.type,
      table.workspaceId,
    ),
    index("notification_user_created_idx").on(table.userId, table.createdAt),
  ],
);

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, {
    fields: [notifications.userId],
    references: [users.id],
    relationName: "notificationsUser",
  }),
  card: one(cards, {
    fields: [notifications.cardId],
    references: [cards.id],
    relationName: "notificationsCard",
  }),
  comment: one(comments, {
    fields: [notifications.commentId],
    references: [comments.id],
    relationName: "notificationsComment",
  }),
  workspace: one(workspaces, {
    fields: [notifications.workspaceId],
    references: [workspaces.id],
    relationName: "notificationsWorkspace",
  }),
}));

