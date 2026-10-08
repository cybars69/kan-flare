import type { GenericOAuthUserInfo } from "better-auth/plugins/generic-oauth";
import { apiKey } from "@better-auth/api-key";
import { stripe } from "@better-auth/stripe";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { magicLink } from "better-auth/plugins/magic-link";

import type { dbClient } from "@kan/db/client";
import * as memberRepo from "@kan/db/repository/member.repo";
import * as subscriptionRepo from "@kan/db/repository/subscription.repo";
import * as userRepo from "@kan/db/repository/user.repo";
import * as workspaceRepo from "@kan/db/repository/workspace.repo";
import { sendEmail } from "@kan/email";
import { createLogger } from "@kan/logger";
import { generateUID } from "@kan/shared/utils";
import { createStripeClient } from "@kan/stripe";

import { createOAuthPlugins, isOAuthAccessToken } from "./oauth";
import { socialProvidersPlugin } from "./providers";

const log = createLogger("auth");

export function getApiKeyFromHeaders(
  headers: Headers | null | undefined,
): string | null {
  const authorization = headers?.get("authorization");
  const bearerMatch = authorization?.match(/^Bearer (.+)$/i);
  if (bearerMatch) {
    const token = bearerMatch[1] ?? null;
    // OAuth access tokens are resolved separately, not as API keys.
    return token && isOAuthAccessToken(token) ? null : token;
  }
  return headers?.get("x-api-key") ?? null;
}

async function cancelWorkspaceAccess(
  db: dbClient,
  workspacePublicId: string,
): Promise<void> {
  const workspace = await workspaceRepo.getByPublicId(db, workspacePublicId);

  if (!workspace) return;

  const preserveUserId = await memberRepo.getPreservableMemberId(
    db,
    workspace.id,
    workspace.createdBy ?? null,
  );

  let newSlug = workspace.publicId;
  if (workspace.slug !== workspace.publicId) {
    const isPublicIdAvailable = await workspaceRepo.isWorkspaceSlugAvailable(
      db,
      workspace.publicId,
      workspace.id,
    );
    if (!isPublicIdAvailable) {
      newSlug = generateUID();
    }
  }

  await Promise.all([
    preserveUserId
      ? memberRepo.pauseMembersExcept(db, workspace.id, preserveUserId)
      : memberRepo.pauseAllMembers(db, workspace.id),
    workspaceRepo.update(db, workspacePublicId, {
      plan: "free",
      slug: newSlug,
    }),
  ]);
}

