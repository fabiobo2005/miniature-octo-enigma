// APEX Service Worker — v8 (multiusuário)
const CACHE = 'apex-v8';
const PRECACHE = ['/css/app.css', '/manifest.webmanifest'];

// HTML/JS: network-first (evita servir versão antiga após deploy)
const NETWORK_FIRST = /\.(?:html|js)$|^\/$/;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
  if (e.data === 'clearCache') {
    e.waitUntil(caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))));
  }
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/')) return;        // nunca cachear API
  if (url.origin !== self.location.origin) return;     // só same-origin

  // HTML e JS → network-first (com fallback ao cache se offline)
  if (NETWORK_FIRST.test(url.pathname)) {
    e.respondWith((async () => {
      try {
        const res = await fetch(request, { cache: 'no-store' });
        if (res && res.status === 200) {
          const cache = await caches.open(CACHE);
          cache.put(request, res.clone());
        }
        return res;
      } catch {
        const cached = await caches.match(request);
        return cached || Response.error();
      }
    })());
    return;
  }

  // demais (CSS, ícones, manifest) → cache-first com revalidação
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    const network = fetch(request).then(res => {
      if (res && res.status === 200 && res.type === 'basic') cache.put(request, res.clone());
      return res;
    }).catch(() => cached);
    return cached || network;
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of allClients) { if ('focus' in c) return c.focus(); }
    if (clients.openWindow) return clients.openWindow('/');
  })());
});
