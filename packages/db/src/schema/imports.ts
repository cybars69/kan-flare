import { relations } from "drizzle-orm";
import {
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

import { boards } from "./boards";
import { cards } from "./cards";
import { labels } from "./labels";
import { lists } from "./lists";
import { users } from "./users";

export const importSourceValues = ["trello", "github"] as const;
export const importStatusValues = [
  "started",
  "success",
  "failed",
] as const;

export const imports = sqliteTable("import", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  publicId: text("publicId", { length: 12 }).notNull().unique(),
  source: text("source", { enum: importSourceValues }).notNull(),
  status: text("status", { enum: importStatusValues }).notNull(),
  createdBy: text("createdBy").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).$defaultFn(() => new Date()).notNull(),
});

export const importsRelations = relations(imports, ({ one, many }) => ({
  createdBy: one(users, {
    fields: [imports.createdBy],
    references: [users.id],
    relationName: "importsCreatedByUser",
  }),
  boards: many(boards),
  cards: many(cards),
  lists: many(lists),
  labels: many(labels),
}));
