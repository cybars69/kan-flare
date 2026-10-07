import { relations } from "drizzle-orm";
import {
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

import { workspaces } from "./workspaces";

export const subscription = sqliteTable("subscription", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  plan: text("plan", { length: 255 }).notNull(),
  referenceId: text("referenceId", { length: 12 }).references(
    () => workspaces.publicId,
    { onDelete: "set null" },
  ),
  stripeCustomerId: text("stripeCustomerId", { length: 255 }),
  stripeSubscriptionId: text("stripeSubscriptionId", { length: 255 }),
  status: text("status", { length: 255 }).notNull(),
  periodStart: integer("periodStart", { mode: "timestamp_ms" }),
  periodEnd: integer("periodEnd", { mode: "timestamp_ms" }),
  cancelAtPeriodEnd: integer("cancelAtPeriodEnd", { mode: "boolean" }),
  seats: integer("seats"),
  unlimitedSeats: integer("unlimitedSeats", { mode: "boolean" }).default(false).notNull(),
  trialStart: integer("trialStart", { mode: "timestamp_ms" }),
  trialEnd: integer("trialEnd", { mode: "timestamp_ms" }),
  partnerLicenseKey: text("partnerLicenseKey", { length: 255 }),
  partnerTier: integer("partnerTier"),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const subscriptionsRelations = relations(subscription, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [subscription.referenceId],
    references: [workspaces.publicId],
  }),
}));
