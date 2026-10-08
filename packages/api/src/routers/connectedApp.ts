import { TRPCError } from "@trpc/server";
import { z } from "zod";

import * as oauthRepo from "@kan/db/repository/oauth.repo";

import { createTRPCRouter, protectedProcedure } from "../trpc";

const requireUserId = (userId: string | undefined) => {
  if (!userId)
    throw new TRPCError({
      message: `User not authenticated`,
      code: "UNAUTHORIZED",
    });
  return userId;
};

/** The plugin stores string arrays as JSON text. */
const parseScopes = (value: string | null): string[] => {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((s): s is string => typeof s === "string")
      : [];
  } catch {
    return value.split(" ").filter(Boolean);
  }
};

const connectedAppSchema = z.object({
  clientId: z.string(),
  name: z.string().nullable(),
  uri: z.string().nullable(),
  icon: z.string().nullable(),
  scopes: z.array(z.string()),
  connectedAt: z.date().nullable(),
  updatedAt: z.date().nullable(),
});

/** Apps connected to the user's account through kan-flare's OAuth sign-in. */
export const connectedAppRouter = createTRPCRouter({
  list: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/connected-apps",
        summary: "List connected apps",
        description:
          "Apps (such as MCP clients) the signed-in user allowed to access kan-flare through OAuth.",
        tags: ["Connected apps"],
        protect: true,
      },
    })
    .input(z.void())
    .output(z.array(connectedAppSchema))
    .query(async ({ ctx }) => {
      const apps = await oauthRepo.listConnectedApps(
        ctx.db,
        requireUserId(ctx.user?.id),
      );
      return apps.map((app) => ({ ...app, scopes: parseScopes(app.scopes) }));
    }),
  disconnect: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/connected-apps/disconnect",
        summary: "Disconnect an app",
        description:
          "Removes the app's access and revokes its tokens. It has to ask again to reconnect.",
        tags: ["Connected apps"],
        protect: true,
      },
    })
    .input(z.object({ clientId: z.string().min(1).max(2048) }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const disconnected = await oauthRepo.disconnectApp(ctx.db, {
        userId: requireUserId(ctx.user?.id),
        clientId: input.clientId,
      });
      if (!disconnected)
        throw new TRPCError({
          message: "That app isn't connected",
          code: "NOT_FOUND",
        });
      return { success: true };
    }),
});
