import { TRPCError } from "@trpc/server";
import { z } from "zod";

import * as pushSubscriptionRepo from "@kan/db/repository/pushSubscription.repo";

import { createTRPCRouter, protectedProcedure } from "../trpc";
import { getVapidPublicKey, isAllowedPushEndpoint } from "../utils/push";

const requireUserId = (userId: string | undefined) => {
  if (!userId)
    throw new TRPCError({
      message: `User not authenticated`,
      code: "UNAUTHORIZED",
    });
  return userId;
};

const endpointSchema = z
  .string()
  .url()
  .max(2048)
  .refine(isAllowedPushEndpoint, {
    message: "Unsupported push service",
  });

// base64url keys from PushSubscription.toJSON().
const base64Url = z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/);

export const pushRouter = createTRPCRouter({
  config: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/push/config",
        summary: "Get push notification settings",
        description:
          "The VAPID public key devices subscribe with, or null when push notifications aren't configured on this server.",
        tags: ["Push"],
        protect: true,
      },
    })
    .input(z.void())
    .output(z.object({ publicKey: z.string().nullable() }))
    .query(() => ({ publicKey: getVapidPublicKey() })),
  subscribe: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/push/subscriptions",
        summary: "Subscribe a device to push notifications",
        description:
          "Saves this device's Web Push subscription. Subscribing an endpoint that already exists moves it to the signed-in user.",
        tags: ["Push"],
        protect: true,
      },
    })
    .input(
      z.object({
        endpoint: endpointSchema,
        keys: z.object({
          p256dh: base64Url.min(80).max(100),
          auth: base64Url.min(16).max(32),
        }),
      }),
    )
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await pushSubscriptionRepo.upsert(ctx.db, {
        userId: requireUserId(ctx.user?.id),
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent: ctx.headers.get("user-agent")?.slice(0, 300) ?? null,
      });
      return { success: true };
    }),
  unsubscribe: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/push/subscriptions/remove",
        summary: "Unsubscribe a device from push notifications",
        description: "Removes this device's Web Push subscription.",
        tags: ["Push"],
        protect: true,
      },
    })
    .input(z.object({ endpoint: z.string().max(2048) }))
    .output(z.object({ removed: z.number() }))
    .mutation(async ({ ctx, input }) => ({
      removed: await pushSubscriptionRepo.deleteForUser(ctx.db, {
        userId: requireUserId(ctx.user?.id),
        endpoint: input.endpoint,
      }),
    })),
});
