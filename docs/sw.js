/* Golden Hour service worker: the app shell, cache-first, so the app opens offline. It never touches the
   forecast or map requests: the app keeps those itself, under its own request budget (docs/SPEC.md 11.3).
   A new version waits until the page asks it to take over ("Update ready. Reload."). */
const CACHE = 'golden-hour-0.9.3';
const SHELL = ['./', 'index.html', 'app.css', 'core.js', 'app.js', 'icon.svg', 'icon.png', 'manifest.webmanifest',
  'fonts/inter-latin-wght-normal.woff2', 'fonts/inter-latin-ext-wght-normal.woff2'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL))); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('golden-hour-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', (e) => { if (e.data === 'skip') self.skipWaiting(); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const hit = await cache.match(e.request, { ignoreSearch: e.request.mode === 'navigate' });
    if (hit) return hit;
    try {
      const res = await fetch(e.request);
      if (res.ok) cache.put(e.request, res.clone());   // the map library and the city list, the first time they're used
      return res;
    } catch (err) {
      if (e.request.mode === 'navigate') { const page = await cache.match('index.html'); if (page) return page; }
      throw err;
    }
  }));
});
