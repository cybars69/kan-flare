import { relations } from "drizzle-orm";
import {
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

import { apikey } from "./auth";
import { boards, userBoardFavorites } from "./boards";
import { cards } from "./cards";
import { imports } from "./imports";
import { lists } from "./lists";
import { workspaceMembers, workspaces } from "./workspaces";
import { integrations } from "./integrations";

export const users = sqliteTable("user", {
  id: text("id")
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name", { length: 255 }),
  email: text("email", { length: 255 }).notNull().unique(),
  emailVerified: integer("emailVerified", { mode: "boolean" }).notNull(),
  image: text("image", { length: 255 }),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  stripeCustomerId: text("stripeCustomerId", { length: 255 }),
});

export const usersRelations = relations(users, ({ many }) => ({
  deletedBoards: many(boards, {
    relationName: "boardDeletedByUser",
  }),
  boards: many(boards, {
    relationName: "boardCreatedByUser",
  }),
  deletedCards: many(cards, {
    relationName: "cardsDeletedByUser",
  }),
  cards: many(cards, {
    relationName: "cardsCreatedByUser",
  }),
  imports: many(imports),
  deletedLists: many(lists, {
    relationName: "listsDeletedByUser",
  }),
  lists: many(lists, {
    relationName: "listsCreatedByUser",
  }),
  deletedWorkspaces: many(workspaces, {
    relationName: "workspaceDeletedByUser",
  }),
  workspaces: many(workspaces, {
    relationName: "workspaceCreatedByUser",
  }),
  apiKeys: many(apikey),
  integrations: many(integrations),
}));

export const usersToWorkspacesRelations = relations(
  workspaceMembers,
  ({ one }) => ({
    addedBy: one(users, {
      fields: [workspaceMembers.createdBy],
      references: [users.id],
      relationName: "usersToWorkspacesAddedByUser",
    }),
    deletedBy: one(users, {
      fields: [workspaceMembers.deletedBy],
      references: [users.id],
      relationName: "usersToWorkspacesDeletedByUser",
    }),
    user: one(users, {
      fields: [workspaceMembers.userId],
      references: [users.id],
      relationName: "usersToWorkspacesUser",
    }),
    workspace: one(workspaces, {
      fields: [workspaceMembers.workspaceId],
      references: [workspaces.id],
      relationName: "usersToWorkspacesWorkspace",
    }),
  }),
);

export const userBoardFavoritesRelations = relations(userBoardFavorites, ({ one }) => ({
  user: one(users, {
    fields: [userBoardFavorites.userId],
    references: [users.id],
  }),
  board: one(boards, {
    fields: [userBoardFavorites.boardId],
    references: [boards.id],
  }),
}));