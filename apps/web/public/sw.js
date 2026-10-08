/* kan-flare service worker: push notifications only, no caching. */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

const setBadge = (count) => {
  if (typeof count !== "number") return Promise.resolve();
  try {
    if (count > 0 && self.navigator.setAppBadge) {
      return self.navigator.setAppBadge(count).catch(() => undefined);
    }
    if (count === 0 && self.navigator.clearAppBadge) {
      return self.navigator.clearAppBadge().catch(() => undefined);
    }
  } catch {
    // Badging isn't supported here.
  }
  return Promise.resolve();
};

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "kan-flare";
  // Safari requires every push to show a notification, so always show one.
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, {
        body: data.body || "",
        tag: data.tag,
        renotify: Boolean(data.tag),
        icon: "/icon-512.png",
        data: { url: data.url || "/" },
      }),
      setBadge(data.badgeCount),
    ]),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(
    (event.notification.data && event.notification.data.url) || "/",
    self.location.origin,
  );
  // Only ever open pages of this app.
  if (url.origin !== self.location.origin) return;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of windows) {
        if (new URL(client.url).origin !== url.origin) continue;
        await client.focus();
        if ("navigate" in client) {
          try {
            await client.navigate(url.href);
            return;
          } catch {
            // The page isn't controlled by this worker; ask it to navigate.
          }
        }
        client.postMessage({ type: "kan:navigate", url: url.pathname + url.search });
        return;
      }
      await self.clients.openWindow(url.href);
    })(),
  );
});
