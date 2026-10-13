/* ============================================================
   石榴照相馆 · 选衣 Service Worker — 零外部请求
   预缓存全部静态资源；catalog.json 网络优先；导航请求断网回退离线提示页
   v13 变更：
     · styles.css 改动（风格卡片整体缩小 + 顶栏「拍照风格库」标题居中），
       提升缓存版本号确保客人端拿到新版排版
   v12 变更：
     · 预缓存改为「逐个 add」，单个文件失败不再让整批缓存一起失效
       （addAll 是原子的：清单里只要有一个 404，整批都不写入且不报错）
     · catalog.json 断网且无缓存时返回空 JSON，不再误返回 HTML
       （返回 HTML 会让调用方 r.json() 抛错，真实原因被掩盖）
     · index.html / styles.css / app.js 均有改动（全项目质量审计整改），
       提升缓存版本号确保客人端拿到新版
   注：images/ 下的图片不预缓存，首次浏览时按需写入缓存。
   ============================================================ */
var CACHE = 'wardrobe-v13';

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
  './offline.html'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) {
        /* 逐个 add 而不是 addAll：addAll 只要有一个文件失败，整批都写不进去
           且不抛给用户 —— 离线能力会整体静默失效。逐个抓，坏一个不影响其余。 */
        return Promise.all(ASSETS.map(function (u) {
          return c.add(u).catch(function () { /* 单个资源失败不阻断安装 */ });
        }));
      })
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
        /* 网络与缓存都没有：回一个空 catalog，而不是 HTML。
           返回 HTML 会让 App 的 r.json() 抛错，真实的"没有数据"被错误掩盖。 */
        return new Response('{"version":0,"categories":[],"items":[]}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  /* 3. 其余静态资源：缓存优先，保证离线秒开 */
  e.respondWith(cacheFirst(e.request).catch(function () {
    return new Response('', { status: 504, statusText: 'offline' });
  }));
});
