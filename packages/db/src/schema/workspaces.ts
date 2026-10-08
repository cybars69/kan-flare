import { relations } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

import { workspacePlans } from "@kan/shared/utils";

import { boards } from "./boards";
import { workspaceMemberPermissions, workspaceRoles } from "./permissions";
import { subscription } from "./subscriptions";
import { users } from "./users";

export const memberRoles = ["admin", "member", "guest"] as const;
export type MemberRole = (typeof memberRoles)[number];

export const memberStatuses = [
  "invited",
  "active",
  "removed",
  "paused",
] as const;
export type MemberStatus = (typeof memberStatuses)[number];

export const slugTypes = ["reserved", "premium"] as const;
export type SlugType = (typeof slugTypes)[number];

export type { WorkspacePlan } from "@kan/shared/utils";
export { workspacePlans };

export const workspaces = sqliteTable(
  "workspace",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    publicId: text("publicId", { length: 12 }).notNull().unique(),
    name: text("name", { length: 255 }).notNull(),
    description: text("description"),
    slug: text("slug", { length: 255 }).notNull().unique(),
    plan: text("plan", { enum: workspacePlans }).notNull().default("free"),
    showEmailsToMembers: integer("showEmailsToMembers", { mode: "boolean" }).notNull().default(true),
    weekStartDay: integer("weekStartDay").notNull().default(1),
    cardPrefix: text("cardPrefix", { length: 10 }).notNull().default(""),
    cardCounter: integer("cardCounter").notNull().default(0),
    createdBy: text("createdBy").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).$defaultFn(() => new Date()).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }),
    deletedAt: integer("deletedAt", { mode: "timestamp_ms" }),
    deletedBy: text("deletedBy").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (table) => [index("workspace_card_prefix_idx").on(table.cardPrefix)],
);

export const workspaceRelations = relations(workspaces, ({ one, many }) => ({
  user: one(users, {
    fields: [workspaces.createdBy],
    references: [users.id],
    relationName: "workspaceCreatedByUser",
  }),
  deletedBy: one(users, {
    fields: [workspaces.deletedBy],
    references: [users.id],
    relationName: "workspaceDeletedByUser",
  }),
  members: many(workspaceMembers),
  boards: many(boards),
  subscriptions: many(subscription),
  roles: many(workspaceRoles),
}));

export const workspaceMembers = sqliteTable("workspace_members", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  publicId: text("publicId", { length: 12 }).notNull().unique(),
  email: text("email", { length: 255 }).notNull(),
  userId: text("userId").references(() => users.id, { onDelete: "set null" }),
  workspaceId: integer("workspaceId")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  createdBy: text("createdBy").notNull(),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).$defaultFn(() => new Date()).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }),
  deletedAt: integer("deletedAt", { mode: "timestamp_ms" }),
  deletedBy: text("deletedBy").references(() => users.id, {
    onDelete: "set null",
  }),
  // Legacy role enum
  role: text("role", { enum: memberRoles }).notNull(),
  roleId: integer("roleId").references(
    () => workspaceRoles.id,
    { onDelete: "restrict" },
  ),
  status: text("status", { enum: memberStatuses }).default("invited").notNull(),
}, (table) => [
  // Membership lookups by user (notification visibility, access checks).
  index("workspace_members_user_workspace_idx").on(
    table.userId,
    table.workspaceId,
  ),
]);

export const workspaceMembersRelations = relations(
  workspaceMembers,
  ({ one, many }) => ({
    user: one(users, {
      fields: [workspaceMembers.userId],
      references: [users.id],
      relationName: "workspaceMembersUser",
    }),
    workspace: one(workspaces, {
      fields: [workspaceMembers.workspaceId],
      references: [workspaces.id],
      relationName: "workspaceMembersWorkspace",
    }),
    workspaceRole: one(workspaceRoles, {
      fields: [workspaceMembers.roleId],
      references: [workspaceRoles.id],
      relationName: "workspaceMemberRole",
    }),
    permissions: many(workspaceMemberPermissions),
  }),
);

export const workspaceMemberPermissionsRelations = relations(
  workspaceMemberPermissions,
  ({ one }) => ({
    member: one(workspaceMembers, {
      fields: [workspaceMemberPermissions.workspaceMemberId],
      references: [workspaceMembers.id],
      relationName: "memberPermissions",
    }),
  }),
);

export const slugs = sqliteTable("workspace_slugs", {
  slug: text("slug", { length: 255 }).notNull().unique(),
  type: text("type", { enum: slugTypes }).notNull(),
});

export const slugChecks = sqliteTable("workspace_slug_checks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug", { length: 255 }).notNull(),
  available: integer("available", { mode: "boolean" }).notNull(),
  reserved: integer("reserved", { mode: "boolean" }).notNull(),
  workspaceId: integer("workspaceId").references(
    () => workspaces.id,
  ),
  createdBy: text("createdBy").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).$defaultFn(() => new Date()).notNull(),
});
