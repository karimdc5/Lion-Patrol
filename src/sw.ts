/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// SPA navigation fallback (offline deep links), but never for the legacy app.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), {
    denylist: [/\/legacy\//, /\/splash\//],
  }),
);

// Dark map tiles: cache-first, bounded.
registerRoute(
  ({ url }) => url.hostname.endsWith('basemaps.cartocdn.com'),
  new CacheFirst({
    cacheName: 'lp-tiles',
    plugins: [new ExpirationPlugin({ maxEntries: 600, maxAgeSeconds: 7 * 24 * 3600 })],
  }),
);

// Supabase API/storage are never cached by the SW — IndexedDB owns offline data.

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});
