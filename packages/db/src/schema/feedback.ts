import { relations } from "drizzle-orm";
import {
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

import { users } from "./users";

export const feedback = sqliteTable("feedback", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  feedback: text("feedback").notNull(),
  createdBy: text("createdBy").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).$defaultFn(() => new Date()).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }),
  url: text("url").notNull(),
  reviewed: integer("reviewed", { mode: "boolean" }).default(false).notNull(),
});

export const feedbackRelations = relations(feedback, ({ one }) => ({
  createdBy: one(users, {
    fields: [feedback.createdBy],
    references: [users.id],
    relationName: "feedbackCreatedByUser",
  }),
}));
