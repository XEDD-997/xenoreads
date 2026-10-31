// Offline shell for the website. Bumped automatically on every deploy.
const VERSION = '__BUILD__';
const SHELL = `xr-shell-${VERSION}`;
const RUNTIME = 'xr-runtime-v1';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/store.js', 'js/config.js', 'js/ui.js', 'js/catalog.js', 'js/books.js', 'js/player.js',
  'js/offline.js', 'js/views.js', 'js/narrate.js',
  'vendor/firebase-app.js', 'vendor/firebase-auth.js', 'vendor/firebase-firestore.js',
  'fonts/newsreader-latin-opsz-normal.woff2', 'fonts/newsreader-latin-opsz-italic.woff2', 'fonts/figtree-latin-wght-normal.woff2',
  'icons/icon-192.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('xr-shell-') && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // App files: cache first. Share target and navigations get the shell.
  if (url.origin === location.origin) {
    if (url.pathname.includes('/catalog/')) {
      e.respondWith(staleWhileRevalidate(req));
      return;
    }
    if (req.mode === 'navigate') {
      e.respondWith(fetch(req).catch(() => caches.match('index.html')));
      return;
    }
    e.respondWith(caches.match(req, { ignoreSearch: true }).then((r) => r || fetch(req)));
    return;
  }
  // Book covers: keep a copy for offline browsing.
  if (req.destination === 'image' && /archive\.org|gutenberg\.org/.test(url.host)) {
    e.respondWith(staleWhileRevalidate(req));
  }
});

async function staleWhileRevalidate(req) {
  const c = await caches.open(RUNTIME);
  const hit = await c.match(req);
  const net = fetch(req).then((r) => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; }).catch(() => hit);
  return hit || net;
}
