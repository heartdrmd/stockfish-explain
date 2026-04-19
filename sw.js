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
    const total = msg.urls.length;
    let done = 0;
    let failed = 0;

    // Per-file timeout so one stalled download can't hang the whole
    // queue. Big NNUE WASMs (~108 MB) need a generous budget.
    const FETCH_TIMEOUT_MS = 4 * 60 * 1000; // 4 min
    // Parallel workers — keeps total wall-clock low without saturating
    // the user's connection. CDN tends to throttle past ~4 parallel.
    const CONCURRENCY = 4;

    const fetchOne = async (url) => {
      const existing = await cache.match(url);
      if (existing) {
        return { ok: true, skipped: true };
      }
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort('timeout'), FETCH_TIMEOUT_MS);
      try {
        const resp = await fetch(url, { signal: ctrl.signal });
        if (resp.ok) {
          await cache.put(url, resp.clone());
          return { ok: true };
        }
        return { ok: false, status: resp.status };
      } finally {
        clearTimeout(timer);
      }
    };

    const queue = msg.urls.slice();
    const worker = async () => {
      while (queue.length) {
        const url = queue.shift();
        if (!url) break;
        reply({ type: 'preload-start', url, total });
        try {
          const r = await fetchOne(url);
          done++;
          if (!r.ok) failed++;
          reply({ type: 'preload-progress', url, done, total, failed, ok: r.ok, skipped: r.skipped, status: r.status });
        } catch (err) {
          done++; failed++;
          reply({ type: 'preload-progress', url, done, total, failed, error: String(err) });
        }
      }
    };

    const workers = Array.from({ length: CONCURRENCY }, () => worker());
    await Promise.all(workers);
    reply({ type: 'preload-done', total, failed });
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
