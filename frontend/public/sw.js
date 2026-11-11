// Service worker mínimo: sirve para que la app sea instalable y muestra una
// página propia si se abre sin conexión. NO guarda en caché nada de /api ni
// de las páginas de la app: son datos financieros y siempre vienen de la red.
// Si cambias offline.html, sube la versión: así el service worker nuevo vuelve a guardarlo.
const CACHE = "sueldia-offline-v3";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" }))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE && key !== SHARE_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// «Compartir con SueldIA» (Web Share Target, ver manifest): el móvil manda los
// PDF por POST a /share-target. Se dejan un momento en una caché propia y se
// abre la subida, que los recoge y la vacía al instante (son nóminas: no se
// quedan guardadas en el dispositivo).
const SHARE_CACHE = "sueldia-share";
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === "POST" && url.pathname === "/share-target") {
    event.respondWith(
      (async () => {
        try {
          const form = await event.request.formData();
          const files = form.getAll("files").filter((f) => f && typeof f === "object" && "name" in f);
          const cache = await caches.open(SHARE_CACHE);
          await Promise.all(
            files.slice(0, 20).map((file, i) =>
              cache.put(`/__shared/${Date.now()}-${i}`, new Response(file, { headers: { "Content-Type": file.type || "application/pdf", "X-File-Name": encodeURIComponent(file.name) } })),
            ),
          );
        } catch {
          // Si algo falla, se abre la subida igualmente (vacía).
        }
        return Response.redirect("/app/upload?compartido=1", 303);
      })(),
    );
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // Solo navegaciones: el resto (API, scripts, estilos, imágenes) sigue su camino normal.
  if (request.mode !== "navigate") return;
  event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL).then((res) => res ?? Response.error())));
});

// ─── Notificaciones push (alertas) ──────────────────────────────
// El backend manda { title, body, url, tag }: texto discreto, sin importes.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = data.title || "SueldIA";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "Tienes avisos nuevos.",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: data.tag || "sueldia",
      data: { url: typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/app/alerts" },
    }),
  );
});

// Al tocar el aviso: la pestaña de SueldIA que ya esté abierta, o una nueva.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/app/alerts";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) return open.focus().then((w) => (w && "navigate" in w ? w.navigate(url) : undefined));
      return self.clients.openWindow(url);
    }),
  );
});
