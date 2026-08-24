/* Cat's Tower — 商人サーガ風ドット絵版 Service Worker
 * シェル+新規素材(saga/フォント)を precache。画像は network-first
 * (後から追加・差替えされた画像が反映されるようにする)。 */
const CACHE = 'cats-tower-saga-v6';
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'game-data.js',
  'game-core.js',
  'app.js',
  'manifest.webmanifest',
  // ドット絵フォント
  'assets/fonts/DotGothic16-Regular.ttf',
  // 商人サーガ風 自作素材
  'assets/saga/bg_corridor.webp',
  'assets/saga/bg_title.webp',
  'assets/saga/castle_gate.webp',
  'assets/saga/shop_agency.webp',
  'assets/saga/shop_item.webp',
  'assets/saga/shop_legend.webp',
  'assets/saga/shop_weapon.webp',
  'assets/saga/cat_gray_0.png',
  'assets/saga/cat_gray_1.png',
  'assets/saga/cat_gray_2.png',
  'assets/saga/cat_gray_3.png',
  'assets/saga/cat_black_0.png',
  'assets/saga/cat_black_1.png',
  'assets/saga/cat_black_2.png',
  'assets/saga/cat_black_3.png',
  'assets/saga/cat_calico_0.png',
  'assets/saga/cat_calico_1.png',
  'assets/saga/cat_calico_2.png',
  'assets/saga/cat_calico_3.png'
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
  if (url.pathname.startsWith('/assets/')) {
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
