const CACHE_NAME = "veil-privacy-redactor-v1.2.1";
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
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(async () => (await caches.match(event.request)) || caches.match("./index.html")),
    );
    return;
  }

  const isCacheFirst = CACHE_FIRST_PREFIXES.some((prefix) =>
    event.request.url.includes(prefix.replace("./", "/")),
  );
  if (isCacheFirst) {
    event.respondWith(
      caches.match(event.request).then(
        (cached) =>
          cached ||
          fetch(event.request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});
