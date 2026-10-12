/* ============================================================
   衣橱 Service Worker — 零外部请求
   v7：预缓存全部静态资源；catalog.json 网络优先；
        导航请求断网回退离线提示页
   v7 变更：preview.html 改为单图左右滑动查看器（styles.css 同步更新），
        提升缓存版本号确保更新生效。
  注：images/ 下的图片不预缓存，首次浏览时按需写入缓存。
   ============================================================ */
var CACHE = 'wardrobe-v7';

/* 预缓存清单：全部静态资源。
   注意：catalog.json 故意不在此列 —— 它走网络优先策略，
   保证店主更新衣服后，客人下次打开拿到的是最新数据。 */
var ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './db-template.json',
  './offline.html',
  './preview.html'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
      .catch(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          return k === CACHE ? null : caches.delete(k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

/* 网络优先：成功则刷新缓存；断网回退缓存副本 */
function networkFirst(req) {
  return fetch(req).then(function (res) {
    if (res && res.ok) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); });
    }
    return res;
  }).catch(function () {
    return caches.match(req).then(function (hit) {
      if (hit) return hit;
      throw new Error('offline');
    });
  });
}

/* 缓存优先：命中直接返回；未命中走网络并写入缓存 */
function cacheFirst(req) {
  return caches.match(req).then(function (hit) {
    if (hit) return hit;
    return fetch(req).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    });
  });
}

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if (url.origin !== location.origin) return; /* 只接管本站资源，零外部请求原则不变 */

  /* 1. 页面导航：网络优先；断网 → 已缓存的首页；再不行 → 离线提示页 */
  if (e.request.mode === 'navigate') {
    e.respondWith(
      networkFirst(e.request).catch(function () {
        return caches.match('./index.html').then(function (hit) {
          return hit || caches.match('./offline.html');
        });
      })
    );
    return;
  }

  /* 2. catalog.json：网络优先（断网时用上次缓存，客人仍能看已加载过的衣服） */
  if (/\/catalog\.json$/.test(url.pathname)) {
    e.respondWith(
      networkFirst(e.request).catch(function () {
        return caches.match('./offline.html');
      })
    );
    return;
  }

  /* 3. 其余静态资源：缓存优先，保证离线秒开 */
  e.respondWith(cacheFirst(e.request).catch(function () {
    return new Response('', { status: 504, statusText: 'offline' });
  }));
});
