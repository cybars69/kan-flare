import { relations } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { workspaces } from "./workspaces";

export const workspaceRoles = sqliteTable(
  "workspace_roles",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    publicId: text("publicId", { length: 12 }).notNull().unique(),
    workspaceId: integer("workspaceId")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name", { length: 64 }).notNull(),
    description: text("description", { length: 255 }),
    hierarchyLevel: integer("hierarchyLevel").notNull(),
    isSystem: integer("isSystem", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).$defaultFn(() => new Date()).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("unique_role_per_workspace").on(table.workspaceId, table.name),
    index("workspace_roles_workspace_idx").on(table.workspaceId),
  ],
);

export const workspaceRolesRelations = relations(
  workspaceRoles,
  ({ one, many }) => ({
    workspace: one(workspaces, {
      fields: [workspaceRoles.workspaceId],
      references: [workspaces.id],
      relationName: "workspaceRoles",
    }),
    permissions: many(workspaceRolePermissions),
  }),
);


export const workspaceRolePermissions = sqliteTable(
  "workspace_role_permissions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    workspaceRoleId: integer("workspaceRoleId")
      .notNull()
      .references(() => workspaceRoles.id, { onDelete: "cascade" }),
    permission: text("permission", { length: 64 }).notNull(),
    granted: integer("granted", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).$defaultFn(() => new Date()).notNull(),
  },
  (table) => [
    uniqueIndex("unique_role_permission").on(
      table.workspaceRoleId,
      table.permission,
    ),
    index("role_permissions_role_idx").on(table.workspaceRoleId),
  ],
);

export const workspaceRolePermissionsRelations = relations(
  workspaceRolePermissions,
  ({ one }) => ({
    role: one(workspaceRoles, {
      fields: [workspaceRolePermissions.workspaceRoleId],
      references: [workspaceRoles.id],
      relationName: "rolePermissions",
    }),
  }),
);

export const workspaceMemberPermissions = sqliteTable(
  "workspace_member_permissions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    workspaceMemberId: integer("workspaceMemberId").notNull(),
    permission: text("permission", { length: 64 }).notNull(),
    granted: integer("granted", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).$defaultFn(() => new Date()).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("unique_member_permission").on(
      table.workspaceMemberId,
      table.permission,
    ),
    index("permission_member_idx").on(table.workspaceMemberId),
  ],
);
