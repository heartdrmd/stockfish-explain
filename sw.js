// sw.js — Service Worker that caches Stockfish engine assets so they
// never have to be re-downloaded after the first fetch. Persists in the
// browser's Cache Storage (origin-keyed, survives restarts, not cleared
// by normal cache flushes).
//
// Only touches /assets/stockfish/* — everything else goes through
// network as usual.

const CACHE = 'sf-engines-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Drop any older cache versions.
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k.startsWith('sf-engines-') && k !== CACHE).map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Only intercept engine assets.
  if (!url.pathname.includes('/assets/stockfish/')) return;
  if (event.request.method !== 'GET') return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(event.request);
    if (hit) return hit;
    const resp = await fetch(event.request);
    if (resp.ok) cache.put(event.request, resp.clone()).catch(() => {});
    return resp;
  })());
});

// Main-thread → SW messages. Supports:
//   {type:'preload', urls:[...]}  — precache listed URLs, reply per file
//   {type:'clear'}                — wipe the engine cache
//   {type:'list'}                 — report which URLs are already cached
self.addEventListener('message', async (event) => {
  const msg = event.data || {};
  const reply = (data) => { try { event.source?.postMessage(data); } catch {} };

  if (msg.type === 'preload' && Array.isArray(msg.urls)) {
    const cache = await caches.open(CACHE);
    let done = 0;
    for (const url of msg.urls) {
      try {
        const existing = await cache.match(url);
        if (existing) {
          done++;
          reply({ type: 'preload-progress', url, done, total: msg.urls.length, skipped: true });
          continue;
        }
        const resp = await fetch(url);
        if (resp.ok) await cache.put(url, resp.clone());
        done++;
        reply({ type: 'preload-progress', url, done, total: msg.urls.length, ok: resp.ok });
      } catch (err) {
        done++;
        reply({ type: 'preload-progress', url, done, total: msg.urls.length, error: String(err) });
      }
    }
    reply({ type: 'preload-done', total: msg.urls.length });
  }

  if (msg.type === 'clear') {
    await caches.delete(CACHE);
    reply({ type: 'clear-done' });
  }

  if (msg.type === 'list') {
    const cache = await caches.open(CACHE);
    const keys = await cache.keys();
    reply({ type: 'list-result', urls: keys.map(r => r.url) });
  }
});
