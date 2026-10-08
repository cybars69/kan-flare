import { TRPCError } from "@trpc/server";
import { z } from "zod";

import * as notificationRepo from "@kan/db/repository/notification.repo";
import { notificationTypes } from "@kan/db/schema";

import { createTRPCRouter, protectedProcedure } from "../trpc";

const notificationSchema = z.object({
  publicId: z.string(),
  type: z.enum(notificationTypes),
  createdAt: z.date(),
  readAt: z.date().nullable(),
  cardPublicId: z.string().nullable(),
  cardTitle: z.string().nullable(),
  boardName: z.string().nullable(),
  workspaceName: z.string().nullable(),
  actorName: z.string().nullable(),
  actorEmail: z.string().nullable(),
});

const requireUserId = (userId: string | undefined) => {
  if (!userId)
    throw new TRPCError({
      message: `User not authenticated`,
      code: "UNAUTHORIZED",
    });
  return userId;
};

export const notificationRouter = createTRPCRouter({
  list: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/notifications",
        summary: "List notifications",
        description:
          "The signed-in user's notifications, newest first. Pass nextCursor back as cursor for the next page.",
        tags: ["Notifications"],
        protect: true,
      },
    })
    .input(
      z.object({
        limit: z.number().int().min(1).max(50).default(20),
        cursor: z.string().length(12).nullish(),
      }),
    )
    .output(
      z.object({
        items: z.array(notificationSchema),
        nextCursor: z.string().nullable(),
      }),
    )
    .query(async ({ ctx, input }) =>
      notificationRepo.listForUser(ctx.db, {
        userId: requireUserId(ctx.user?.id),
        limit: input.limit,
        cursor: input.cursor,
      }),
    ),
  unreadCount: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/notifications/unread-count",
        summary: "Count unread notifications",
        description: "The number of unread notifications for the badge.",
        tags: ["Notifications"],
        protect: true,
      },
    })
    .input(z.void())
    .output(z.object({ count: z.number() }))
    .query(async ({ ctx }) => ({
      count: await notificationRepo.getVisibleUnreadCount(
        ctx.db,
        requireUserId(ctx.user?.id),
      ),
    })),
  markRead: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/notifications/read",
        summary: "Mark notifications read",
        description: "Marks the given notifications as read.",
        tags: ["Notifications"],
        protect: true,
      },
    })
    .input(
      z.object({ publicIds: z.array(z.string().length(12)).min(1).max(50) }),
    )
    .output(z.object({ updated: z.number() }))
    .mutation(async ({ ctx, input }) => ({
      updated: await notificationRepo.markAsReadForUser(ctx.db, {
        userId: requireUserId(ctx.user?.id),
        publicIds: input.publicIds,
      }),
    })),
  markAllRead: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/notifications/read-all",
        summary: "Mark all notifications read",
        description: "Marks every unread notification as read.",
        tags: ["Notifications"],
        protect: true,
      },
    })
    .input(z.void())
    .output(z.object({ updated: z.number() }))
    .mutation(async ({ ctx }) => ({
      updated: await notificationRepo.markAllAsReadForUser(
        ctx.db,
        requireUserId(ctx.user?.id),
      ),
    })),
});
