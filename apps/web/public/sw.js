// Push-only service worker: shows notifications and opens the manage link. No fetch handler, no caching.
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    const parsed = event.data ? event.data.json() : {};
    payload = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    payload = {};
  }
  const title = typeof payload.title === "string" && payload.title ? payload.title : "BeautySpa";
  const body = typeof payload.body === "string" ? payload.body : "";
  const url = typeof payload.url === "string" ? payload.url : "/";
  event.waitUntil(self.registration.showNotification(title, { body, data: { url }, icon: "/icons/icon-192.png" }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const raw = event.notification.data && event.notification.data.url;
  let target = "/";
  if (typeof raw === "string") {
    try {
      const parsed = new URL(raw, self.location.origin);
      if (parsed.origin === self.location.origin) target = parsed.href;
    } catch {
      target = "/";
    }
  }
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => c.url === target && "focus" in c);
      return open ? open.focus() : self.clients.openWindow(target);
    }),
  );
});
