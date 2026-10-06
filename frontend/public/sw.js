// Service worker mínimo: sirve para que la app sea instalable y muestra una
// página propia si se abre sin conexión. NO guarda en caché nada de /api ni
// de las páginas de la app: son datos financieros y siempre vienen de la red.
// Si cambias offline.html, sube la versión: así el service worker nuevo vuelve a guardarlo.
const CACHE = "sueldia-offline-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" }))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // Solo navegaciones: el resto (API, scripts, estilos, imágenes) sigue su camino normal.
  if (request.mode !== "navigate") return;
  event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL).then((res) => res ?? Response.error())));
});