export function createPlugins(db: dbClient) {
  return [
    socialProvidersPlugin(),
    ...createOAuthPlugins(),
    ...(process.env.NEXT_PUBLIC_KAN_ENV === "cloud"
      ? [
          stripe({
            stripeClient: createStripeClient(),
            stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,
            createCustomerOnSignUp: true,
            subscription: {
              enabled: true,
              plans: [
                {
                  name: "team",
                  priceId: process.env.STRIPE_TEAM_PLAN_MONTHLY_PRICE_ID!,
                  annualDiscountPriceId:
                    process.env.STRIPE_TEAM_PLAN_YEARLY_PRICE_ID!,
                },
                {
                  name: "pro",
                  priceId: process.env.STRIPE_PRO_PLAN_MONTHLY_PRICE_ID!,
                  annualDiscountPriceId:
                    process.env.STRIPE_PRO_PLAN_YEARLY_PRICE_ID!,
                },
              ],
              authorizeReference: async (data) => {
                const workspace = await workspaceRepo.getByPublicId(
                  db,
                  data.referenceId,
                );

                if (!workspace) {
                  return Promise.resolve(false);
                }

                const isUserInWorkspace = await workspaceRepo.isUserInWorkspace(
                  db,
                  data.user.id,
                  workspace.id,
                );

                return isUserInWorkspace;
              },
              getCheckoutSessionParams: () => {
                return {
                  params: {
                    allow_promotion_codes: true,
                  },
                };
              },
              onSubscriptionComplete: async ({
                subscription,
                stripeSubscription,
              }) => {
                // Set unlimited seats to true for pro plans
                if (subscription.plan === "pro") {
                  await subscriptionRepo.updateByStripeSubscriptionId(
                    db,
                    stripeSubscription.id,
                    {
                      unlimitedSeats: true,
                    },
                  );
                  log.info(
                    { subscriptionId: stripeSubscription.id },
                    "Pro subscription activated with unlimited seats",
                  );

                  const workspace = await workspaceRepo.getByPublicId(
                    db,
                    subscription.referenceId,
                  );

                  if (workspace?.id) {
                    await memberRepo.unpauseAllMembers(db, workspace.id);
                  }
                }
              },
              onSubscriptionDeleted: async ({ subscription }) => {
                await cancelWorkspaceAccess(db, subscription.referenceId);
              },
              onSubscriptionUpdate: async ({ subscription }) => {
                if (subscription.stripeSubscriptionId) {
                  await subscriptionRepo.updateByStripeSubscriptionId(
                    db,
                    subscription.stripeSubscriptionId,
                    { unlimitedSeats: subscription.plan === "pro" },
                  );
                }
              },
            },
          }),
        ]
      : []),
    apiKey({
      // Better Auth 1.7 renamed the owner column to referenceId; existing
      // keys keep using the userId column.
      schema: { apikey: { fields: { referenceId: "userId" } } },
      enableSessionForAPIKeys: true,
      customAPIKeyGetter: (ctx) => getApiKeyFromHeaders(ctx.headers),
      rateLimit: {
        enabled: true,
        timeWindow: 1000 * 60, // 1 minute
        maxRequests: 600,
      },
    }),
    magicLink({
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      sendMagicLink: async ({ email, url }) => {
        try {
          const decodedUrl = decodeURIComponent(url);
          log.info(
            { email, isInvite: decodedUrl.includes("type=invite") },
            "Sending magic link",
          );
          if (decodedUrl.includes("type=invite")) {
            let inviterName = "";
            let workspaceName = "";

            try {
              const urlObj = new URL(url);
              const callbackUrl = urlObj.searchParams.get("callbackURL");
              if (callbackUrl) {
                const callbackParams = new URL(
                  callbackUrl,
                  process.env.NEXT_PUBLIC_BASE_URL,
                ).searchParams;
                const memberPublicId = callbackParams.get("memberPublicId");

                if (memberPublicId) {
                  const member = await memberRepo.getByPublicId(
                    db,
                    memberPublicId,
                  );
                  if (member) {
                    const [workspace, inviter] = await Promise.all([
                      workspaceRepo.getById(db, member.workspaceId),
                      userRepo.getById(db, member.createdBy),
                    ]);

                    if (workspace) workspaceName = workspace.name;
                    if (inviter) inviterName = inviter.name ?? "";
                  }
                }
              }
            } catch (error) {
              log.error({ err: error }, "Failed to fetch invite details");
            }

            await sendEmail(
              email,
              workspaceName
                ? `Invitation to join the workspace ${workspaceName}`
                : "Invitation to join workspace",
              "JOIN_WORKSPACE",
              {
                magicLoginUrl: url,
                inviterName,
                workspaceName,
              },
            );
          } else {
            await sendEmail(
              email,
              process.env.NEXT_PUBLIC_WHITE_LABEL_HIDE_POWERED_BY === "true"
                ? "Sign in to your account"
                : "Sign in to kan-flare",
              "MAGIC_LINK",
              {
                magicLoginUrl: url,
              },
            );
          }
        } catch (error) {
          log.error({ err: error, email }, "Error sending magic link");
        }
      },
    }),
    // Generic OIDC provider
    ...(process.env.OIDC_CLIENT_ID &&
    process.env.OIDC_CLIENT_SECRET &&
    process.env.OIDC_DISCOVERY_URL
      ? [
          genericOAuth({
            config: [
              {
                providerId: "oidc",
                clientId: process.env.OIDC_CLIENT_ID,
                clientSecret: process.env.OIDC_CLIENT_SECRET,
                discoveryUrl: process.env.OIDC_DISCOVERY_URL,
                scopes: ["openid", "email", "profile"],
                pkce: true,
                mapProfileToUser: (profile: GenericOAuthUserInfo) => {
                  log.debug({ profile }, "OIDC profile received");
                  // Providers name these fields differently; read the ones
                  // that are strings.
                  const str = (value: unknown) =>
                    typeof value === "string" && value.trim() !== ""
                      ? value
                      : undefined;
                  const givenName = str(profile.given_name);
                  const familyName = str(profile.family_name);

                  const name =
                    str(profile.name) ??
                    str(profile.display_name) ??
                    str(profile.preferred_username) ??
                    (givenName && familyName
                      ? `${givenName} ${familyName}`.trim()
                      : (givenName ?? familyName)) ??
                    (profile.sub != null ? String(profile.sub) : "");

                  return {
                    email: str(profile.email),
                    name,
                    emailVerified: profile.email_verified === true,
                    image: str(profile.picture) ?? str(profile.avatar),
                  };
                },
              },
            ],
          }),
        ]
      : []),
  ];
}
