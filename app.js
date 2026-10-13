/* ============================================================
   石榴照相馆 · 选衣 — 应用逻辑
   零依赖：原生 JS + IndexedDB + Service Worker
   ============================================================ */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  /* ---------------- 转义（用户数据安全渲染） ---------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function escAttr(s) { return esc(s).replace(/`/g, '&#96;'); }

  /* ---------------- IndexedDB ---------------- */
  var DB_NAME = 'wardrobe-db', DB_VER = 1;

  function openDB() {
    return new Promise(function (res, rej) {
      var req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains('categories')) {
          db.createObjectStore('categories', { keyPath: 'id' }).createIndex('sort', 'sort');
        }
        if (!db.objectStoreNames.contains('items')) {
          var s = db.createObjectStore('items', { keyPath: 'id' });
          s.createIndex('categoryId', 'categoryId');
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'k' });
        }
      };
      req.onsuccess = function () { res(req.result); };
      req.onerror = function () { rej(req.error); };
    });
  }
  function store(name, mode) {
    return openDB().then(function (db) {
      return db.transaction(name, mode || 'readonly').objectStore(name);
    });
  }
  function getAll(name) {
    return store(name).then(function (s) {
      return new Promise(function (res, rej) {
        var r = s.getAll();
        r.onsuccess = function () { res(r.result || []); };
        r.onerror = function () { rej(r.error); };
      });
    });
  }
  function putAll(name, arr) {
    return openDB().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction(name, 'readwrite');
        arr.forEach(function (o) { tx.objectStore(name).put(o); });
        tx.oncomplete = res;
        tx.onerror = function () { rej(tx.error); };
      });
    });
  }
  function clearStore(name) {
    return openDB().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction(name, 'readwrite');
        tx.objectStore(name).clear();
        tx.oncomplete = res;
        tx.onerror = function () { rej(tx.error); };
      });
    });
  }
  function getMeta(k) {
    return store('meta').then(function (s) {
      return new Promise(function (res, rej) {
        var r = s.get(k);
        r.onsuccess = function () { res(r.result ? r.result.v : null); };
        r.onerror = function () { rej(r.error); };
      });
    });
  }
  function putMeta(k, v) {
    return openDB().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction('meta', 'readwrite');
        tx.objectStore('meta').put({ k: k, v: v });
        tx.oncomplete = res;
        tx.onerror = function () { rej(tx.error); };
      });
    });
  }

  /* ---------------- 状态 ---------------- */
  var state = {
    categories: [],
    items: [],
    active: 0,
    view: 'splash',
    mode: 'merge'
  };

  /* ---------------- 工具 ---------------- */
  function hashStr(s) {
    var h = 0;
    s = String(s || 'x');
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }
  /* 占位底：图片缺失 / 未加载时露出的首字色块（颜色由 id/名称哈希决定，稳定不闪变） */
  function placeholder(it) {
    var h = hashStr(it.id || it.name);
    var bg = 'linear-gradient(150deg,hsl(' + (h % 360) + ' 42% 30%),hsl(' + ((h + 40) % 360) + ' 38% 16%))';
    var ch = esc(String(it.name || '?').trim().charAt(0));
    return '<div class="ph" style="background:' + bg + '"><span>' + ch + '</span></div>';
  }
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('show'); }, 2000);
  }
  function download(filename, obj) {
    var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  /* ---------------- 视图切换 ----------------
     本应用没有独立的"首页"：顾客端的主界面就是「拍照风格库」（固定覆盖层）。
     .screen 只剩 启动动画 / 数据管理 两种，
     收起全部 .screen 即露出底下的风格库。                                */
  function showView(v) {
    state.view = v;
    $$('.screen').forEach(function (s) { s.classList.remove('active'); });
    $('#' + v).classList.add('active');
  }
  window.addEventListener('popstate', function () {
    if (!sl.open) return;
    /* 逐层回退：放大查看 → 模板库网格 → 风格墙
       （风格墙是最外层，在墙上再按返回即离开页面，交给浏览器默认行为） */
    if (sl.layer === 'browser') { slToGrid(); return; }
    if (sl.layer === 'grid') { slToWall(); return; }
  });

  /* ---------------- 双入口：顾客端（默认）/ 店主端（#/admin） ----------------
     二维码只携带纯顾客端 URL（无参数、无 hash），扫码必进顾客主界面；
     店主端是独立入口，直达数据管理，顾客端不可见、不可达。            */
  function isAdminMode() {
    return location.hash.replace(/^#\/?/, '').toLowerCase() === 'admin';
  }
  function applyMode() {
    document.body.classList.toggle('mode-admin', isAdminMode());
  }
  window.addEventListener('hashchange', function () {
    applyMode();
    if (isAdminMode()) {
      showView('data');            /* 进入店主端 → 直达数据管理（不作为历史栈节点） */
    } else if (state.view === 'data') {
      openStyleLib();              /* 退出店主端 → 回到顾客端主界面（风格库） */
    }
  });

  /* ---------------- 通用工具 ---------------- */
  function counts() {
    var m = {};
    state.items.forEach(function (it) { m[it.categoryId] = (m[it.categoryId] || 0) + 1; });
    return m;
  }
  function sortBySort(a, b) { return (a.sort || 0) - (b.sort || 0); }

  /* ---------------- 拍照风格库（顾客端主界面） ----------------
     扫码进入 → 启动动画 → 直接落在风格墙（没有独立首页，也没有"返回主界面"入口）。
     三层结构：风格墙（拍摄风格模板大卡，左右滑）
             → 模板库网格（该风格下的衣服缩略图，点击放大）
             → 放大查看（左右滑看上一件 / 下一件）
     历史栈：进网格 push{sl:2} → 放大 push{sl:3}；Android 返回键逐层回退；
             下滑手势等同"返回上一层"，同样走 history.back() 单一出口。   */
  var SL_EDGE = 26;          /* 边缘手势判定区宽度 px */
  var SL_OPEN_DX = 44;       /* 开库手势横向阈值 px */
  var SL_NAV_RATIO = 0.2;    /* 浏览翻页阈值 = 屏宽 × 此比例 */
  var SL_CLOSE_DY = 96;      /* 下滑"返回上一层"阈值 px */
  var SL_TAP_SLOP = 8;       /* 单击判定位移 px */

  var sl = { open: false, layer: 'wall', styleId: null, items: [], index: 0 };

  function slCounts() { return counts(); }
  /* 风格墙展示全部分类：空风格也保留卡片（店主可先建卡、之后再把衣服导进去） */
  function slCats() { return state.categories.slice().sort(sortBySort); }
  function slStyleItems(catId) {
    return state.items.filter(function (it) { return it.categoryId === catId; }).sort(sortBySort);
  }

  /* 通用横滑器：跟手位移 + 阈值翻页 + 纵向下滑 + 单击。
     preview.html 单图查看器同款手势，已验证流畅，此处泛化复用。 */
  function makeSwiper(o) {
    var index = 0;
    var dragging = false, decided = false, horizontal = false, vertical = false;
    var startX = 0, startY = 0, startT = 0, dx = 0, downTarget = null;
    function total() { return typeof o.count === 'function' ? o.count() : 0; }
    function render(animate) {
      o.track.classList.toggle('pv-anim', animate !== false);
      o.track.style.transform = 'translateX(' + (-index * 100) + '%)';
    }
    function go(i, silent) {
      var n = total();
      index = Math.max(0, Math.min(n - 1, i));
      render(true);
      if (!silent && o.onIndex) o.onIndex(index);
    }
    o.stage.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      dragging = true; decided = false; horizontal = false; vertical = false;
      startX = e.clientX; startY = e.clientY; startT = Date.now(); dx = 0;
      downTarget = e.target;   /* 必须在 setPointerCapture 之前取：捕获会重定靶后续事件 */
      o.track.classList.remove('pv-anim');
      try { o.stage.setPointerCapture(e.pointerId); } catch (err) {}
    });
    o.stage.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var mx = e.clientX - startX, my = e.clientY - startY;
      if (!decided) {
        if (Math.abs(mx) < 6 && Math.abs(my) < 6) return;
        decided = true;
        horizontal = Math.abs(mx) > Math.abs(my);
        vertical = !horizontal && my > 0;
      }
      if (horizontal) {
        e.preventDefault();
        dx = mx;
        if ((index === 0 && dx > 0) || (index === total() - 1 && dx < 0)) dx *= 0.35;
        o.track.style.transform = 'translateX(calc(' + (-index * 100) + '% + ' + dx + 'px))';
      } else if (vertical && my > SL_CLOSE_DY) {
        dragging = false;                       /* 下滑触发一次即交棒给上层 */
        if (o.onSwipeDown) o.onSwipeDown();
        render(true);
      }
    });
    function endDrag() {
      if (!dragging) return;
      dragging = false;
      var threshold = Math.min(120, o.stage.clientWidth * SL_NAV_RATIO);
      if (horizontal && Math.abs(dx) > threshold) {
        go(index + (dx < 0 ? 1 : -1));
      } else if (!decided && Date.now() - startT < 300) {
        if (o.onTap) o.onTap(downTarget);    /* 原地轻点：带原始目标（捕获已重定靶 click） */
      } else {
        render(true);                          /* 未过阈值：回弹 */
      }
      dx = 0; downTarget = null;
    }
    o.stage.addEventListener('pointerup', endDrag);
    o.stage.addEventListener('pointercancel', endDrag);
    return {
      go: go,
      render: render,
      reset: function () { index = 0; dragging = false; render(false); },
      get index() { return index; }
    };
  }

  /* ---- 风格墙 ---- */
  var wallSwiper = null;
  function initSlSwipers() {
    wallSwiper = makeSwiper({
      stage: $('#sl-wall-stage'),
      track: $('#sl-wall-track'),
      count: function () { return $('#sl-wall-track').children.length; },
      onSwipeDown: function () { closeStyleLib(false); },
      /* 点卡进入模板库（网格层）：pointerdown 时捕获尚未生效，downTarget 是真实被点的元素 */
      onTap: function (t) {
        var card = t && t.closest ? t.closest('.sl-wall-slide') : null;
        if (!card) return;
        if (card.dataset.add) { openStyleModal(); return; }   /* 店主端末位"添加风格卡" */
        var catId = card.dataset.cat;
        if (!catId) return;
        openGridView(catId);   /* 内部 push {sl:2}，此处不重复压栈 */
      }
    });
    browserSwiper = makeSwiper({
      stage: $('#sl-stage'),
      track: $('#sl-track'),
      count: function () { return sl.items.length; },
      onIndex: function (i) { updateBrowserChrome(i); },
      onSwipeDown: function () { slBackGrid(); },   /* 放大态下滑 → 回网格 */
      onTap: function () { $('#sl-browser').classList.toggle('sl-immersive'); }
    });
  }
  function renderStyleWall() {
    var cats = slCats();
    var html = cats.map(function (c) {
      var its = slStyleItems(c.id);
      /* 卡片封面：优先分类自带的 cover 字段，其次该风格第一件衣服的图，都没有则用占位底 */
      var cover = (typeof c.cover === 'string' && c.cover) ? c.cover : (its[0] && its[0].image ? its[0].image : '');
      var img = cover
        ? '<img draggable="false" src="' + escAttr(cover) + '" alt="" onerror="this.classList.add(\'img-err\')">'
        : '';
      return '<div class="sl-wall-slide" data-cat="' + escAttr(c.id) + '">' +
        '<div class="sl-cover">' + placeholder(its[0] || { id: c.id, name: c.name }) + img + '</div>' +
        '<div class="sl-wall-body">' +
          '<div class="sl-wall-name">' + esc(c.name) + '</div>' +
          '<div class="sl-wall-sub">' + (its.length ? its.length + ' 件衣服' : '这套还在整理') + '</div>' +
          (its.length ? '<span class="sl-wall-go">进去挑衣服</span>' : '') +
        '</div>' +
      '</div>';
    }).join('');

    /* 店主端：末位追加一张"添加模板卡"（顾客端不显示，客人永远看不到店主入口） */
    if (isAdminMode()) {
      html += '<div class="sl-wall-slide sl-wall-add" data-add="1">' +
        '<div class="sl-add-card">' +
          '<div class="sl-add-ic">＋</div>' +
          '<div class="sl-add-t">添加模板卡</div>' +
          '<div class="sl-add-s">点这里新增一个拍照风格；之后用<br>「数据管理 → 图片批量导入」把衣服图导进该风格。</div>' +
          '<span class="sl-wall-go sl-add-go">点此添加</span>' +
        '</div>' +
      '</div>';
    }

    var track = $('#sl-wall-track');
    track.innerHTML = html;
    $('#sl-wall-count').textContent = cats.length ? cats.length + ' 种风格' : '';
    wallSwiper.reset();   /* swiper 只初始化一次（bindStyleLib），此处仅重置位置 */
  }

  /* ---- 第二层：模板库（衣服缩略图网格） ---- */
  function renderGridView(catId) {
    var cat = state.categories.find(function (c) { return c.id === catId; });
    var items = slStyleItems(catId);
    $('#sl-grid-title').textContent = cat ? cat.name : '服装';
    $('#sl-grid-count').textContent = items.length + ' 件';
    if (!items.length) {
      $('#sl-grid-scroll').innerHTML =
        '<div class="sl-grid-empty">这套风格的服装还在整理中<br>先看看别的风格吧</div>';
      return;
    }
    $('#sl-grid-scroll').innerHTML = items.map(function (it, i) {
      /* 占位符在前、图片在后（绝对定位叠放），图片加载失败才露出占位 */
      var img = it.image
        ? '<img draggable="false" src="' + escAttr(it.image) + '" alt="' + escAttr(it.name) + '" onerror="this.classList.add(\'img-err\')">'
        : '';
      return '<button class="sl-thumb" data-i="' + i + '">' + placeholder(it) + img +
        '<span class="sl-thumb-name">' + esc(it.name) + '</span></button>';
    }).join('');
  }
  function openGridView(catId) {
    var cat = state.categories.find(function (c) { return c.id === catId; });
    if (!cat) return;
    sl.styleId = catId; sl.items = slStyleItems(catId); sl.layer = 'grid';
    renderGridView(catId);
    $('#sl-gridview').classList.add('on');
    try { history.pushState({ sl: 2 }, ''); } catch (e) {}
  }

  /* ---- 第三层：放大查看（左右滑动浏览上一件 / 下一件） ---- */
  var browserSwiper = null;
  function openBrowser(i) {
    if (!sl.items.length) return;
    if (typeof i !== 'number' || i < 0) i = 0;
    sl.index = i; sl.layer = 'browser';
    $('#sl-track').innerHTML = sl.items.map(function (it) {
      /* draggable="false"：否则在图上起拖会触发原生图片拖拽，吞掉后续 pointermove */
      var img = it.image
        ? '<img draggable="false" src="' + escAttr(it.image) + '" alt="' + escAttr(it.name) + '" onerror="this.classList.add(\'img-err\')">'
        : '';
      return '<div class="sl-slide" data-id="' + escAttr(it.id) + '">' + placeholder(it) + img + '</div>';
    }).join('');
    $('#sl-browser-title').textContent = sl.items[i].name;
    $('#sl-dots').innerHTML = sl.items.map(function (_, j) {
      return '<i class="sl-dot' + (j === i ? ' on' : '') + '" data-i="' + j + '"></i>';
    }).join('');
    browserSwiper.reset();          /* swiper 只初始化一次，此处仅重置位置 */
    browserSwiper.go(i, true);      /* 跳到被点的那件 */
    updateBrowserChrome(i);
    $('#sl-browser').classList.add('on');
    try { history.pushState({ sl: 3 }, ''); } catch (e) {}
  }
  function updateBrowserChrome(i) {
    var n = sl.items.length;
    sl.index = i;
    var it = sl.items[i];
    if (!it) return;
    $('#sl-count').textContent = (i + 1) + ' / ' + n;
    $('#sl-name').textContent = it.name;
    /* 只显示「属于哪个拍摄风格」+（店主可选填的）一句说明；
       不再展示尺码 / 颜色 / 标签等商品规格 */
    var cat = state.categories.find(function (c) { return c.id === it.categoryId; });
    var meta = cat ? cat.name : '';
    if (it.desc) meta += (meta ? ' · ' : '') + it.desc;
    $('#sl-meta').textContent = meta;
    $$('#sl-dots .sl-dot').forEach(function (d, j) { d.classList.toggle('on', j === i); });
  }
  function slToWall() {
    sl.layer = 'wall';
    $('#sl-gridview').classList.remove('on');
    $('#sl-browser').classList.remove('on');
    $('#sl-browser').classList.remove('sl-immersive');
    if (wallSwiper) wallSwiper.render(true);
  }
  function slToGrid() {
    sl.layer = 'grid';
    $('#sl-browser').classList.remove('on');
    $('#sl-browser').classList.remove('sl-immersive');
    $('#sl-gridview').classList.add('on');
    if (browserSwiper) browserSwiper.render(true);
  }
  /* 返回上一层：优先消费历史栈中的对应节点（保证 Android 返回键与界面按钮行为一致），
     无栈环境（如顾客端启动即落在墙上、未压栈）则直接切层 */
  function slBackWall() {
    if (history.state && history.state.sl === 2) { try { history.back(); return; } catch (e) {} }
    slToWall();
  }
  function slBackGrid() {
    if (history.state && history.state.sl === 3) { try { history.back(); return; } catch (e) {} }
    slToGrid();
  }

  /* ---- 打开 / 关闭风格库 ----
     顾客端：风格库就是主界面，启动即打开且不压历史栈
             （栈底即本页，在风格墙上再按返回键就是离开页面 —— 没有"首页"可回）。
     店主端：在数据页点「预览风格墙」临时打开，关闭后回到数据页。      */
  function openStyleLib() {
    if (sl.open) { if (sl.layer !== 'wall') slToWall(); return; }
    sl.open = true; sl.layer = 'wall';
    renderStyleWall();
    $('#stylelib').classList.add('open');
    $('#stylelib').setAttribute('aria-hidden', 'false');
  }
  function closeStyleLib() {
    if (!sl.open) return;
    sl.open = false;
    sl.layer = 'wall';
    $('#stylelib').classList.remove('open');
    $('#stylelib').setAttribute('aria-hidden', 'true');
    $('#sl-gridview').classList.remove('on');
    $('#sl-browser').classList.remove('on');
    $('#sl-browser').classList.remove('sl-immersive');
    if (isAdminMode()) showView('data');   /* 仅店主端有"关闭"语义 */
  }

  function bindStyleLib() {
    /* 手势器只创建一次：重复创建会在同一 stage 上叠加监听器 */
    initSlSwipers();
    /* 第二层网格：点缩略图 → 放大查看 */
    var grid = $('#sl-grid-scroll');
    if (grid) grid.addEventListener('click', function (e) {
      var t = e.target.closest('.sl-thumb');
      if (!t) return;
      openBrowser(parseInt(t.dataset.i, 10));
    });
    /* 风格墙点卡逻辑在 wallSwiper.onTap 内完成（setPointerCapture 会重定靶
       click 事件到 stage，因此不能再用 stage 级 click 委托，详见 makeSwiper） */
  }

  /* ---------------- 风格卡（分类）管理 · 店主端 ----------------
     风格墙上的每一张卡就是一个分类；店主可自行新增。
     新增后客人端首屏立即多一张卡（封面先占位，导入衣服后自动取第一张图）。 */
  function styleId() { return 'cat-' + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36); }

  function addStyle(name, done) {
    name = String(name == null ? '' : name).trim();
    if (!name) { toast('请输入风格名称'); return Promise.resolve(null); }
    if (state.categories.some(function (c) { return c.name === name; })) { toast('已经有同名风格了'); return Promise.resolve(null); }
    var maxSort = state.categories.reduce(function (m, c) { return Math.max(m, c.sort || 0); }, 0);
    var cat = { id: styleId(), name: name, sort: maxSort + 1, desc: '', cover: '' };
    return putAll('categories', [cat])
      .then(reload)
      .then(function () {
        renderStyleWall();
        renderStyleManage();
        renderImgCatSelect();
        renderStats();
        toast('已添加风格卡：' + name);
        if (done) done(cat);
        return cat;
      });
  }

  function renderStyleManage() {
    var box = $('#style-list');
    if (!box) return;
    var cnt = slCounts();
    box.innerHTML = state.categories.map(function (c) {
      var n = cnt[c.id] || 0;
      var its = slStyleItems(c.id);
      var custom = (typeof c.cover === 'string' && c.cover) ? c.cover : '';
      var auto = its[0] && its[0].image ? its[0].image : '';
      var thumb = custom || auto;
      /* 占位符在前、图片在后（绝对定位叠放），图片缺失/加载失败时露出占位底 */
      return '<div class="style-row" data-cat="' + escAttr(c.id) + '">' +
        '<span class="style-row-thumb">' + placeholder({ id: c.id, name: c.name }) +
          (thumb ? '<img draggable="false" src="' + escAttr(thumb) + '" alt="" onerror="this.classList.add(\'img-err\')">' : '') +
        '</span>' +
        '<span class="style-row-main">' +
          '<span class="style-row-name">' + esc(c.name) + '</span>' +
          '<span class="style-row-meta">' + n + ' 件 · 封面' + (custom ? '已自定义' : (auto ? '自动' : '未设置')) + '</span>' +
        '</span>' +
        '<button class="style-row-btn" data-act="style-cover" data-cover-cat="' + escAttr(c.id) + '">封面</button>' +
        (n === 0 ? '<button class="style-row-del" data-del-cat="' + escAttr(c.id) + '" aria-label="删除空风格">×</button>' : '') +
      '</div>';
    }).join('') || '<div class="style-row style-row-none">还没有模板卡，用下面输入框添加</div>';
  }

  function deleteEmptyStyle(catId) {
    var c = state.categories.find(function (x) { return x.id === catId; });
    if (!c) return;
    if ((slCounts()[catId] || 0) > 0) { toast('该风格下已有衣服，不能删除'); return; }
    return openDB().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction('categories', 'readwrite');
        tx.objectStore('categories').delete(catId);
        tx.oncomplete = res;
        tx.onerror = function () { rej(tx.error); };
      });
    }).then(reload).then(function () {
      renderStyleWall(); renderStyleManage(); renderImgCatSelect(); renderStats();
      toast('已删除风格：' + c.name);
    });
  }

  /* ---- 添加风格卡弹窗 ---- */
  function openStyleModal() {
    var m = $('#style-modal');
    if (!m) return;
    $('#style-name').value = '';
    m.classList.add('open');
    m.setAttribute('aria-hidden', 'false');
    setTimeout(function () { try { $('#style-name').focus(); } catch (e) {} }, 120);
  }
  function closeStyleModal() {
    var m = $('#style-modal');
    if (!m) return;
    m.classList.remove('open');
    m.setAttribute('aria-hidden', 'true');
  }
  function submitStyleModal() {
    var el = $('#style-name');
    addStyle(el.value, function () {
      closeStyleModal();
      if (!sl.open) openStyleLib();
      /* 跳到刚新增的那张卡 */
      setTimeout(function () {
        if (wallSwiper) wallSwiper.go(slCats().length - 1);
      }, 30);
    });
  }
  function submitInlineStyle() {
    var el = $('#style-name-inline');
    if (!el) return;
    addStyle(el.value, function () { el.value = ''; });
  }

  /* ---------------- 卡片封面（店主端） ----------------
     模板卡封面取值优先级：分类 cover 字段 → 该风格第一件衣服的图 → 占位底。
     店主有两种定义方式：① 从这套风格的衣服里挑一张；② 单独上传一张封面图
     （本地压缩后存本机 IndexedDB，离线可用；导出备份时会一并写进 JSON）。 */
  var coverCatId = null;

  function openCoverModal(catId) {
    var c = state.categories.find(function (x) { return x.id === catId; });
    if (!c) return;
    coverCatId = catId;
    renderCoverModal();
    var m = $('#cover-modal');
    m.classList.add('open');
    m.setAttribute('aria-hidden', 'false');
  }
  function closeCoverModal() {
    var m = $('#cover-modal');
    if (!m) return;
    m.classList.remove('open');
    m.setAttribute('aria-hidden', 'true');
    coverCatId = null;
  }
  function renderCoverModal() {
    var c = state.categories.find(function (x) { return x.id === coverCatId; });
    if (!c) return;
    var items = slStyleItems(c.id);
    var custom = (typeof c.cover === 'string' && c.cover) ? c.cover : '';
    var auto = items[0] && items[0].image ? items[0].image : '';
    var shown = custom || auto;

    $('#cover-modal-title').textContent = '卡片封面 · ' + c.name;
    $('#cover-preview-img').innerHTML =
      placeholder({ id: c.id, name: c.name }) +
      (shown ? '<img draggable="false" src="' + escAttr(shown) + '" alt="" onerror="this.classList.add(\'img-err\')">' : '');
    $('#cover-preview-txt').textContent = custom
      ? '当前：自定义封面（' + (custom.indexOf('data:') === 0 ? '本机上传的图片' : custom) + '）'
      : (auto ? '当前：自动（取该风格第一张衣服图）' : '当前：暂无图片，请用下面的方式添加');

    /* 恢复自动：仅在已自定义时才有意义 */
    var rst = $('[data-act="cover-reset"]');
    if (rst) rst.style.display = custom ? '' : 'none';

    /* 从本风格衣服里挑一张 */
    var pick = $('#cover-pick');
    if (!items.length) {
      pick.innerHTML = '<div class="cover-pick-t">这套风格下还没有衣服。可以用上面的「上传一张封面图」先设好封面，之后再把衣服导进来。</div>';
    } else {
      pick.innerHTML = '<div class="cover-pick-t">或从这套风格的衣服里挑一张</div>' +
        '<div class="cover-pick-grid">' +
        items.map(function (it) {
          var img = it.image
            ? '<img draggable="false" src="' + escAttr(it.image) + '" alt="" onerror="this.classList.add(\'img-err\')">'
            : '';
          var on = (custom && it.image && custom === it.image) ? ' on' : '';
          return '<button class="cover-thumb' + on + '" data-img="' + escAttr(it.image || '') + '" aria-label="' + escAttr(it.name) + '">' +
            placeholder(it) + img + '</button>';
        }).join('') +
        '</div>';
    }
  }
  /* 写入封面：cover 为空串即恢复"自动取第一件衣服" */
  function setStyleCover(catId, cover) {
    var c = state.categories.find(function (x) { return x.id === catId; });
    if (!c) return Promise.resolve();
    var next = {
      id: c.id, name: c.name, sort: c.sort || 0,
      desc: c.desc || '', cover: cover || ''
    };
    return putAll('categories', [next]).then(reload).then(function () {
      renderStyleWall(); renderStyleManage(); renderCoverModal();
      toast(cover ? '已设置卡片封面' : '已恢复自动封面');
    });
  }

  /* ---------------- 数据管理 ---------------- */
  function renderStats() {
    $('#stat-row').innerHTML =
      '<div class="stat"><b>' + state.categories.length + '</b><span>种拍摄风格</span></div>' +
      '<div class="stat"><b>' + state.items.length + '</b><span>件衣服</span></div>';
  }

  function normalizeImport(raw) {
    var errors = [], warnings = [], categories = [], items = [];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { errors: ['根节点必须是一个 JSON 对象 {categories:[], items:[]}'], warnings: warnings, categories: [], items: [] };
    }
    var rawCats = Array.isArray(raw.categories) ? raw.categories : [];
    var rawItems = Array.isArray(raw.items) ? raw.items : [];
    if (!raw.categories) warnings.push('缺少 categories 字段，已按空数组处理');
    if (!raw.items) warnings.push('缺少 items 字段，已按空数组处理');

    var catIds = {};
    rawCats.forEach(function (c, i) {
      var at = 'categories[' + i + ']';
      if (!c || typeof c !== 'object') { errors.push(at + ' 不是对象'); return; }
      if (!c.id || typeof c.id !== 'string') { errors.push(at + ' 缺少 id（字符串）'); return; }
      if (!c.name || typeof c.name !== 'string') { errors.push(at + ' 缺少 name（字符串）'); return; }
      if (catIds[c.id]) { warnings.push(at + ' id "' + c.id + '" 重复，已跳过后者'); return; }
      catIds[c.id] = true;
      categories.push({
        id: c.id, name: c.name,
        sort: typeof c.sort === 'number' ? c.sort : i + 1,
        desc: typeof c.desc === 'string' ? c.desc : '',
        /* cover：卡片封面图（路径 / URL / base64）。空串 = 自动取该风格第一件衣服的图 */
        cover: typeof c.cover === 'string' ? c.cover : ''
      });
    });

    var existingCat = {};
    state.categories.forEach(function (c) { existingCat[c.id] = true; });
    var itemIds = {};
    rawItems.forEach(function (it, i) {
      var at = 'items[' + i + ']';
      if (!it || typeof it !== 'object') { errors.push(at + ' 不是对象'); return; }
      if (!it.id || typeof it.id !== 'string') { errors.push(at + ' 缺少 id（字符串）'); return; }
      if (!it.name || typeof it.name !== 'string') { errors.push(at + ' 缺少 name（字符串）'); return; }
      if (!it.categoryId || typeof it.categoryId !== 'string') { errors.push(at + ' 缺少 categoryId（字符串）'); return; }
      if (!catIds[it.categoryId] && !existingCat[it.categoryId]) {
        errors.push(at + ' 的 categoryId "' + it.categoryId + '" 不存在，请先在 categories 中定义');
        return;
      }
      if (itemIds[it.id]) { warnings.push(at + ' id "' + it.id + '" 重复，已跳过后者'); return; }
      itemIds[it.id] = true;
      if (it.image && typeof it.image !== 'string') { errors.push(at + ' 的 image 必须是字符串（URL 或 base64）'); return; }
      /* 只保留挑选服装真正需要的字段：名称 / 图片 / 说明 / 排序。
         sizes、colors、tags 等商品规格字段不再收录（历史 JSON 里的这些键会被静默忽略，不报错）。 */
      items.push({
        id: it.id, categoryId: it.categoryId, name: it.name,
        image: typeof it.image === 'string' ? it.image : '',
        desc: typeof it.desc === 'string' ? it.desc : '',
        sort: typeof it.sort === 'number' ? it.sort : i + 1
      });
    });
    return { errors: errors, warnings: warnings, categories: categories, items: items };
  }

  function showImportMsg(type, title, list) {
    var el = $('#import-msg');
    var html = '<b>' + esc(title) + '</b>';
    if (list && list.length) {
      html += '<ul>' + list.slice(0, 12).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
      if (list.length > 12) html += '<p>…共 ' + list.length + ' 条</p>';
    }
    el.innerHTML = html;
    el.className = 'import-msg show ' + type;
  }

  function doImport(obj, silent) {
    var r = normalizeImport(obj);
    if (r.errors.length) {
      if (!silent) showImportMsg('err', '导入失败，请修正以下问题：', r.errors);
      return Promise.resolve();
    }
    var done = function () {
      return (state.mode === 'replace' ? clearStore('categories').then(function () { return clearStore('items'); }) : Promise.resolve())
        .then(function () { return putAll('categories', r.categories); })
        .then(function () { return putAll('items', r.items); })
        .then(reload)
        .then(function () {
          renderStats(); renderStyleManage(); renderImgCatSelect();
          if (sl.open) renderStyleWall();
          if (silent) return;
          var msg = '导入成功：' + r.categories.length + ' 个风格，' + r.items.length + ' 件衣服';
          showImportMsg('ok', msg, r.warnings);
          toast(msg);
        });
    };
    return done().catch(function (e) { if (!silent) showImportMsg('err', '写入数据库失败：' + e); });
  }

  /* ---------------- 在线 catalog 同步（扫码方案专用） ----------------
     旧逻辑只在"本机为空"时拉取，导致老客人二次来访永远停在旧数据。
     现逻辑：每次启动都拉取 catalog.json，按 version 判断是否需要同步——
        · 本机为空            → 直接导入（客人扫码即有内容）
        · catalog version 更新 → 合并导入（同 ID 覆盖、新 ID 追加、本机独有保留）
        · version 未变或断网   → 不动本机数据
     version 由店主「导出当前数据」时写为时间戳，天然单调递增。        */
  function syncCatalog() {
    return fetch('catalog.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        var remoteV = (data && typeof data.version === 'number') ? data.version : 0;
        var isEmpty = !state.categories.length && !state.items.length;
        if (!isEmpty && remoteV <= 0) return;               // catalog 没带版本号且本机有数据：不动
        return getMeta('catalogVersion').then(function (localV) {
          localV = typeof localV === 'number' ? localV : 0;
          if (!isEmpty && remoteV <= localV) return;        // 已是最新
          var prevMode = state.mode;
          state.mode = 'merge';                             // 同步一律合并，绝不覆盖本机数据
          return doImport(data, true).then(function () {
            state.mode = prevMode;
            return putMeta('catalogVersion', remoteV);
          });
        });
      })
      .catch(function () { /* 无 catalog / 断网 / 解析失败：保持现状，走手动导入流程 */ });
  }

  function readFile(file) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () {
        try { res(JSON.parse(fr.result)); }
        catch (e) { rej(new Error('JSON 解析失败：' + e.message)); }
      };
      fr.onerror = function () { rej(new Error('文件读取失败')); };
      fr.readAsText(file);
    });
  }

  /* ---------------- 图片批量导入（PNG / JPG / WebP） ---------------- */
  var IMG_MAX_SIDE = 1400;   // 长边上限，超出等比压缩
  var IMG_QUALITY = 0.85;    // 压缩质量
  var imgBusy = false;

  function renderImgCatSelect() {
    var sel = $('#img-cat');
    if (!sel) return;
    var html = state.categories.map(function (c) {
      return '<option value="' + escAttr(c.id) + '">' + esc(c.name) + '</option>';
    }).join('');
    html += '<option value="__new">＋ 新建风格（导入时创建）</option>';
    sel.innerHTML = html;
  }

  /* 读取图片 → canvas 等比压缩 → base64 dataURL（本地存储，离线可用） */
  function compressImage(file) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () {
        var img = new Image();
        img.onload = function () {
          try {
            var w = img.naturalWidth, h = img.naturalHeight;
            var scale = Math.min(1, IMG_MAX_SIDE / Math.max(w, h));
            var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
            var cv = document.createElement('canvas');
            cv.width = cw; cv.height = ch;
            cv.getContext('2d').drawImage(img, 0, 0, cw, ch);
            var url = cv.toDataURL('image/webp', IMG_QUALITY);
            if (url.indexOf('data:image/webp') !== 0) {
              url = cv.toDataURL('image/jpeg', IMG_QUALITY); // 老浏览器回退 JPEG
            }
            res({ dataUrl: url, w: w, h: h });
          } catch (e) { rej(new Error('图片处理失败：' + file.name)); }
        };
        img.onerror = function () { rej(new Error('图片解码失败：' + file.name + '（格式不受支持）')); };
        img.src = fr.result;
      };
      fr.onerror = function () { rej(new Error('文件读取失败：' + file.name)); };
      fr.readAsDataURL(file);
    });
  }

  function nameFromFile(f) {
    var n = String(f.name || '').replace(/\.[a-z0-9]+$/i, '').trim();
    try { n = decodeURIComponent(n); } catch (e) {}
    return n || '未命名';
  }

  function importImages(fileList) {
    if (imgBusy) { toast('正在处理图片，请稍候…'); return; }
    var files = Array.prototype.slice.call(fileList || []).filter(function (f) {
      return /^image\//.test(f.type) || /\.(png|jpe?g|webp)$/i.test(f.name);
    });
    if (!files.length) {
      showImportMsg('err', '没有选中图片文件', ['请选择 PNG / JPG / WebP 图片（可多选）']);
      return;
    }

    imgBusy = true;
    var btn = $('[data-act="pick-images"]');
    if (btn) btn.disabled = true;
    var errors = [], items = [], newCat = null;

    /* 1. 确定目标分类 */
    var target = $('#img-cat').value;
    var catId = target;
    if (target === '__new') {
      var exist = state.categories.find(function (c) { return c.name === '新风格'; });
      if (exist) { catId = exist.id; }
      else {
        catId = 'cat-img-' + Date.now().toString(36);
        var maxSort = state.categories.reduce(function (m, c) { return Math.max(m, c.sort || 0); }, 0);
        newCat = { id: catId, name: '新风格', sort: maxSort + 1, desc: '导入图片时新建', cover: '' };
      }
    }

    /* 2. 顺序压缩（避免一次性占用过多内存），逐张反馈进度 */
    var chain = Promise.resolve();
    files.forEach(function (f, i) {
      chain = chain.then(function () {
        showImportMsg('info', '正在处理图片 ' + (i + 1) + ' / ' + files.length + ' …');
        return compressImage(f).then(function (r) {
          items.push({
            id: 'img-' + Date.now().toString(36) + '-' + i,
            categoryId: catId,
            name: nameFromFile(f),
            image: r.dataUrl,
            desc: '',
            sort: i + 1
          });
        }).catch(function (err) { errors.push(err.message); });
      });
    });

    /* 3. 写入数据库并刷新 */
    chain.then(function () {
      /* 合并：保留现有分类，追加新分类；替换：只写目标分类 */
      var cats;
      if (state.mode === 'replace') {
        cats = newCat ? [newCat] : state.categories.filter(function (c) { return c.id === catId; });
      } else {
        cats = newCat ? state.categories.concat([newCat]) : state.categories;
      }
      return (state.mode === 'replace'
          ? clearStore('categories').then(function () { return clearStore('items'); })
          : Promise.resolve())
        .then(function () { return putAll('categories', cats); })
        .then(function () { return putAll('items', state.mode === 'replace' ? items : state.items.concat(items)); })
        .then(reload)
        .then(function () {
          renderStats(); renderStyleManage(); renderImgCatSelect();
          if (sl.open) renderStyleWall();
          imgBusy = false;
          if (btn) btn.disabled = false;
          if (items.length) {
            showImportMsg('ok', '成功导入 ' + items.length + ' 件衣服（图片已存本机，离线可用）', errors);
            toast('已导入 ' + items.length + ' 件衣服');
          } else {
            showImportMsg('err', '导入失败，没有可用的图片', errors);
          }
        });
    }).catch(function (e) {
      imgBusy = false;
      if (btn) btn.disabled = false;
      showImportMsg('err', '写入数据库失败：' + e, errors);
    });
  }

  /* ---------------- 初始化 ---------------- */
  function reload() {
    return Promise.all([getAll('categories'), getAll('items')]).then(function (rs) {
      state.categories = rs[0].sort(sortBySort);
      state.items = rs[1];
    });
  }

  function bindActions() {
    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      var act = b.dataset.act;
      if (act === 'sl-close') { closeStyleLib(); }
      else if (act === 'sl-back-wall') { slBackWall(); }
      else if (act === 'sl-back-grid') { slBackGrid(); }
      else if (act === 'preview-wall') { openStyleLib(); }
      else if (act === 'style-add-inline') { submitInlineStyle(); }
      else if (act === 'style-create') { submitStyleModal(); }
      else if (act === 'modal-close') { closeStyleModal(); }
      else if (act === 'style-cover') { openCoverModal(b.dataset.coverCat); }
      else if (act === 'cover-close') { closeCoverModal(); }
      else if (act === 'cover-upload') { if ($('#cover-input')) $('#cover-input').click(); }
      else if (act === 'cover-reset') { if (coverCatId) setStyleCover(coverCatId, ''); }
      else if (act === 'dl-template') {
        download('wardrobe-template.json', { version: 1, categories: [], items: [] });
        toast('空模板已下载');
      }
      else if (act === 'dl-data') {
        download('wardrobe-backup-' + new Date().toISOString().slice(0, 10) + '.json', {
          version: Date.now(),   /* 时间戳版本号：客人端只认更大的版本，保证更新必达 */
          exportedAt: new Date().toISOString(),
          categories: state.categories,
          items: state.items
        });
        toast('当前数据已导出');
      }
      else if (act === 'pick-file') { $('#file-input').click(); }
      else if (act === 'pick-images') { $('#image-input').click(); }
      else if (act === 'import-paste') {
        var txt = $('#paste-area').value.trim();
        if (!txt) { toast('请先粘贴 JSON 内容'); return; }
        try { doImport(JSON.parse(txt)); }
        catch (err) { showImportMsg('err', 'JSON 解析失败', [err.message]); }
      }
      else if (act === 'clear') {
        if (b.classList.contains('armed')) {
          clearStore('categories').then(function () { return clearStore('items'); }).then(reload).then(function () {
            renderStats(); renderStyleManage(); renderImgCatSelect();
            if (sl.open) renderStyleWall();
            b.classList.remove('armed'); b.textContent = '清空所有数据';
            toast('已清空全部数据');
          });
        } else {
          b.classList.add('armed'); b.textContent = '再点一次，确认清空';
          setTimeout(function () { b.classList.remove('armed'); b.textContent = '清空所有数据'; }, 3000);
        }
      }
    });

    /* 风格卡管理：删除空风格（有衣服的卡片不允许删，避免误删数据） */
    var slist = $('#style-list');
    if (slist) slist.addEventListener('click', function (e) {
      var d = e.target.closest('[data-del-cat]');
      if (!d) return;
      deleteEmptyStyle(d.dataset.delCat);
    });

    /* 封面弹窗：从本风格衣服里挑一张（空图标的按钮不响应） */
    var pickBox = $('#cover-pick');
    if (pickBox) pickBox.addEventListener('click', function (e) {
      var t = e.target.closest('.cover-thumb');
      if (!t || !coverCatId) return;
      var url = t.dataset.img || '';
      if (!url) { toast('这件衣服还没有图片'); return; }
      setStyleCover(coverCatId, url);
    });

    /* 封面弹窗：上传本地图片（压缩后存本机，离线可用） */
    var coverInput = $('#cover-input');
    if (coverInput) coverInput.addEventListener('change', function () {
      var f = this.files && this.files[0];
      this.value = '';
      if (!f || !coverCatId) return;
      var cat = coverCatId;
      var btn = $('[data-act="cover-upload"]');
      if (btn) btn.disabled = true;
      toast('正在处理封面图…');
      compressImage(f).then(function (r) {
        return setStyleCover(cat, r.dataUrl);
      }).then(function () {
        if (btn) btn.disabled = false;
      }).catch(function (err) {
        if (btn) btn.disabled = false;
        toast('封面设置失败：' + err.message);
      });
    });

    /* 两个风格名输入框：回车即提交 */
    var sn = $('#style-name');
    if (sn) sn.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submitStyleModal(); }
    });
    var si = $('#style-name-inline');
    if (si) si.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submitInlineStyle(); }
    });

    $('#file-input').addEventListener('change', function () {
      var f = this.files && this.files[0];
      if (!f) return;
      readFile(f).then(doImport).catch(function (err) {
        showImportMsg('err', '导入失败', [err.message]);
      });
      this.value = '';
    });

    $('#image-input').addEventListener('change', function () {
      var files = this.files;
      this.value = '';
      importImages(files);
    });

    $('#import-mode').addEventListener('click', function (e) {
      var b = e.target.closest('[data-mode]');
      if (!b) return;
      state.mode = b.dataset.mode;
      $$('#import-mode button').forEach(function (x) { x.classList.toggle('on', x === b); });
      $('#mode-tip').textContent = state.mode === 'merge'
        ? '合并导入：同 ID 的数据会被覆盖，其余保留。JSON 与图片两种导入方式均遵循此模式。'
        : '替换全部：先清空现有数据，再写入新内容。JSON 与图片两种导入方式均遵循此模式。';
    });
  }

  function renderFmtExample() {
    $('#fmt-example').textContent =
'{\n' +
'  "version": 1,\n' +
'  "categories": [\n' +
'    { "id": "cat-id", "name": "证件照", "sort": 1, "desc": "", "cover": "" }\n' +
'  ],\n' +
'  "items": [\n' +
'    {\n' +
'      "id": "item-001",\n' +
'      "categoryId": "cat-id",\n' +
'      "name": "藏青西装外套",\n' +
'      "image": "images/主图_001.jpg（或 https 链接 / base64）",\n' +
'      "desc": "上镜显精神，肩线平整",\n' +
'      "sort": 1\n' +
'    }\n' +
'  ]\n' +
'}\n' +
'\n' +
'说明：\n' +
'· categories = 风格墙上的卡片（证件照 / 领证照 / 亲子照…），cover 留空则自动取该风格第一件衣服的图；\n' +
'· items = 某风格下的衣服，categoryId 必须指向上面的风格 id；\n' +
'· 本应用不做销售呈现：条目只保留名称、图片、说明、排序，其它键一律忽略；\n' +
'· 更新线上内容：先在「数据管理」导出，覆盖仓库里的 catalog.json，再更新部署。';
  }

  function init() {
    bindActions();
    bindStyleLib();
    renderFmtExample();
    applyMode();
    reload().then(function () {
      renderStats();
      renderStyleManage();
      renderImgCatSelect();
      return syncCatalog();
    }).then(function () {
      if (sl.open) renderStyleWall();   /* 同步到新数据后刷新风格墙 */
    });
    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
    if (isAdminMode()) {
      $('#splash').classList.remove('active');
      showView('data');   /* 店主端独立入口：跳过启动动画，直达数据管理 */
    } else {
      /* 顾客端：启动动画结束后直接落在拍照风格墙上 ——
         风格库就是主界面，中间不再经过任何"店铺首页"或入口按钮。 */
      setTimeout(function () {
        $('#splash').classList.remove('active');
        openStyleLib();
      }, 2400);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
