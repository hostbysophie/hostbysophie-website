const CACHE = "hbs-meeting-v2";
const ASSETS = ["./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(ASSETS.map(a => c.add(a))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  // Only handle same-origin GET requests — never API calls
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  e.respondWith((async () => {
    try {
      // 1. Try network first (always fresh)
      const res = await fetch(e.request);
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      }
      return res;
    } catch (err) {
      // 2. Offline → try exact cache match (ignore query string)
      const hit = await caches.match(e.request, { ignoreSearch: true });
      if (hit) return hit;
      // 3. Navigation → serve cached app shell
      const shell = await caches.match("./index.html");
      if (shell) return shell;
      // 4. Last resort: never return undefined
      return new Response("Hors ligne — ouvrez l'app avec une connexion internet.", {
        status: 503,
        headers: { "Content-Type": "text/plain;charset=utf-8" }
      });
    }
  })());
});
