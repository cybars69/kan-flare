import {
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

import { users } from "./users";
import { workspaces } from "./workspaces";

export const inviteLinkStatuses = ["active", "inactive"] as const;
export type InviteLinkStatus = (typeof inviteLinkStatuses)[number];

export const workspaceInviteLinks = sqliteTable("workspace_invite_links", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  publicId: text("publicId", { length: 12 }).notNull().unique(),
  workspaceId: integer("workspaceId")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  code: text("code", { length: 12 }).notNull().unique(),
  status: text("status", { enum: inviteLinkStatuses }).notNull().default("active"),
  expiresAt: integer("expiresAt", { mode: "timestamp_ms" }),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).$defaultFn(() => new Date()).notNull(),
  createdBy: text("createdBy").references(() => users.id, {
    onDelete: "set null",
  }),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }),
  updatedBy: text("updatedBy").references(() => users.id, {
    onDelete: "set null",
  }),
});
