import { relations } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

import { users } from "./users";
import { workspaces } from "./workspaces";

export const webhookEvents = [
  "card.created",
  "card.updated",
  "card.moved",
  "card.deleted",
] as const;
export type WebhookEvent = (typeof webhookEvents)[number];

export const workspaceWebhooks = sqliteTable("workspace_webhooks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  publicId: text("publicId", { length: 12 }).notNull().unique(),
  workspaceId: integer("workspaceId")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name", { length: 255 }).notNull(),
  url: text("url", { length: 2048 }).notNull(),
  secret: text("secret"),
  events: text("events").notNull(), // JSON array of webhook events
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdBy: text("createdBy")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).$defaultFn(() => new Date()).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }),
}, (table) => [
  index("workspace_webhooks_workspace_idx").on(table.workspaceId),
]);

export const workspaceWebhooksRelations = relations(
  workspaceWebhooks,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [workspaceWebhooks.workspaceId],
      references: [workspaces.id],
      relationName: "workspaceWebhooksWorkspace",
    }),
    createdByUser: one(users, {
      fields: [workspaceWebhooks.createdBy],
      references: [users.id],
      relationName: "workspaceWebhooksCreatedByUser",
    }),
  }),
);
