import { buildPushPayload } from "@block65/webcrypto-web-push";

import type { dbClient } from "@kan/db/client";
import * as notificationRepo from "@kan/db/repository/notification.repo";
import * as pushSubscriptionRepo from "@kan/db/repository/pushSubscription.repo";
import { createLogger } from "@kan/logger";

const log = createLogger("push");

/** What the service worker (apps/web/public/sw.js) receives. */
export interface PushNotificationData {
  title: string;
  body: string;
  /** Path to open when the notification is tapped, e.g. /cards/abc. */
  url: string;
  /** Notifications with the same tag replace each other on the device. */
  tag?: string;
  /** Unread count for the app icon badge. */
  badgeCount?: number;
}

/**
 * Push services browsers actually use. Subscriptions for any other host are
 * refused, so the server can't be made to POST to arbitrary URLs.
 */
const PUSH_SERVICE_HOSTS = [
  "fcm.googleapis.com", // Chrome, Edge on Android, Samsung, Opera
  "android.googleapis.com",
  ".push.services.mozilla.com", // Firefox
  ".notify.windows.com", // Edge on Windows
  ".push.apple.com", // Safari, iOS and macOS installed apps
];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  return PUSH_SERVICE_HOSTS.some((host) =>
    host.startsWith(".") ? url.hostname.endsWith(host) : url.hostname === host,
  );
}

/** An env value, or undefined when unset or blank. */
const readEnv = (name: string): string | undefined => {
  const value = process.env[name]?.trim();
  return value === "" ? undefined : value;
};

export function getVapidPublicKey(): string | null {
  return readEnv("VAPID_PUBLIC_KEY") ?? null;
}

function getVapidKeys() {
  const publicKey = readEnv("VAPID_PUBLIC_KEY");
  const privateKey = readEnv("VAPID_PRIVATE_KEY");
  // Push services need a contact: mailto: or an https URL. Apple rejects
  // localhost, so fall back to the app's own URL.
  const subject = readEnv("VAPID_SUBJECT") ?? readEnv("NEXT_PUBLIC_BASE_URL");
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

export function isPushConfigured(): boolean {
  return getVapidKeys() !== null;
}

/**
 * Sends a push to every device the user subscribed. Never throws: a failed
 * push must not fail the action that caused it. Subscriptions the push
 * service reports as gone (404/410) are deleted.
 */
export async function sendPushToUser(
  db: dbClient,
  userId: string,
  data: PushNotificationData,
): Promise<{ sent: number; removed: number }> {
  const vapid = getVapidKeys();
  if (!vapid) return { sent: 0, removed: 0 };

  try {
    const subscriptions = await pushSubscriptionRepo.getAllForUser(db, userId);
    if (subscriptions.length === 0) return { sent: 0, removed: 0 };

    const payload: PushNotificationData = {
      ...data,
      badgeCount:
        data.badgeCount ??
        (await notificationRepo.getVisibleUnreadCount(db, userId)),
    };

    const gone: number[] = [];
    let sent = 0;
    await Promise.all(
      subscriptions.map(async (subscription) => {
        if (!isAllowedPushEndpoint(subscription.endpoint)) {
          gone.push(subscription.id);
          return;
        }
        try {
          const request = await buildPushPayload(
            {
              data: { ...payload },
              // Keep undelivered pushes for a day; mentions are worth
              // showing when the phone comes back online.
              options: { ttl: 24 * 60 * 60, urgency: "high" },
            },
            {
              endpoint: subscription.endpoint,
              expirationTime: null,
              keys: { p256dh: subscription.p256dh, auth: subscription.auth },
            },
            vapid,
          );
          const response = await fetch(subscription.endpoint, request);
          if (response.status === 404 || response.status === 410) {
            gone.push(subscription.id);
          } else if (!response.ok) {
            log.warn(
              {
                status: response.status,
                host: new URL(subscription.endpoint).hostname,
                body: (await response.text()).slice(0, 200),
              },
              "Push service rejected a push",
            );
          } else {
            sent++;
          }
        } catch (error) {
          log.error(
            { err: error, host: new URL(subscription.endpoint).hostname },
            "Failed to send push",
          );
        }
      }),
    );

    await pushSubscriptionRepo.deleteByIds(db, gone);
    return { sent, removed: gone.length };
  } catch (error) {
    log.error({ err: error, userId }, "Failed to send pushes");
    return { sent: 0, removed: 0 };
  }
}
