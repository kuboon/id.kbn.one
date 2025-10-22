const DEFAULT_TITLE = "kbn.one";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

const parsePushData = (event) => {
  if (!event.data) {
    return {};
  }
  try {
    const json = event.data.json();
    return typeof json === "object" && json !== null ? json : {};
  } catch {
    try {
      const text = event.data.text();
      return { body: text };
    } catch {
      return {};
    }
  }
};

self.addEventListener("push", (event) => {
  const data = parsePushData(event);
  const title = typeof data.title === "string" && data.title.trim()
    ? data.title
    : DEFAULT_TITLE;
  const options = {
    body: typeof data.body === "string" ? data.body : undefined,
    icon: typeof data.icon === "string" ? data.icon : undefined,
    badge: typeof data.badge === "string" ? data.badge : undefined,
    tag: typeof data.tag === "string" ? data.tag : undefined,
    requireInteraction: Boolean(data.requireInteraction),
    data: {
      ...(typeof data.data === "object" && data.data ? data.data : {}),
      url: typeof data.url === "string" ? data.url : undefined,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url;
  if (!url) {
    return;
  }
  event.waitUntil((async () => {
    const windowClients = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });
    for (const client of windowClients) {
      if (client.url === url && "focus" in client) {
        await client.focus();
        return;
      }
    }
    if (self.clients.openWindow) {
      await self.clients.openWindow(url);
    }
  })());
});

self.addEventListener("pushsubscriptionchange", (event) => {
  console.warn("Push subscription changed", event);
});
