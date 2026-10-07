import { relations } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

import { boards } from "./boards";
import { checklists } from "./checklists";
import { imports } from "./imports";
import { labels } from "./labels";
import { lists } from "./lists";
import { users } from "./users";
import { workspaceMembers } from "./workspaces";

export const activityTypes = [
  "card.created",
  "card.updated.title",
  "card.updated.description",
  "card.updated.index",
  "card.updated.list",
  "card.updated.label.added",
  "card.updated.label.removed",
  "card.updated.member.added",
  "card.updated.member.removed",
  "card.updated.comment.added",
  "card.updated.comment.updated",
  "card.updated.comment.deleted",
  // Checklist activities
  "card.updated.checklist.added",
  "card.updated.checklist.renamed",
  "card.updated.checklist.deleted",
  "card.updated.checklist.item.added",
  "card.updated.checklist.item.updated",
  "card.updated.checklist.item.completed",
  "card.updated.checklist.item.uncompleted",
  "card.updated.checklist.item.deleted",
  "card.updated.attachment.added",
  "card.updated.attachment.removed",
  "card.updated.dueDate.added",
  "card.updated.dueDate.updated",
  "card.updated.dueDate.removed",
  "card.archived",
] as const;

export type ActivityType = (typeof activityTypes)[number];


export const cards = sqliteTable(
  "card",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    publicId: text("publicId", { length: 12 }).notNull().unique(),
    title: text("title").notNull(),
    description: text("description"),
    index: integer("index").notNull(),
    cardNumber: integer("cardNumber"),
    createdBy: text("createdBy").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).$defaultFn(() => new Date()).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }),
    deletedAt: integer("deletedAt", { mode: "timestamp_ms" }),
    deletedBy: text("deletedBy").references(() => users.id, {
      onDelete: "set null",
    }),
    listId: integer("listId")
      .notNull()
      .references(() => lists.id, { onDelete: "cascade" }),
    importId: integer("importId").references(
      () => imports.id,
    ),
    dueDate: integer("dueDate", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("card_list_number_idx").on(table.listId, table.cardNumber),
  ],
);

export const cardsRelations = relations(cards, ({ one, many }) => ({
  createdBy: one(users, {
    fields: [cards.createdBy],
    references: [users.id],
    relationName: "cardsCreatedByUser",
  }),
  list: one(lists, {
    fields: [cards.listId],
    references: [lists.id],
    relationName: "cardsList",
  }),
  deletedBy: one(users, {
    fields: [cards.deletedBy],
    references: [users.id],
    relationName: "cardsDeletedByUser",
  }),
  labels: many(cardsToLabels),
  members: many(cardToWorkspaceMembers),
  import: one(imports, {
    fields: [cards.importId],
    references: [imports.id],
    relationName: "cardsImport",
  }),
  comments: many(comments),
  activities: many(cardActivities),
  checklists: many(checklists),
  attachments: many(cardAttachments),
}));

export const cardActivities = sqliteTable("card_activity", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  publicId: text("publicId", { length: 12 }).notNull().unique(),
  type: text("type", { enum: activityTypes }).notNull(),
  cardId: integer("cardId")
    .notNull()
    .references(() => cards.id, { onDelete: "cascade" }),
  fromIndex: integer("fromIndex"),
  toIndex: integer("toIndex"),
  fromListId: integer("fromListId").references(
    () => lists.id,
    { onDelete: "cascade" },
  ),
  toListId: integer("toListId").references(() => lists.id, {
    onDelete: "cascade",
  }),
  labelId: integer("labelId").references(() => labels.id, {
    onDelete: "cascade",
  }),
  workspaceMemberId: integer("workspaceMemberId").references(() => workspaceMembers.id, { onDelete: "set null" }),
  fromTitle: text("fromTitle"),
  toTitle: text("toTitle"),
  fromDescription: text("fromDescription"),
  toDescription: text("toDescription"),
  createdBy: text("createdBy").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).$defaultFn(() => new Date()).notNull(),
  commentId: integer("commentId").references(
    () => comments.id,
    { onDelete: "cascade" },
  ),
  fromComment: text("fromComment"),
  toComment: text("toComment"),
  fromDueDate: integer("fromDueDate", { mode: "timestamp_ms" }),
  toDueDate: integer("toDueDate", { mode: "timestamp_ms" }),
  sourceBoardId: integer("sourceBoardId").references(
    () => boards.id,
    { onDelete: "set null" },
  ),
  attachmentId: integer("attachmentId").references(
    () => cardAttachments.id,
    { onDelete: "cascade" },
  ),
}, (table) => [
  index("card_activity_card_created_at_idx").on(
    table.cardId,
    table.createdAt,
  ),
]);

