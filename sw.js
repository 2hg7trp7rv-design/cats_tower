/* Cat's Tower — S02 runtime shell Service Worker.
 * The playable shell is precached; image assets stay network-first so visual
 * revisions appear immediately and fall back to cache when offline.
 */
const CACHE = 'cats-tower-s02-runtime-v8';
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'runtime/s02-runtime.css',
  'runtime/s02-runtime.js',
  'runtime/s02-battle-renderer.js',
  'game-data.js',
  'game-core.js',
  'app.js',
  'manifest.webmanifest',
  'assets/fonts/DotGothic16-Regular.ttf',
  'step4/s02/assets/s02-forest-approved.webp',
  'step4/s02/assets/s02-ui-icons.svg',
  'step4/s02/assets/s02-frame.svg',
  'step4/s02/assets/s02-sprites.svg',
  'assets/prototype/cats/mugi.png',
  'assets/prototype/cats/luna.png',
  'assets/prototype/cats/slinger.png',
  'assets/prototype/cats/toto.png',
  'assets/prototype/cats/kohaku.png',
  'assets/prototype/enemies/ash_mouse.png',
  'assets/prototype/enemies/sack_mole.png',
  'assets/prototype/enemies/blackwing_guard.png',
  'assets/prototype/shops/fish_diner.png',
  'assets/prototype/shops/clinic.png',
  'assets/prototype/shops/claw_forge.png',
  'assets/saga/bg_title.webp',
  'assets/saga/castle_gate.webp',
  'assets/saga/shop_agency.webp',
  'assets/saga/shop_item.webp',
  'assets/saga/shop_legend.webp',
  'assets/saga/shop_weapon.webp'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;

  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/step4/s02/assets/')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(hit => hit || fetch(event.request).then(response => {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(event.request, copy));
      return response;
    }))
  );
});
