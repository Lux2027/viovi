/* Viovi Service Worker: macht die App offline startbar.
   Strategie: erst Netz (immer aktuell), bei fehlendem Netz der Zwischenspeicher. */
const CACHE = 'viovi-v6';
const FILES = ['./', 'index.html', 'style.css?v=5', 'config.js?v=5', 'parser.js?v=5', 'app.js?v=5', 'cloud.js?v=5', 'hilfe.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('index.html')))
  );
});
// Klick auf eine Benachrichtigung öffnet die App
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((list) => list.length ? list[0].focus() : self.clients.openWindow('./')));
});
