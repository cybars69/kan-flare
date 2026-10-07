import { relations } from "drizzle-orm";
import {
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

import { boards } from "./boards";
import { cardsToLabels } from "./cards";
import { imports } from "./imports";
import { users } from "./users";

export const labels = sqliteTable("label", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  publicId: text("publicId", { length: 12 }).notNull().unique(),
  name: text("name", { length: 255 }).notNull(),
  colourCode: text("colourCode", { length: 12 }),
  createdBy: text("createdBy").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).$defaultFn(() => new Date()).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }),
  boardId: integer("boardId")
    .notNull()
    .references(() => boards.id, { onDelete: "cascade" }),
  importId: integer("importId").references(() => imports.id),
  deletedAt: integer("deletedAt", { mode: "timestamp_ms" }),
  deletedBy: text("deletedBy").references(() => users.id, {
    onDelete: "set null",
  }),
});

export const labelsRelations = relations(labels, ({ one, many }) => ({
  createdBy: one(users, {
    fields: [labels.createdBy],
    references: [users.id],
    relationName: "labelsCreatedByUser",
  }),
  deletedBy: one(users, {
    fields: [labels.deletedBy],
    references: [users.id],
    relationName: "labelsDeletedByUser",
  }),
  board: one(boards, {
    fields: [labels.boardId],
    references: [boards.id],
  }),
  cards: many(cardsToLabels),
  import: one(imports, {
    fields: [labels.importId],
    references: [imports.id],
    relationName: "labelsImport",
  }),
}));
