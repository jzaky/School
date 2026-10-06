/* Horizon service worker: offline fallback page and web push. */
/* It never caches pages, API responses or anything personal: only the static offline page and icons. */
const CACHE = "horizon-shell-v1";
const PRECACHE = ["/offline.html", "/icon-192.png", "/icon-512.png", "/badge-72.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Page navigations go to the network. Only when the network fails is the offline page shown.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || req.mode !== "navigate") return;
  event.respondWith(fetch(req).catch(() => caches.match("/offline.html").then((r) => r || Response.error())));
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = data.title || "Horizon";
  const options = {
    body: data.body || undefined,
    icon: "/icon-192.png",
    badge: "/badge-72.png",
    tag: data.tag || undefined,
    lang: data.lang || "en",
    dir: data.dir || "auto",
    data: { url: typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (new URL(w.url).origin === self.location.origin && "focus" in w) {
          return w.navigate(url).then((nw) => (nw || w).focus());
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
