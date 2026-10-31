const CACHE_PREFIX = "veil-privacy-redactor-";
const CACHE_NAME = `${CACHE_PREFIX}v2.0.0`;
const APP_SHELL = [
  "./",
  "./index.html",
  "./guide.html",
  "./manifest.webmanifest",
  "./assets/styles.css",
  "./assets/app.js",
  "./assets/guide.js",
  "./assets/lucide.min.js",
  "./assets/icon.svg",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/demo-qr.png",
  "./assets/vendor/tf.min.js",
  "./assets/vendor/blazeface.min.umd.js",
  "./assets/vendor/jsqr.js",
  "./assets/vendor/tesseract.min.js",
  "./assets/vendor/tesseract/worker.min.js",
  "./assets/vendor/tesseract/eng.traineddata",
  "./assets/vendor/tesseract/chi_sim.traineddata",
  "./assets/vendor/tesseract/tesseract-core-simd-lstm.wasm.js",
  "./assets/vendor/tesseract/tesseract-core-lstm.wasm.js",
  "./assets/models/blazeface/model.json",
  "./assets/models/blazeface/group1-shard1of1.bin?v=1",
  "./src/redaction.js",
];

const CACHE_FIRST_PREFIXES = [
  "./assets/vendor/",
  "./assets/models/",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.href.startsWith(self.registration.scope)) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const pageUrl = new URL(url.pathname, self.location.origin).href;
        try {
          const response = await fetch(event.request);
          if (response.ok) await cache.put(pageUrl, response.clone()).catch(() => {});
          return response;
        } catch {
          return (await cache.match(pageUrl)) || (await cache.match("./index.html")) || Response.error();
        }
      })(),
    );
    return;
  }

  const isCacheFirst = CACHE_FIRST_PREFIXES.some((prefix) =>
    event.request.url.includes(prefix.replace("./", "/")),
  );
  if (isCacheFirst) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(event.request);
        if (cached) return cached;
        try {
          const response = await fetch(event.request);
          if (response.ok) await cache.put(event.request, response.clone()).catch(() => {});
          return response;
        } catch { return Response.error(); }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(event.request);
        if (response.ok) await cache.put(event.request, response.clone()).catch(() => {});
        return response;
      } catch { return (await cache.match(event.request)) || Response.error(); }
    })(),
  );
});
