import { relations } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

import { cards } from "./cards";
import { users } from "./users";

export const checklists = sqliteTable("card_checklist", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  publicId: text("publicId", { length: 12 }).notNull().unique(),
  name: text("name", { length: 255 }).notNull(),
  index: integer("index").notNull(),
  cardId: integer("cardId")
    .notNull()
    .references(() => cards.id, { onDelete: "cascade" }),
  createdBy: text("createdBy").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).$defaultFn(() => new Date()).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }),
  deletedAt: integer("deletedAt", { mode: "timestamp_ms" }),
  deletedBy: text("deletedBy").references(() => users.id, {
    onDelete: "set null",
  }),
}, (table) => [
  index("card_checklist_card_index_idx").on(table.cardId, table.index),
]);

export const checklistsRelations = relations(checklists, ({ one, many }) => ({
  card: one(cards, {
    fields: [checklists.cardId],
    references: [cards.id],
    relationName: "checklistsCard",
  }),
  createdBy: one(users, {
    fields: [checklists.createdBy],
    references: [users.id],
    relationName: "checklistsCreatedByUser",
  }),
  deletedBy: one(users, {
    fields: [checklists.deletedBy],
    references: [users.id],
    relationName: "checklistsDeletedByUser",
  }),
  items: many(checklistItems),
}));

export const checklistItems = sqliteTable("card_checklist_item", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  publicId: text("publicId", { length: 12 }).notNull().unique(),
  title: text("title", { length: 500 }).notNull(),
  completed: integer("completed", { mode: "boolean" }).notNull().default(false),
  index: integer("index").notNull(),
  checklistId: integer("checklistId")
    .notNull()
    .references(() => checklists.id, { onDelete: "cascade" }),
  createdBy: text("createdBy").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).$defaultFn(() => new Date()).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }),
  deletedAt: integer("deletedAt", { mode: "timestamp_ms" }),
  deletedBy: text("deletedBy").references(() => users.id, {
    onDelete: "set null",
  }),
}, (table) => [
  index("card_checklist_item_checklist_index_idx").on(
    table.checklistId,
    table.index,
  ),
]);

export const checklistItemsRelations = relations(checklistItems, ({ one }) => ({
  checklist: one(checklists, {
    fields: [checklistItems.checklistId],
    references: [checklists.id],
    relationName: "checklistItemsChecklist",
  }),
  createdBy: one(users, {
    fields: [checklistItems.createdBy],
    references: [users.id],
    relationName: "checklistItemsCreatedByUser",
  }),
  deletedBy: one(users, {
    fields: [checklistItems.deletedBy],
    references: [users.id],
    relationName: "checklistItemsDeletedByUser",
  }),
}));
