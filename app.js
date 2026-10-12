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
    if (state.view === 'detail' || state.view === 'data') { showView('main'); }
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
    var strip = $('#cat-strip'), pager = $('#pager');

    if (!state.categories.length) {
      strip.innerHTML = '';
      if (isAdminMode()) {
        /* 店主端空态：完整引导，含导入入口 */
        pager.innerHTML =
          '<div class="empty">' +
            '<div class="empty-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 7.6a2 2 0 1 1 2-2c0 1.1-2 1.9-2 3.2"/><path d="M12 8.9 3.6 16.7a1.4 1.4 0 0 0 1 2.3h14.8a1.4 1.4 0 0 0 1-2.3z"/></svg></div>' +
            '<h2>衣橱还是空的</h2>' +
            '<p>选几个衣服图片，或导入一份 JSON 数据</p>' +
            '<button class="btn btn-primary" data-act="open-data">导入数据</button>' +
            '<button class="btn btn-ghost" data-act="dl-template">下载空模板</button>' +
          '</div>';
      } else {
        /* 顾客端空态：只传达"上新中"，不暴露任何店主操作 */
        pager.innerHTML =
          '<div class="empty">' +
            '<div class="empty-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 7.6a2 2 0 1 1 2-2c0 1.1-2 1.9-2 3.2"/><path d="M12 8.9 3.6 16.7a1.4 1.4 0 0 0 1 2.3h14.8a1.4 1.4 0 0 0 1-2.3z"/></svg></div>' +
            '<h2>新衣上新中</h2>' +
            '<p>店里正在整理新款，稍后回来看看</p>' +
          '</div>';
      }
      return;
    }

    var cnt = counts();
    strip.innerHTML = state.categories.map(function (c, i) {
      return '<button class="cat-chip' + (i === 0 ? ' on' : '') + '" data-i="' + i + '">' +
        '<span>' + esc(c.name) + '</span><i>' + (cnt[c.id] || 0) + '</i></button>';
    }).join('');

    pager.innerHTML = state.categories.map(function (c, i) {
      var items = state.items.filter(function (it) { return it.categoryId === c.id; }).sort(sortBySort);
      return '<div class="page" data-i="' + i + '">' +
        '<div class="page-hero">' +
          '<div class="page-cat">' + esc(c.name) + '</div>' +
          '<div class="page-sub">' + items.length + ' 件' + (c.desc ? ' · ' + esc(c.desc) : '') + '</div>' +
        '</div>' +
        '<div class="grid">' +
          (items.length ? items.map(cardHTML).join('') : '<div class="grid-empty">该分类下还没有衣服</div>') +
        '</div>' +
      '</div>';
    }).join('');

    if (state.active >= state.categories.length) state.active = 0;
    pager.scrollLeft = state.active * pager.clientWidth;
  }

  function cardHTML(it) {
    var img = it.image
      ? '<img loading="lazy" src="' + escAttr(it.image) + '" alt="' + escAttr(it.name) + '" onerror="this.classList.add(\'img-err\')">'
      : '';
    var sizes = (it.sizes || []).slice(0, 3).map(function (s) { return '<i>' + esc(s) + '</i>'; }).join('');
    return '<button class="card" data-id="' + escAttr(it.id) + '">' +
      '<div class="card-img">' + img + placeholder(it) + '</div>' +
      '<div class="card-body">' +
        '<div class="card-name">' + esc(it.name) + '</div>' +
        '<div class="card-row">' + sizes + '</div>' +
      '</div>' +
    '</button>';
  }

  /* ---------------- 翻页交互 ---------------- */
  var scrollT;
  function bindPager() {
    var pager = $('#pager'), strip = $('#cat-strip');
    pager.addEventListener('scroll', function () {
      $('#swipe-hint').classList.add('hide');
      clearTimeout(scrollT);
      scrollT = setTimeout(function () {
        var i = Math.round(pager.scrollLeft / pager.clientWidth);
        setActive(i);
      }, 90);
    }, { passive: true });
    strip.addEventListener('click', function (e) {
      var b = e.target.closest('.cat-chip');
      if (!b) return;
      pager.scrollTo({ left: parseInt(b.dataset.i, 10) * pager.clientWidth, behavior: 'smooth' });
    });
    pager.addEventListener('click', function (e) {
      var c = e.target.closest('.card');
      if (c) openDetail(c.dataset.id);
    });
  }
  function setActive(i) {
    if (i === state.active) return;
    state.active = i;
    var chips = $$('.cat-chip');
    chips.forEach(function (b, j) { b.classList.toggle('on', j === i); });
    if (chips[i]) {
      try { chips[i].scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); } catch (e) {}
    }
  }

  /* ---------------- 详情页 ---------------- */
  function openDetail(id) {
    var it = state.items.find(function (x) { return x.id === id; });
    if (!it) return;
    var cat = state.categories.find(function (c) { return c.id === it.categoryId; });
    $('#detail-cat').textContent = cat ? cat.name : '未分类';
    $('#detail-img').innerHTML =
      (it.image ? '<img src="' + escAttr(it.image) + '" alt="' + escAttr(it.name) + '" onerror="this.classList.add(\'img-err\')">' : '') +
      placeholder(it);
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
      return;
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
    done().catch(function (e) { if (!silent) showImportMsg('err', '写入数据库失败：' + e); });
  }

  /* ---------------- 在线 catalog 自动加载（扫码方案专用） ----------------
     客人扫码打开自己手机时本地库是空的，启动时自动拉取店里统一的
     catalog.json 并导入；店主无需逐台设备录入，换手机也不用重新导入。 */
  function loadCatalogIfEmpty() {
    if (state.categories.length || state.items.length) return Promise.resolve();
    return fetch('catalog.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        /* 合并模式拉取，绝不覆盖客人本机已有数据 */
        var prevMode = state.mode;
        state.mode = 'merge';
        doImport(data, true);
        state.mode = prevMode;
      })
      .catch(function () { /* 无 catalog 或加载失败：保持空态，走手动导入流程 */ });
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
      else if (act === 'back') { closeView(); }
      else if (act === 'dl-template') {
        download('wardrobe-template.json', { version: 1, categories: [], items: [] });
        toast('空模板已下载');
      }
      else if (act === 'dl-data') {
        download('wardrobe-backup-' + new Date().toISOString().slice(0, 10) + '.json', {
          version: 1,
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
    bindPager();
    bindActions();
    renderFmtExample();
    applyMode();
    reload().then(function () {
      renderMain();
      renderStats();
      renderImgCatSelect();
      return loadCatalogIfEmpty();
    });
    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
    if (isAdminMode()) {
      showView('data');   /* 店主端独立入口：跳过启动动画，直达数据管理 */
    } else {
      setTimeout(function () { showView('main'); }, 2400);  /* 顾客端：启动动画后进主界面 */
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
