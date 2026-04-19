// sw.js — Self-uninstalling service worker.
//
// An earlier version of this SW intercepted /assets/stockfish/* fetches
// with cache-first behaviour. On two real users that combination caused
// Chrome "Aw Snap! / Can't open this page" renderer crashes — most
// likely serving corrupt WASM left over from a failed preload. The cost
// was higher than the benefit (slightly faster repeat boots), so the
// fetch handler is gone entirely.
//
// This file now exists only to CLEAN UP anyone who still has the old
// worker installed: on install we take over immediately, on activate
// we delete every sf-engines-* cache and unregister ourselves. After
// one visit the SW is gone and Chrome's normal HTTP cache does the job.

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter(k => k.startsWith('sf-engines-')).map(k => caches.delete(k))
      );
    } catch {}
    try { await self.registration.unregister(); } catch {}
    try { await self.clients.claim(); } catch {}
  })());
});

// No fetch handler — all requests go straight to the network (and
// Chrome's HTTP cache), same as before the SW ever existed.
