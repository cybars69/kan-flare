import { generateKeyPairSync, randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { AuthPage } from "../support/pages/auth-page";
import { DashboardPage } from "../support/pages/dashboard-page";
import { SelfHostedOnboardingPage } from "../support/pages/self-hosted-onboarding-page";
import { createTestUser } from "../support/test-user";
import { waitForTrpcMutation } from "../support/wait-for-trpc";

async function signUp(page: Page) {
  const user = createTestUser();
  await new AuthPage(page).signUp(user);
  await new SelfHostedOnboardingPage(page).createFirstWorkspace(
    "Push Workspace",
  );
  return user;
}

// Playwright's default headless shell reports notification permission as
// denied and can't show notifications; Chromium's full headless mode can.
test.use({ channel: "chromium" });

const originOf = (baseURL: string | undefined) => {
  if (!baseURL) throw new Error("baseURL is not configured");
  return new URL(baseURL).origin;
};

const serviceWorkerReady = (page: Page) =>
  page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return registration.active?.scriptURL ?? null;
  });

test(
  "the service worker shows a pushed notification",
  { tag: "@self-hosted" },
  async ({ page, context, baseURL }) => {
    const origin = originOf(baseURL);
    await context.grantPermissions(["notifications"], { origin });
    await signUp(page);

    expect(await serviceWorkerReady(page)).toBe(`${origin}/sw.js`);
    const sw = await page.request.get("/sw.js");
    expect(sw.headers()["cache-control"]).toBe("no-cache");

    const cdp = await context.newCDPSession(page);
    const registrationId = new Promise<string>((resolve) => {
      cdp.on("ServiceWorker.workerRegistrationUpdated", ({ registrations }) => {
        const match = registrations.find(
          (r: { scopeURL: string; isDeleted: boolean }) =>
            r.scopeURL === `${origin}/` && !r.isDeleted,
        );
        if (match) resolve(match.registrationId);
      });
    });
    await cdp.send("ServiceWorker.enable");
    await cdp.send("ServiceWorker.deliverPushMessage", {
      origin,
      registrationId: await registrationId,
      data: JSON.stringify({
        title: "Ada mentioned you",
        body: "Launch · Roadmap",
        url: "/cards/abcdefghijkl",
        tag: "mention-abcdefghijkl",
        badgeCount: 3,
      }),
    });

    await expect
      .poll(() =>
        page.evaluate(async () => {
          const registration = await navigator.serviceWorker.ready;
          const shown = await registration.getNotifications();
          return shown.map((n) => ({
            title: n.title,
            body: n.body,
            tag: n.tag,
            url: (n.data as { url?: string } | null)?.url,
          }));
        }),
      )
      .toEqual([
        {
          title: "Ada mentioned you",
          body: "Launch · Roadmap",
          tag: "mention-abcdefghijkl",
          url: "/cards/abcdefghijkl",
        },
      ]);
  },
);

test(
  "outside the installed app the bell explains how to get push",
  { tag: "@self-hosted" },
  async ({ page }) => {
    await signUp(page);
    await page.getByRole("button", { name: /^Notifications/ }).click();
    await expect(
      page.getByText(
        "Install kan-flare as an app to get push notifications on this device.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("switch", { name: "Push notifications on this device" }),
    ).toHaveCount(0);
  },
);

test(
  "in the installed app push can be turned on and off, and logout unsubscribes",
  { tag: "@self-hosted" },
  async ({ page, context, baseURL }) => {
    await context.grantPermissions(["notifications"], {
      origin: originOf(baseURL),
    });

    // A browser subscription the push service would hand out. Headless
    // Chromium has no push service, so subscribe() is stood in for; the
    // rest (permission, worker, API, UI) is real.
    const deviceKey = generateKeyPairSync("ec", {
      namedCurve: "P-256",
    }).publicKey.export({ format: "jwk" });
    const fake = {
      endpoint: `https://fcm.googleapis.com/fcm/send/e2e-${Date.now()}`,
      p256dh: Buffer.concat([
        Buffer.from([4]),
        Buffer.from(deviceKey.x ?? "", "base64url"),
        Buffer.from(deviceKey.y ?? "", "base64url"),
      ]).toString("base64url"),
      auth: randomBytes(16).toString("base64url"),
    };
    await page.addInitScript((sub) => {
      const realMatchMedia = window.matchMedia.bind(window);
      window.matchMedia = (query: string) =>
        query === "(display-mode: standalone)"
          ? ({ ...realMatchMedia(query), matches: true } as MediaQueryList)
          : realMatchMedia(query);

      let current: PushSubscription | null = null;
      PushManager.prototype.getSubscription = () => Promise.resolve(current);
      PushManager.prototype.subscribe = function (options) {
        current = {
          endpoint: sub.endpoint,
          expirationTime: null,
          options: options as PushSubscriptionOptions,
          getKey: () => null,
          toJSON: () => ({
            endpoint: sub.endpoint,
            expirationTime: null,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          }),
          unsubscribe: () => {
            current = null;
            return Promise.resolve(true);
          },
        } as unknown as PushSubscription;
        return Promise.resolve(current);
      };
    }, fake);

    const user = await signUp(page);
    const bell = page.getByRole("button", { name: /^Notifications/ });
    const toggle = page.getByRole("switch", {
      name: "Push notifications on this device",
    });

    await bell.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");

    const subscribed = waitForTrpcMutation(page, "push.subscribe");
    await toggle.click();
    expect((await subscribed).ok()).toBe(true);
    await expect(toggle).toHaveAttribute("aria-checked", "true");

    const unsubscribed = waitForTrpcMutation(page, "push.unsubscribe");
    await toggle.click();
    expect((await unsubscribed).ok()).toBe(true);
    await expect(toggle).toHaveAttribute("aria-checked", "false");

    // Turn it back on, then log out: the device is unsubscribed first.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    const removedOnLogout = waitForTrpcMutation(page, "push.unsubscribe");
    await new DashboardPage(page).logOut(user);
    expect((await removedOnLogout).ok()).toBe(true);
  },
);