export const cardActivitiesRelations = relations(cardActivities, ({ one }) => ({
  card: one(cards, {
    fields: [cardActivities.cardId],
    references: [cards.id],
    relationName: "cardActivitiesCard",
  }),
  fromList: one(lists, {
    fields: [cardActivities.fromListId],
    references: [lists.id],
    relationName: "cardActivitiesFromList",
  }),
  toList: one(lists, {
    fields: [cardActivities.toListId],
    references: [lists.id],
    relationName: "cardActivitiesToList",
  }),
  label: one(labels, {
    fields: [cardActivities.labelId],
    references: [labels.id],
    relationName: "cardActivitiesLabel",
  }),
  workspaceMember: one(workspaceMembers, {
    fields: [cardActivities.workspaceMemberId],
    references: [workspaceMembers.id],
    relationName: "cardActivitiesWorkspaceMember",
  }),
  user: one(users, {
    fields: [cardActivities.createdBy],
    references: [users.id],
    relationName: "cardActivitiesUser",
  }),
  member: one(workspaceMembers, {
    fields: [cardActivities.workspaceMemberId],
    references: [workspaceMembers.id],
    relationName: "cardActivitiesMember",
  }),
  comment: one(comments, {
    fields: [cardActivities.commentId],
    references: [comments.id],
    relationName: "cardActivitiesComment",
  }),
  attachment: one(cardAttachments, {
    fields: [cardActivities.attachmentId],
    references: [cardAttachments.id],
    relationName: "cardActivitiesAttachment",
  }),
}));

export const cardsToLabels = sqliteTable(
  "_card_labels",
  {
    cardId: integer("cardId")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    labelId: integer("labelId")
      .notNull()
      .references(() => labels.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.cardId, t.labelId] })],
);

export const cardToLabelsRelations = relations(cardsToLabels, ({ one }) => ({
  card: one(cards, {
    fields: [cardsToLabels.cardId],
    references: [cards.id],
    relationName: "cardToLabelsCard",
  }),
  label: one(labels, {
    fields: [cardsToLabels.labelId],
    references: [labels.id],
    relationName: "cardToLabelsLabel",
  }),
}));

export const cardToWorkspaceMembers = sqliteTable(
  "_card_workspace_members",
  {
    cardId: integer("cardId")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    workspaceMemberId: integer("workspaceMemberId")
      .notNull()
      .references(() => workspaceMembers.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.cardId, t.workspaceMemberId] })],
);

export const cardToWorkspaceMembersRelations = relations(
  cardToWorkspaceMembers,
  ({ one }) => ({
    card: one(cards, {
      fields: [cardToWorkspaceMembers.cardId],
      references: [cards.id],
      relationName: "cardToWorkspaceMembersCard",
    }),
    member: one(workspaceMembers, {
      fields: [cardToWorkspaceMembers.workspaceMemberId],
      references: [workspaceMembers.id],
      relationName: "cardToWorkspaceMembersMember",
    }),
  }),
);

export const comments = sqliteTable("card_comments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  publicId: text("publicId", { length: 12 }).notNull().unique(),
  comment: text("comment").notNull(),
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
  index("card_comments_card_id_idx").on(table.cardId),
]);

export const commentsRelations = relations(comments, ({ one }) => ({
  card: one(cards, {
    fields: [comments.cardId],
    references: [cards.id],
    relationName: "commentsCard",
  }),
  createdBy: one(users, {
    fields: [comments.createdBy],
    references: [users.id],
    relationName: "commentsCreatedByUser",
  }),
  deletedBy: one(users, {
    fields: [comments.deletedBy],
    references: [users.id],
    relationName: "commentsDeletedByUser",
  }),
}));

export const cardAttachments = sqliteTable("card_attachment", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  publicId: text("publicId", { length: 12 }).notNull().unique(),
  cardId: integer("cardId")
    .notNull()
    .references(() => cards.id, { onDelete: "cascade" }),
  filename: text("filename", { length: 255 }).notNull(),
  originalFilename: text("originalFilename", { length: 255 }).notNull(),
  contentType: text("contentType", { length: 100 }).notNull(),
  size: integer("size").notNull(),
  s3Key: text("s3Key", { length: 500 }).notNull(),
  createdBy: text("createdBy").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).$defaultFn(() => new Date()).notNull(),
  deletedAt: integer("deletedAt", { mode: "timestamp_ms" }),
}, (table) => [
  index("card_attachment_card_created_at_idx").on(
    table.cardId,
    table.createdAt,
  ),
]);

export const cardAttachmentsRelations = relations(
  cardAttachments,
  ({ one }) => ({
    card: one(cards, {
      fields: [cardAttachments.cardId],
      references: [cards.id],
      relationName: "cardAttachmentsCard",
    }),
    createdBy: one(users, {
      fields: [cardAttachments.createdBy],
      references: [users.id],
      relationName: "cardAttachmentsCreatedByUser",
    }),
  }),
);
