import { useRouter } from "next/router";
import { useCallback, useEffect, useState } from "react";

import { api } from "~/utils/api";

/** Running as the installed app (home screen / desktop app window). */
export function isInstalledApp(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    window.matchMedia("(display-mode: window-controls-overlay)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

const base64UrlToBytes = (value: string) => {
  const base64 = (value + "=".repeat((4 - (value.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
};

async function getRegistration() {
  return (
    (await navigator.serviceWorker.getRegistration("/")) ??
    (await navigator.serviceWorker.register("/sw.js", { scope: "/" }))
  );
}

/**
 * Removes this device's push subscription, here and on the server. Call
 * before signing out so the next person on the device doesn't get the
 * previous user's notifications.
 */
export async function unsubscribeThisDevice(
  removeOnServer: (endpoint: string) => Promise<unknown>,
) {
  if (!isPushSupported()) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration("/");
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return;
    await removeOnServer(subscription.endpoint).catch(() => undefined);
    await subscription.unsubscribe();
  } catch {
    // Best effort: signing out must not fail because of push.
  }
}

/** Shows the unread count on the installed app's icon, where supported. */
export function setAppBadge(count: number) {
  // Not in every browser (e.g. Firefox), whatever the DOM types say.
  if (!("setAppBadge" in navigator) || !("clearAppBadge" in navigator)) return;
  const badge =
    count > 0 ? navigator.setAppBadge(count) : navigator.clearAppBadge();
  void badge.catch(() => undefined);
}

export type PushStatus =
  | "unsupported" // no service worker / Push API (e.g. iOS Safari tab)
  | "not-installed" // supported, but not running as the installed app
  | "unconfigured" // server has no VAPID keys
  | "denied" // the user blocked notifications for this app
  | "off"
  | "on";

export function usePushNotifications() {
  const router = useRouter();
  const [installed, setInstalled] = useState(false);
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] =
    useState<NotificationPermission>("default");
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const config = api.push.config.useQuery(undefined, {
    staleTime: Infinity,
    enabled: supported,
  });
  const subscribe = api.push.subscribe.useMutation();
  const unsubscribe = api.push.unsubscribe.useMutation();
  const publicKey = config.data?.publicKey ?? null;

  // Register the worker and pick up this device's current state.
  useEffect(() => {
    const isSupported = isPushSupported();
    setSupported(isSupported);
    setInstalled(isInstalledApp());
    if (!isSupported) return;
    setPermission(Notification.permission);

    const effect = { cancelled: false };
    void (async () => {
      try {
        const registration = await getRegistration();
        const subscription = await registration.pushManager.getSubscription();
        if (!effect.cancelled) setSubscribed(Boolean(subscription));
      } catch {
        // Registration can fail in private windows; push stays off.
      }
    })();

    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; url?: string } | null;
      if (data?.type === "kan:navigate" && data.url?.startsWith("/")) {
        void router.push(data.url);
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => {
      effect.cancelled = true;
      navigator.serviceWorker.removeEventListener("message", onMessage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-send an existing subscription once per load. It keeps the server in
  // step if the browser rotated it, the server lost it, or another account
  // signed in on this device.
  const { mutate: resync } = subscribe;
  useEffect(() => {
    if (!publicKey || !subscribed || permission !== "granted") return;
    void (async () => {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      const json = subscription?.toJSON();
      if (!json?.endpoint || !json.keys?.p256dh || !json.keys.auth) return;
      resync({
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      });
    })();
  }, [publicKey, subscribed, permission, resync]);

  const enable = useCallback(async () => {
    if (!publicKey) return;
    setBusy(true);
    setError(null);
    try {
      // Must run inside the click handler: iOS only asks from a user gesture.
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== "granted") return;

      const registration = await getRegistration();
      const key = base64UrlToBytes(publicKey);
      let subscription = await registration.pushManager.getSubscription();
      // A subscription made with different server keys can't receive pushes.
      const existingKey = subscription?.options.applicationServerKey;
      if (
        subscription &&
        existingKey &&
        !new Uint8Array(existingKey).every((byte, i) => byte === key[i])
      ) {
        await subscription.unsubscribe();
        subscription = null;
      }
      subscription ??= await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      });

      const json = subscription.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
        throw new Error("Incomplete push subscription");
      }
      await subscribe.mutateAsync({
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      });
      setSubscribed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [publicKey, subscribe]);

  const disable = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await unsubscribeThisDevice((endpoint) =>
        unsubscribe.mutateAsync({ endpoint }),
      );
      setSubscribed(false);
    } finally {
      setBusy(false);
    }
  }, [unsubscribe]);

  let status: PushStatus;
  if (!supported) status = "unsupported";
  else if (!installed) status = "not-installed";
  else if (config.isSuccess && !publicKey) status = "unconfigured";
  else if (permission === "denied") status = "denied";
  else status = subscribed && permission === "granted" ? "on" : "off";

  return {
    status,
    // Hide the control until the server config is known, to avoid flicker.
    ready: !supported || !installed || config.isFetched,
    busy,
    error,
    enable,
    disable,
  };
}
