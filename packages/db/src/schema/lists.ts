import { relations } from "drizzle-orm";
import {
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

import { boards } from "./boards";
import { cards } from "./cards";
import { imports } from "./imports";
import { users } from "./users";

export const lists = sqliteTable("list", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  publicId: text("publicId", { length: 12 }).notNull().unique(),
  name: text("name", { length: 255 }).notNull(),
  index: integer("index").notNull(),
  createdBy: text("createdBy").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).$defaultFn(() => new Date()).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }),
  deletedAt: integer("deletedAt", { mode: "timestamp_ms" }),
  deletedBy: text("deletedBy").references(() => users.id, {
    onDelete: "set null",
  }),
  boardId: integer("boardId")
    .notNull()
    .references(() => boards.id, { onDelete: "cascade" }),
  importId: integer("importId").references(() => imports.id),
});

export const listsRelations = relations(lists, ({ one, many }) => ({
  createdBy: one(users, {
    fields: [lists.createdBy],
    references: [users.id],
    relationName: "listsCreatedByUser",
  }),
  board: one(boards, {
    fields: [lists.boardId],
    references: [boards.id],
    relationName: "listsBoard",
  }),
  cards: many(cards),
  deletedBy: one(users, {
    fields: [lists.deletedBy],
    references: [users.id],
    relationName: "listsDeletedByUser",
  }),
  import: one(imports, {
    fields: [lists.importId],
    references: [imports.id],
    relationName: "listsImport",
  }),
}));
