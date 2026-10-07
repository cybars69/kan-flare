import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { imports } from "./imports";
import { labels } from "./labels";
import { lists } from "./lists";
import { users } from "./users";
import { workspaces } from "./workspaces";

export const boardVisibilityStatuses = ["private", "public"] as const;
export type BoardVisibilityStatus = (typeof boardVisibilityStatuses)[number];

export const boardTypes = ["regular", "template"] as const;
export type BoardType = (typeof boardTypes)[number];

export const boards = sqliteTable(
  "board",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    publicId: text("publicId", { length: 12 }).notNull().unique(),
    name: text("name", { length: 255 }).notNull(),
    description: text("description"),
    slug: text("slug", { length: 255 }).notNull(),
    createdBy: text("createdBy").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).$defaultFn(() => new Date()).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }),
    deletedAt: integer("deletedAt", { mode: "timestamp_ms" }),
    deletedBy: text("deletedBy").references(() => users.id, {
      onDelete: "set null",
    }),
    importId: integer("importId").references(
      () => imports.id,
    ),
    workspaceId: integer("workspaceId")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    visibility: text("visibility", { enum: boardVisibilityStatuses }).notNull().default("private"),
    type: text("type", { enum: boardTypes }).notNull().default("regular"),
    isArchived: integer("isArchived", { mode: "boolean" }).notNull().default(false),
    sourceBoardId: integer("sourceBoardId"),
  },
  (table) => [
    index("board_is_archived_idx").on(table.isArchived),
    index("board_visibility_idx").on(table.visibility),
    index("board_type_idx").on(table.type),
    index("board_source_idx").on(table.sourceBoardId),
    uniqueIndex("unique_slug_per_workspace")
      .on(table.workspaceId, table.slug)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);

export const boardsRelations = relations(boards, ({ one, many }) => ({
  userFavorites: many(userBoardFavorites),
  createdBy: one(users, {
    fields: [boards.createdBy],
    references: [users.id],
    relationName: "boardCreatedByUser",
  }),
  lists: many(lists),
  allLists: many(lists),
  labels: many(labels),
  deletedBy: one(users, {
    fields: [boards.deletedBy],
    references: [users.id],
    relationName: "boardDeletedByUser",
  }),
  import: one(imports, {
    fields: [boards.importId],
    references: [imports.id],
    relationName: "boardImport",
  }),
  workspace: one(workspaces, {
    fields: [boards.workspaceId],
    references: [workspaces.id],
    relationName: "boardWorkspace",
  }),
}));

export const userBoardFavorites = sqliteTable(
  "user_board_favorites",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    boardId: integer("boardId")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).$defaultFn(() => new Date()).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.boardId] }),
    userIdx: index("user_board_favorite_user_idx").on(table.userId),
    boardIdx: index("user_board_favorite_board_idx").on(table.boardId),
  }),
);