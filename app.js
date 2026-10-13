/* ============================================================
   衣橱 · 轻选衣 — 应用逻辑
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
  function isHexColor(c) { return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(String(c || '')); }
  function placeholder(it) {
    var c = (it.colors && it.colors[0]) || '';
    var bg;
    if (isHexColor(c)) {
      bg = 'linear-gradient(150deg,' + c + ',' + 'rgba(11,9,16,.92)' + ')';
    } else {
      var h = hashStr(it.id || it.name);
      bg = 'linear-gradient(150deg,hsl(' + (h % 360) + ' 42% 30%),hsl(' + ((h + 40) % 360) + ' 38% 16%))';
    }
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

  /* ---------------- 视图切换 ---------------- */
  function showView(v) {
    state.view = v;
    $$('.screen').forEach(function (s) { s.classList.remove('active'); });
    $('#' + v).classList.add('active');
  }
  function openView(v) {
    showView(v);
    try { history.pushState({ view: v }, ''); } catch (e) {}
  }
  function closeView() {
    if (history.state && history.state.view) { history.back(); }
    else { showView('main'); }
  }
  window.addEventListener('popstate', function () {
    var s = history.state || {};
    if (sl.open) {
      /* 三层栈：{sl:1}=风格墙  {sl:2}=模板库网格  {sl:3}=放大查看
         按下返回键逐层回退：放大→网格→墙→关库 */
      if (sl.layer === 'browser' && s.sl === 2) { slToGrid(); return; }
      if (sl.layer === 'grid' && s.sl === 1) { slToWall(); return; }
      if (!s.sl || s.sl === 1) { closeStyleLib(true); return; }   /* 墙层 → 关库回首页 */
    }
    if (state.view === 'detail' || state.view === 'data') {
      /* 店主模式下详情返回应回数据管理页，而不是顾客主界面 */
      showView(isAdminMode() ? 'data' : 'main');
    }
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
    var wasAdmin = document.body.classList.contains('mode-admin');
    applyMode();
    if (isAdminMode()) {
      if (sl.open) closeStyleLib(true);   /* 切店主模式先收掉风格库，避免盖住数据页 */
      if (state.view !== 'data') openView('data');        // 切入店主模式 → 直达数据管理
    } else if (wasAdmin && state.view === 'data') {
      showView('main');                                    // 退出店主模式 → 回顾客主界面
    }
  });

  /* ---------------- 主界面渲染 ---------------- */
  function counts() {
    var m = {};
    state.items.forEach(function (it) { m[it.categoryId] = (m[it.categoryId] || 0) + 1; });
    return m;
  }
  function sortBySort(a, b) { return (a.sort || 0) - (b.sort || 0); }

  function renderMain() {
    /* 顾客端首页：中性首页，不再呈现"在售商品"电商网格。
       首页只提供「进入拍照风格库」入口 + 各风格快捷卡（点开即进对应模板库）。 */
    var box = $('#main-styles');
    if (!box) return;
    var cats = slCats();
    if (!cats.length) {
      box.innerHTML = '<div class="home-empty">服装上新中，稍后回来看看</div>';
      return;
    }
    box.innerHTML =
      '<p class="home-tip">挑一套喜欢的风格，看看里面的衣服</p>' +
      cats.map(function (c) {
        var its = slStyleItems(c.id);
        var cover = its[0] && its[0].image ? its[0].image : '';
        var img = cover
          ? '<img draggable="false" src="' + escAttr(cover) + '" alt="" onerror="this.classList.add(\'img-err\')">'
          : '';
        return '<button class="home-style" data-cat="' + escAttr(c.id) + '">' +
          '<div class="home-style-cover">' + placeholder(its[0] || { id: c.id, name: c.name }) + img + '</div>' +
          '<span>' + esc(c.name) + '</span><i>' + its.length + ' 套</i>' +
        '</button>';
      }).join('');
  }

  function cardHTML(it) {
    /* 占位符必须在 img 之前：两者都是 absolute，后者绘制在上层，
       图片加载失败时 img-err 隐藏 img，占位符才露出作为兜底 */
    var img = it.image
      ? '<img draggable="false" loading="lazy" src="' + escAttr(it.image) + '" alt="' + escAttr(it.name) + '" onerror="this.classList.add(\'img-err\')">'
      : '';
    var sizes = (it.sizes || []).slice(0, 3).map(function (s) { return '<i>' + esc(s) + '</i>'; }).join('');
    return '<button class="card" data-id="' + escAttr(it.id) + '">' +
      '<div class="card-img">' + placeholder(it) + img + '</div>' +
      '<div class="card-body">' +
        '<div class="card-name">' + esc(it.name) + '</div>' +
        '<div class="card-row">' + sizes + '</div>' +
      '</div>' +
    '</button>';
  }

  /* ---------------- 拍照风格库（顾客端沉浸浏览） ----------------
     打开：主界面顶栏按钮 / 屏幕左右边缘横滑（边缘手势不与分类滚动冲突）
     两层：风格墙（分类封面大卡横滑）→ 风格全屏浏览（逐套服装横滑）
     历史栈：开库 push{sl:1} → 进风格 push{sl:2}；Android 返回键逐层退出；
             下滑手势等同"返回上一层"，同样走 history.back() 单一出口。   */
  var SL_EDGE = 26;          /* 边缘手势判定区宽度 px */
  var SL_OPEN_DX = 44;       /* 开库手势横向阈值 px */
  var SL_NAV_RATIO = 0.2;    /* 浏览翻页阈值 = 屏宽 × 此比例 */
  var SL_CLOSE_DY = 96;      /* 下滑"返回上一层"阈值 px */
  var SL_TAP_SLOP = 8;       /* 单击判定位移 px */

  var sl = { open: false, layer: 'wall', styleId: null, items: [], index: 0 };

  function slCounts() { return counts(); }
  function slCats() {
    var cnt = slCounts();
    return state.categories.filter(function (c) { return cnt[c.id] > 0; });
  }
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
        var catId = card.dataset.cat;
        if (!catId) { toast('新风格筹备中，敬请期待'); return; }
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
    var track = $('#sl-wall-track');    var html = cats.map(function (c) {
      var its = slStyleItems(c.id);
      var cover = its[0] && its[0].image ? its[0].image : '';
      var img = cover
        ? '<img draggable="false" src="' + escAttr(cover) + '" alt="" onerror="this.classList.add(\'img-err\')">'
        : '';
      return '<div class="sl-wall-slide" data-cat="' + escAttr(c.id) + '">' +
        '<div class="sl-cover">' + placeholder(its[0] || { id: c.id, name: c.name }) + img + '</div>' +
        '<div class="sl-wall-body">' +
          '<div class="sl-wall-name">' + esc(c.name) + '</div>' +
          '<div class="sl-wall-sub">' + its.length + ' 套' + (c.desc ? ' · ' + esc(c.desc) : '') + '</div>' +
          '<span class="sl-wall-go">进入浏览</span>' +
        '</div>' +
      '</div>';
    }).join('');
    /* 末尾固定一张"筹备中"卡：风格少时墙不空，也提示店主可扩展 */
    html += '<div class="sl-wall-slide sl-wall-soon" data-cat="">' +
      '<div class="sl-soon-card">' +
        '<div class="sl-soon-ic">?</div>' +
        '<div class="sl-soon-t">更多拍照风格筹备中</div>' +
        '<div class="sl-soon-s">店主在数据管理页新增分类后，这里会自动出现新风格</div>' +
      '</div>' +
    '</div>';
    track.innerHTML = html;
    $('#sl-wall-count').textContent = cats.length ? cats.length + ' 个风格' : '';
    wallSwiper.reset();   /* swiper 只初始化一次（bindStyleLib），此处仅重置位置 */
  }

  /* ---- 第二层：模板库（衣服缩略图网格） ---- */
  function renderGridView(catId) {
    var cat = state.categories.find(function (c) { return c.id === catId; });
    var items = slStyleItems(catId);
    $('#sl-grid-title').textContent = cat ? cat.name : '服装';
    $('#sl-grid-count').textContent = items.length + ' 件';
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
    var items = slStyleItems(catId);
    if (!cat || !items.length) { toast('该风格还没有衣服'); return; }
    sl.styleId = catId; sl.items = items; sl.layer = 'grid';
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
    var meta = '';
    (it.colors || []).forEach(function (c) {
      meta += '<span class="meta-chip"><i class="dot" style="background:' + (isHexColor(c) ? escAttr(c) : 'var(--primary)') + '"></i>' + esc(c) + '</span>';
    });
    (it.tags || []).forEach(function (t) { meta += '<span class="meta-chip tag">' + esc(t) + '</span>'; });
    $('#sl-meta').innerHTML = meta;
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
  function slBackWall() {
    if (history.state && history.state.sl === 2) { try { history.back(); return; } catch (e) {} }
    slToWall();
  }
  function slBackGrid() {
    if (history.state && history.state.sl === 3) { try { history.back(); return; } catch (e) {} }
    slToGrid();
  }

  /* ---- 开库 / 关库（历史栈单一出口） ---- */
  function slBackWall() {
    /* 浏览层 → 风格墙：优先用返回键消费 {sl:2}，保持栈一致；无栈环境直接切层 */
    if (history.state && history.state.sl === 2) {
      try { history.back(); return; } catch (e) {}
    }
    slToWall();
  }
  function openStyleLib() {
    if (sl.open) return;
    sl.open = true; sl.layer = 'wall';
    renderStyleWall();
    $('#stylelib').classList.add('open');
    $('#stylelib').setAttribute('aria-hidden', 'false');
    try { history.pushState({ sl: 1 }, ''); } catch (e) {}
  }
  function closeStyleLib(fromPop) {
    if (!sl.open) return;
    sl.open = false;
    $('#stylelib').classList.remove('open');
    $('#stylelib').setAttribute('aria-hidden', 'true');
    $('#sl-gridview').classList.remove('on');
    $('#sl-browser').classList.remove('on');
    $('#sl-browser').classList.remove('sl-immersive');
    if (isAdminMode()) showView('data'); else showView('main');   /* 露出底层首页 */
    if (!fromPop && history.state && history.state.sl) {
      try { history.back(); } catch (e) {}   /* 消费掉开库时压入的 state，栈保持干净 */
    }
  }

  /* 主界面边缘横滑开库：左缘右滑 / 右缘左滑均可（移动端边缘手势习惯） */
  function bindStyleLib() {
    /* 手势器只创建一次：重复创建会在同一 stage 上叠加监听器 */
    initSlSwipers();
    /* 首页「进入拍照风格库」按钮 */
    var enter = $('#home-enter');
    if (enter) enter.addEventListener('click', openStyleLib);
    /* 首页风格快捷入口：直接进对应模板库 */
    var styles = $('#main-styles');
    if (styles) styles.addEventListener('click', function (e) {
      var b = e.target.closest('.home-style');
      if (!b) return;
      openStyleLib(); openGridView(b.dataset.cat);
    });
    /* 第二层网格：点缩略图 → 放大查看 */
    var grid = $('#sl-grid-scroll');
    if (grid) grid.addEventListener('click', function (e) {
      var t = e.target.closest('.sl-thumb');
      if (!t) return;
      openBrowser(parseInt(t.dataset.i, 10));
    });
    /* 风格墙点卡进入逻辑在 wallSwiper.onTap 内完成（setPointerCapture 会重定靶
       click 事件到 stage，因此不能再用 stage 级 click 委托，详见 makeSwiper） */
  }

  /* ---------------- 详情页 ---------------- */
  function openDetail(id) {
    var it = state.items.find(function (x) { return x.id === id; });
    if (!it) return;
    var cat = state.categories.find(function (c) { return c.id === it.categoryId; });
    $('#detail-cat').textContent = cat ? cat.name : '未分类';
    $('#detail-img').innerHTML =
      placeholder(it) +
      (it.image ? '<img draggable="false" src="' + escAttr(it.image) + '" alt="' + escAttr(it.name) + '" onerror="this.classList.add(\'img-err\')">' : '');
    $('#detail-name').textContent = it.name;
    var meta = '';
    (it.colors || []).forEach(function (c) {
      meta += '<span class="meta-chip"><i class="dot" style="background:' + (isHexColor(c) ? escAttr(c) : 'var(--primary)') + '"></i>' + esc(c) + '</span>';
    });
    (it.sizes || []).forEach(function (s) { meta += '<span class="meta-chip">尺码 ' + esc(s) + '</span>'; });
    (it.tags || []).forEach(function (t) { meta += '<span class="meta-chip tag">' + esc(t) + '</span>'; });
    $('#detail-meta').innerHTML = meta;
    $('#detail-desc').textContent = it.desc || '';
    $('#detail-desc').style.display = it.desc ? '' : 'none';
    openView('detail');
  }

  /* ---------------- 数据管理 ---------------- */
  function renderStats() {
    $('#stat-row').innerHTML =
      '<div class="stat"><b>' + state.categories.length + '</b><span>个分类</span></div>' +
      '<div class="stat"><b>' + state.items.length + '</b><span>件服装</span></div>';
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
        desc: typeof c.desc === 'string' ? c.desc : ''
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
      items.push({
        id: it.id, categoryId: it.categoryId, name: it.name,
        image: typeof it.image === 'string' ? it.image : '',
        sizes: Array.isArray(it.sizes) ? it.sizes.map(String) : [],
        colors: Array.isArray(it.colors) ? it.colors.map(String) : [],
        tags: Array.isArray(it.tags) ? it.tags.map(String) : [],
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
          renderMain(); renderStats(); renderImgCatSelect();
          if (silent) return;
          var msg = '导入成功：' + r.categories.length + ' 个分类，' + r.items.length + ' 件服装';
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
    html += '<option value="__new">＋ 新建分类（图片导入）</option>';
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
      var exist = state.categories.find(function (c) { return c.name === '图片导入'; });
      if (exist) { catId = exist.id; }
      else {
        catId = 'cat-img-' + Date.now().toString(36);
        var maxSort = state.categories.reduce(function (m, c) { return Math.max(m, c.sort || 0); }, 0);
        newCat = { id: catId, name: '图片导入', sort: maxSort + 1, desc: '由图片批量导入创建' };
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
            sizes: [], colors: [], tags: ['图片导入'], desc: '',
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
          renderMain(); renderStats(); renderImgCatSelect();
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
      if (act === 'open-data') { openView('data'); }
      else if (act === 'sl-close') { closeStyleLib(false); }
      else if (act === 'sl-back-wall') { slBackWall(); }
      else if (act === 'sl-back-grid') { slBackGrid(); }
      else if (act === 'sl-detail') { var cur = sl.items[sl.index]; if (cur) openDetail(cur.id); }
      else if (act === 'back') { closeView(); }
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
            renderMain(); renderStats(); renderImgCatSelect();
            b.classList.remove('armed'); b.textContent = '清空所有数据';
            toast('已清空全部数据');
          });
        } else {
          b.classList.add('armed'); b.textContent = '再点一次，确认清空';
          setTimeout(function () { b.classList.remove('armed'); b.textContent = '清空所有数据'; }, 3000);
        }
      }
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
'    { "id": "cat-dress", "name": "连衣裙", "sort": 1, "desc": "春夏新款" }\n' +
'  ],\n' +
'  "items": [\n' +
'    {\n' +
'      "id": "item-001",\n' +
'      "categoryId": "cat-dress",\n' +
'      "name": "浅紫碎花连衣裙",\n' +
'      "image": "https://example.com/1.jpg",\n' +
'      "sizes": ["S", "M", "L"],\n' +
'      "colors": ["#8B5CF6"],\n' +
'      "tags": ["新品", "显瘦"],\n' +
'      "desc": "雪纺面料，透气亲肤",\n' +
'      "sort": 1\n' +
'    }\n' +
'  ]\n' +
'}';
  }

  function init() {
    bindActions();
    bindStyleLib();
    renderFmtExample();
    applyMode();
    reload().then(function () {
      renderMain();
      renderStats();
      renderImgCatSelect();
      return syncCatalog();
    });
    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
    if (isAdminMode()) {
      $('#splash').classList.remove('active');
      showView('data');   /* 店主端独立入口：跳过启动动画，直达数据管理 */
    } else {
      /* 顾客端：启动动画后直接进入拍照风格库（扫码即可使用，无需先经过店铺首页） */
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
