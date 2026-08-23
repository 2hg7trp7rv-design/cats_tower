/* Cat's Tower 戦闘プロトタイプ (kimiブランチ) Service Worker
 * シェルのみ cache-first。assets/prototype の画像は network-first
 * (後から追加された画像が反映されるようにする)。 */
const CACHE = 'ct-proto-kimi-1';
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'game-data.js',
  'game-core.js',
  'app.js',
  'manifest.webmanifest'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/assets/prototype/')) {
    // 画像は network-first (追加・差替えを即反映)。失敗時はキャッシュ/404。
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }))
  );
});
