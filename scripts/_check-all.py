# 综合校验：语法 / HTML 结构 / 事件接线 / CSS / catalog schema / 发布资产 / 双端隔离
# 用法：python scripts/_check-all.py
import json, os, re, shutil, subprocess, sys
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(ROOT, '..')
ok = True

def check(name, cond, detail=''):
    global ok
    print(('PASS' if cond else 'FAIL'), name, detail)
    if not cond: ok = False

def read(p):
    with open(os.path.join(APP, p), encoding='utf-8') as f:
        return f.read()

def node_check(jsf):
    """依次尝试：PATH 里的 node → 本机托管 node。
    （不再硬编码某一台机器的绝对路径，换机也不失效。）"""
    cands = [shutil.which('node')] + [
        r'C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2-6\node.exe',
    ]
    for exe in [c for c in cands if c]:
        try:
            r = subprocess.run([exe, '--check', os.path.join(APP, jsf)],
                               capture_output=True, text=True)
            return r.returncode == 0, r.stderr.strip()[:300]
        except FileNotFoundError:
            continue
    return True, '(未找到 node，跳过语法检查)'

# ---------- 0. 期望的 12 种拍摄风格（顺序即风格墙顺序） ----------
STYLES = ['证件照', '领证照', '亲子照', '全家福', '个人写真', '生日写真',
          '形象照', '男宝宝周岁照', '女宝宝周岁照', '老人像', '闺蜜照', '情侣照']

# ---------- 1. JS 语法 ----------
for jsf in ['app.js', 'sw.js']:
    c, detail = node_check(jsf)
    check('node --check ' + jsf, c, detail)

appjs = read('app.js')
html = read('index.html')
css = read('styles.css')

# ---------- 2. index.html 结构 ----------
class P(HTMLParser):
    VOID = {'meta', 'link', 'img', 'br', 'hr', 'input', 'path', 'circle', 'rect', 'line', 'ellipse'}
    def __init__(self):
        super().__init__(); self.stack = []; self.errs = []
    def handle_starttag(self, tag, attrs):
        if tag not in self.VOID: self.stack.append(tag)
    def handle_endtag(self, tag):
        if tag in self.VOID: return
        if not self.stack or self.stack[-1] != tag: self.errs.append('mismatch </%s>' % tag)
        else: self.stack.pop()
p = P(); p.feed(html)
check('index.html 标签配对', not p.errs and not p.stack, str(p.errs[:3] + p.stack[:3]))

# ---------- 3. 没有独立首页：顾客端主界面 = 风格库 ----------
check('已移除首页区块 #main', 'id="main"' not in html and "$('#main" not in appjs)
check('已移除旧分类条/翻页器', 'id="cat-strip"' not in html and 'id="pager"' not in html)
check('index.html 含风格库 #stylelib', 'id="stylelib"' in html)
check('app.js 启动即开风格库', 'openStyleLib();' in appjs and "showView('main')" not in appjs)
check('店主专属控件类存在', 'sl-admin-only' in html and '.sl-admin-only' in css)

# ---------- 3.5 去商品化：界面不得出现任何商品销售呈现 ----------
# ① 商品详情屏与规格模块整块移除
check('已移除服装详情屏 #detail', 'id="detail"' not in html and 'id="detail-name"' not in html)
check('已移除详情页逻辑 openDetail', 'function openDetail' not in appjs)
check('已移除「查看详情」按钮', 'sl-detail' not in html and 'sl-detail' not in appjs)
check('已移除 meta-chip 规格胶囊', 'meta-chip' not in html and 'meta-chip' not in css)
check('已移除商品规格渲染（colors/sizes/tags）',
      'it.colors' not in appjs and 'it.sizes' not in appjs and 'it.tags' not in appjs)
check('normalizeImport 不再收录商品规格字段',
      not re.search(r'^\s*(sizes|colors|tags):', appjs, re.M))
check('放大层只显示风格名 + 说明', "meta = cat ? cat.name : ''" in appjs)
check('风格墙无「上架」类电商文案', '待上架' not in appjs and '上架' not in appjs)

# ② 用户可见文案里不得出现销售词汇（注释与说明性否定句已剥离，只看真正会渲染出来的文本）
BAN_WORDS = ['在售', '价格', '售价', '标价', '库存', '购买', '下单', '购物车', '结算',
             '加购', '促销', '优惠', '折扣', '销量', '已售', '现货', '包邮', '发货',
             '上架', '尺码', '商品', '元/件', '原价']
scan_srcs = {
    'index.html': re.sub(r'<!--.*?-->', '', html, flags=re.S),
    'app.js': re.sub(r'//.*$', '', re.sub(r'/\*.*?\*/', '', appjs, flags=re.S), flags=re.M),
    'styles.css': re.sub(r'/\*.*?\*/', '', css, flags=re.S),
    'catalog.json': read('catalog.json'),
}
for fn2, src in scan_srcs.items():
    hit = [w for w in BAN_WORDS if w in src]
    check('销售词汇零残留: ' + fn2, not hit, str(hit))

# ---------- 4. JS 引用的 #id 必须在 HTML 中存在 ----------
html_ids = set(re.findall(r'id="([^"]+)"', html))
ref_ids = set(re.findall(r"\$\('#([A-Za-z0-9_-]+)'\)", appjs))
missing = sorted(ref_ids - html_ids)
check('JS 引用的 #id 全部存在于 HTML', not missing, str(missing))

# ---------- 5. HTML 里的 data-act 必须有处理分支 ----------
acts_html = set(re.findall(r'data-act="([^"]+)"', html))
acts_js = set(re.findall(r"act === '([a-z-]+)'", appjs))
check('所有 data-act 均有处理函数', not (acts_html - acts_js), str(sorted(acts_html - acts_js)))

# ---------- 6. 三层层级与手势要件 ----------
for frag, name in [
    ('function makeSwiper', '通用滑动手势工厂'),
    ('function renderStyleWall', '渲染风格墙'),
    ('function openGridView', '进入模板库网格'),
    ('function openBrowser', '进入放大查看'),
    ('function slToWall', '回风格墙'),
    ('function slToGrid', '回模板库网格'),
    ('function slBackWall', '网格 → 风格墙'),
    ('function slBackGrid', '放大 → 网格'),
    ('function updateBrowserChrome', '放大层 chrome 更新'),
    ('function openStyleLib', '打开风格库'),
    ('function closeStyleLib', '关闭风格库（仅店主端）'),
    ('function addStyle', '店主新增模板卡'),
    ('function deleteEmptyStyle', '删除空风格'),
    ('function openStyleModal', '添加模板卡弹窗'),
    ('function renderStyleManage', '店主端模板卡列表'),
    ('function openCoverModal', '打开卡片封面设置弹窗'),
    ('function renderCoverModal', '渲染封面弹窗（预览 + 可选图）'),
    ('function setStyleCover', '写入封面字段'),
    ("cover: typeof c.cover === 'string'", '导入时保留分类 cover 字段'),
    ("cover: ''", '新建模板卡带空 cover'),
    ("act === 'style-cover'", 'data-act: style-cover'),
    ("act === 'cover-upload'", 'data-act: cover-upload'),
    ("act === 'cover-reset'", 'data-act: cover-reset'),
    ("act === 'cover-close'", 'data-act: cover-close'),
    ("$('#cover-input')", '封面图片选择框'),
    ("$('#cover-pick')", '从本风格衣服里选封面'),
    ("c.cover", '风格墙读取自定义封面'),
    ('SL_NAV_RATIO', '翻页阈值常量'),
    ('SL_CLOSE_DY', '下滑返回常量'),
    ('function initSlSwipers', '手势器一次性初始化'),
    ("history.pushState({ sl: 2 }", '进网格压栈 sl:2'),
    ("history.pushState({ sl: 3 }", '放大压栈 sl:3'),
    ('popstate', '返回键分层处理'),
    ('sl-immersive', '沉浸模式 class'),
    ("act === 'sl-close'", 'data-act: sl-close'),
    ("act === 'sl-back-wall'", 'data-act: sl-back-wall'),
    ("act === 'sl-back-grid'", 'data-act: sl-back-grid'),
    ("act === 'preview-wall'", 'data-act: preview-wall'),
    ("act === 'style-create'", 'data-act: style-create'),
    ("act === 'style-add-inline'", 'data-act: style-add-inline'),
    ('draggable="false"', '图片禁用原生拖拽'),
    ('class="ph"', '占位层（图片缺失兜底）存在'),
]:
    check('JS 要件: ' + name, frag in appjs)

# 顾客端打开风格库不压栈（栈底即本页，墙上再返回=离开页面）
m = re.search(r'function openStyleLib\(\)\s*\{(.*?)\n  \}', appjs, re.S)
check('openStyleLib 内不压历史栈', bool(m) and 'pushState' not in m.group(1))

# ---------- 7. CSS 要件 ----------
check('CSS 花括号配对', css.count('{') == css.count('}'),
      '%d vs %d' % (css.count('{'), css.count('}')))
for frag, name in [
    ('.stylelib{', '风格库覆盖层'),
    ('.stylelib.open', '开库展开态'),
    ('.sl-wall-stage', '风格墙舞台'),
    ('.sl-wall-track', '风格墙 track'),
    ('.sl-wall-add', '店主端添加风格卡样式'),
    ('.sl-gridview', '模板库网格层'),
    ('.sl-grid-scroll', '网格滚动容器'),
    ('.sl-grid-empty', '空风格空态'),
    ('.sl-browser', '放大查看层'),
    ('.sl-browser.on', '放大层展开'),
    ('.sl-slide img', '放大图规则'),
    ('max-height:100%', '比例保持 max-height'),
    ('touch-action:none', '手势区禁用原生滚动'),
    ('prefers-reduced-motion', '降低动效降级'),
    ('sl-immersive', '沉浸模式样式'),
    ('pv-anim', 'track 过渡类'),
    ('.modal.open', '添加模板卡弹窗'),
    ('.style-row', '模板卡管理行'),
    ('.style-row-thumb', '管理行缩略封面'),
    ('.style-row-btn', '管理行「封面」按钮'),
    ('.modal-box-lg', '封面弹窗宽版容器'),
    ('.cover-preview', '封面预览块'),
    ('.cover-pick-grid', '从衣服选封面网格'),
    ('.cover-thumb', '封面候选缩略图'),
    ('body.mode-admin .iconbtn.sl-admin-only', '店主专属控件显隐规则'),
]:
    check('CSS 要件: ' + name, frag in css)

m = re.search(r'\.sl-slide img\{([^}]*)\}', css)
check('.sl-slide img 含 max-width/max-height/auto',
      bool(m) and 'max-width:100%' in m.group(1) and 'max-height:100%' in m.group(1)
      and 'width:auto' in m.group(1) and 'height:auto' in m.group(1))

# 已删除的旧样式不应残留
for dead in ['.cat-strip', '.cat-chip', '.pager{', '.page-hero', '.swipe-hint', '.home-enter',
             '.sl-soon-card', '.style-row-num', '.detail-', '.meta-chip', '.sl-detail-btn',
             '.pv-stage', '.pv-track', '.pv-slide', '.pv-nav', '.pv-bar', '.pv-note',
             '.brand', '.mode-chip', '#btn-admin']:
    check('已清理死样式: ' + dead, dead not in css)

# ---------- 7.7 CSS 颜色字面量合法性（全项目质量审计新增） ----------
# 曾出现 #22184（5 位）：CSS 不报错，但带非法值的整条 background 简写会被丢弃，
# 启动页光晕静默消失。这里扣掉注释后逐个数长度，防回归。
css_code = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
bad_colors = [(css_code[:m.start()].count('\n') + 1, m.group(0))
              for m in re.finditer(r'#[0-9a-fA-F]{1,10}\b', css_code)
              if len(m.group(0)) - 1 not in (3, 4, 6, 8)]
check('CSS 颜色字面量长度为 3/4/6/8 位', not bad_colors, str(bad_colors))

# ---------- 7.8 破图兜底：全局单条规则（不再按容器重复） ----------
check('破图兜底为全局单条 img.img-err 规则', 'img.img-err{display:none}' in css)
check('破图兜底没有按容器重复定义', css.count('img.img-err') == 1, 'n=%d' % css.count('img.img-err'))
check('app.js 无内联 onerror 属性（统一走捕获阶段委托）',
      'onerror="' not in appjs and "addEventListener('error'" in appjs)
check('弹窗关闭态用 visibility:hidden（退出 Tab 顺序）',
      'visibility:hidden' in css and '.modal.open{opacity:1;visibility:visible' in css)

# ---------- 7.9 错误处理对称性 + 降级兜底（质量审计新增） ----------
check('addStyle 写库失败有提示（与 items 侧对称）', "toast('添加风格失败：" in appjs)
check('deleteEmptyStyle 复用 removeRecord', "return removeRecord('categories', catId)" in appjs)
check('setStyleCover 写库失败有提示', "toast('封面保存失败：" in appjs)
check('init 有致命降级兜底（IndexedDB 不可用）', 'function showFatal' in appjs and '.catch(showFatal)' in appjs)
check('风格名长度有二次夹紧（不只靠 maxlength）',
      'var STYLE_NAME_MAX = 12' in appjs and 'slice(0, STYLE_NAME_MAX)' in appjs)
check('renameItem 找不到条目时给反馈并收弹窗',
      "'这件衣服已经不在了'" in appjs)
check('删除按钮的无障碍名与可见文字一致',
      "aria-label=\"' + (armed ? '确认删除' : '删除') + '\"" in appjs)
# 死代码不得回归（审计中删掉的未使用常量 / 状态字段）
check('未使用的边缘手势常量已删除',
      'SL_EDGE' not in appjs and 'SL_OPEN_DX' not in appjs and 'SL_TAP_SLOP' not in appjs)
check('未使用的 state.active 已删除', 'active:' not in appjs)

# ---------- 7.5 品牌：石榴照相馆 ----------
check('index.html 品牌为石榴照相馆', '石榴照相馆' in html)
check('index.html 标题含石榴照相馆', '<title>石榴照相馆' in html)
check('启动页标题为石榴照相馆', 'class="splash-title">石榴照相馆<' in html)
check('manifest 名称含石榴照相馆', '石榴照相馆' in read('manifest.webmanifest'))
check('offline.html 品牌为石榴照相馆', '石榴照相馆' in read('offline.html'))

# ---------- 7.6 衣服清单（数据管理页 · 条目级增删改） ----------
check('index.html 含衣服清单容器 #item-list', 'id="item-list"' in html)
check('index.html 含改名弹窗 #item-modal', 'id="item-modal"' in html)
check('index.html 含换图输入 #item-img-input', 'id="item-img-input"' in html)
check('数据管理页含衣服清单卡片', '衣服清单（全部条目）' in html)
check('app.js 定义 renderItemManage', 'function renderItemManage' in appjs)
check('app.js 定义 findItem', 'function findItem' in appjs)
check('app.js 定义 deleteItem', 'function deleteItem' in appjs)
check('app.js 定义 renameItem', 'function renameItem' in appjs)
check('app.js 定义 setItemImage', 'function setItemImage' in appjs)
check('app.js 定义 moveItemCat', 'function moveItemCat' in appjs)
check('app.js 定义 armOrDeleteItem（二次确认）', 'function armOrDeleteItem' in appjs)
check('app.js 定义 openItemModal / closeItemModal / submitItemRename',
      'function openItemModal' in appjs and 'function closeItemModal' in appjs
      and 'function submitItemRename' in appjs)
check('app.js 定义 itemRecord（字段收口）', 'function itemRecord' in appjs)
check('app.js 定义 updateItem（唯一写库出口）', 'function updateItem' in appjs)
check('app.js 定义 itemRowHTML（单行模板）', 'function itemRowHTML' in appjs)
check('app.js 定义 syncRowImage（图片按需赋 src）', 'function syncRowImage' in appjs)
check('app.js 定义 removeRecord（单键删除）', 'function removeRecord' in appjs)
check('app.js 定义 errText（错误文案归一）', 'function errText' in appjs)
check('app.js 定义 renderedOrder（就地更新指纹）', 'renderedOrder' in appjs)
# 写库白名单必须与 catalog 一致：不得把 sizes / colors / tags 等商品字段写回库里
seg_rec = appjs[appjs.index('function itemRecord'):appjs.index('function afterItemsChanged')]
check('itemRecord 只写 6 个允许字段',
      all(k in seg_rec for k in ['id:', 'categoryId:', 'name:', 'image:', 'desc:', 'sort:']))
check('itemRecord 不含商品规格字段', not re.search(r'sizes|colors|tags', seg_rec))
check('删除需二次确认（armed 态 + 定时还原）',
      'itemDelArmed' in appjs and '确认删除' in appjs and 'itemDelTimer' in appjs)
check('换图走同一套图片压缩 compressImage',
      bool(re.search(r"item-img-input'\)[\s\S]{0,600}?compressImage", appjs)))
check('写入后统一刷新 afterItemsChanged', 'function afterItemsChanged' in appjs)
seg_after = appjs[appjs.index('function afterItemsChanged'):appjs.index('function updateItem')]
check('afterItemsChanged 不重建分类下拉（否则会重置店主已选分类）',
      'renderImgCatSelect' not in seg_after)
check('错误处理用双参 then（不把渲染错误误报成保存失败）',
      'function () { afterItemsChanged(); return true; }' in appjs)
seg_row = appjs[appjs.index('function itemRowHTML'):appjs.index('function syncRowImage')]
check('行模板用 data-img-for（不把 base64 大图拼进 HTML 字符串）', 'data-img-for' in seg_row)
check('行模板不再内联 onerror', 'onerror' not in seg_row)
check('行模板不再把 image 拼进字符串', 'escAttr(it.image)' not in seg_row)
check('图片失败改全局捕获阶段委托',
      "document.addEventListener('error'" in appjs and '}, true);' in appjs)
check('清单重建后还原滚动位置', 'box.scrollTop = top' in appjs)
check('名字长度上限两处一致',
      'var ITEM_NAME_MAX = 24' in appjs and 'maxlength="24"' in html)
check('待确认时长用常量而非魔数', 'ITEM_ARM_MS' in appjs)
check('游离风格条目有占位项（防下拉静默跳风格）', '原风格已不存在' in appjs)
check('清单顺序跟随风格顺序', 'order[a.categoryId]' in appjs)
check('空清单有引导文案', '还没有衣服' in appjs)
for hook in ['data-thumb-item', 'data-rename-item', 'data-del-item', 'data-move-item',
              'data-desc-item', 'data-item=']:
    check('衣服清单钩子: ' + hook, hook in appjs)
check('说明编辑有写库函数 setItemDesc', 'function setItemDesc' in appjs)
check('说明编辑走 itemRecord 白名单', "itemRecord(it, { desc: next })" in appjs)
check('item-rename 有处理分支', "act === 'item-rename'" in appjs)
check('item-modal-close 有处理分支', "act === 'item-modal-close'" in appjs)
init_seg = appjs[appjs.index('function init()'):]
check('init 渲染衣服清单', 'renderItemManage();' in init_seg)
check('风格卡仍受保护：非空不可删', '该风格下已有衣服，不能删除' in appjs)
check('风格删除按钮仅在空风格出现', '(n === 0 ?' in appjs)
for cls in ['.item-list{', '.item-list::-webkit-scrollbar', '.item-row{', '.item-row.armed',
            '.item-row-thumb', '.item-row-name', '.sel.item-row-cat', '.item-row-desc',
            '.item-row-del', '.item-row.armed .item-row-del', '.item-row-none']:
    check('衣服清单样式: ' + cls, cls in css)

# ---------- 8. catalog.json schema ----------
cat = json.loads(read('catalog.json'))
check('catalog version 为数字', isinstance(cat.get('version'), int) and cat['version'] > 1)
cats = cat['categories']; items = cat['items']
catids = {c['id'] for c in cats}
names = [c['name'] for c in sorted(cats, key=lambda c: c.get('sort', 0))]
check('catalog 分类 id 唯一', len(catids) == len(cats))
for c in cats:
    check('分类字段完整: ' + c.get('id', '?'), bool(c.get('id')) and bool(c.get('name')))
for c in cats:
    check('分类 cover 字段为字符串: ' + c.get('id', '?'), isinstance(c.get('cover'), str))
check('12 种拍摄风格齐全且顺序正确', names == STYLES, str(names))
check('物品字段完整 + 归属分类存在',
      all(bool(i.get('id')) and bool(i.get('name')) and i.get('categoryId') in catids for i in items))
check('物品 id 唯一', len({i['id'] for i in items}) == len(items))
imgrefs = [i['image'] for i in items if i.get('image')]
for img in imgrefs:
    check('图片磁盘存在: ' + img, os.path.exists(os.path.join(APP, img.replace('/', os.sep))))
check('图片引用无重复', len(imgrefs) == len(set(imgrefs)), 'n=%d' % len(imgrefs))
# 条目字段收口：只允许 id / categoryId / name / image / desc / sort（无价格、库存、规格等商品字段）
ALLOWED_ITEM_KEYS = {'id', 'categoryId', 'name', 'image', 'desc', 'sort'}
for it in items:
    extra = sorted(set(it.keys()) - ALLOWED_ITEM_KEYS)
    check('条目无商品字段: ' + it.get('id', '?'), not extra, str(extra))

# ---------- 9. 发布资产 ----------
man = json.loads(read('manifest.webmanifest'))
check('manifest start_url', man.get('start_url') in ('./index.html', './', 'index.html'))
for ic in [i['src'] for i in man.get('icons', [])]:
    check('manifest 图标磁盘存在: ' + ic,
          os.path.exists(os.path.join(APP, ic.lstrip('./').replace('/', os.sep))))
sw = read('sw.js')
check('sw 版本 v15', "var CACHE = 'wardrobe-v15';" in sw)
# 预缓存清单里的每个文件都必须真实存在（否则 addAll 整体失败、一个都缓存不上）
assets = re.search(r'var ASSETS = \[(.*?)\];', sw, re.S).group(1)
for a in re.findall(r"'\./([^']*)'", assets):
    if a == '':
        continue
    check('预缓存文件存在: ' + a, os.path.exists(os.path.join(APP, a.replace('/', os.sep))))
check('预缓存清单不含已删除的 preview.html', 'preview.html' not in assets)
check('apple-touch-icon', 'apple-touch-icon' in html)
check('workflow 存在', os.path.exists(os.path.join(APP, '.github/workflows/deploy.yml')))
check('.nojekyll 存在', os.path.exists(os.path.join(APP, '.nojekyll')))

# ---------- 10. 宽屏适配（平板 / 横屏） ----------
# orientation 放开为 any，否则装到主屏后横屏被系统锁死，宽屏断点形同虚设
check('manifest orientation 已放开为 any', man.get('orientation') == 'any')
css = read('styles.css')
# 宽屏断点组必须存在（三档：720 / 900 / 横屏低矮）
check('宽屏断点 ≥720px', '@media (min-width:720px)' in css)
check('宽屏断点 ≥900px', '@media (min-width:900px)' in css)
check('横屏低矮断点（宽≥720 且高≤560）',
      '@media (min-width:720px) and (max-height:560px)' in css)
# 手机竖版基准容器仍是 520px，窄屏不得被宽屏规则污染
check('窄屏基准容器仍是 max-width:520px', 'max-width:520px' in css)
# 风格墙每屏都必须保持 100% 宽（滑动器位移按 -index*100% 轨道宽算），
# 任何宽度下都不得被改窄，否则翻页越滑越偏
check('风格墙每屏仍为 flex:0 0 100%', '.sl-wall-slide{flex:0 0 100%' in css
      or 'sl-wall-slide{flex:0 0 100%' in css)
# 横屏低矮才允许左右分栏，且分栏后 slide 仍是 100% 宽
check('横屏低矮 slide 未改窄（仍 100% 宽两栏）',
      re.search(r'\.sl-wall-slide\{[^}]*flex:0 0 100%[^}]*display:grid', css) is not None)
# 宽屏网格必须真的加列（否则等于没适配）
check('宽屏模板库网格加列到 4 列',
      'grid-template-columns:repeat(4,1fr);gap:12px' in css)
check('宽屏模板库网格加列到 5 列',
      'grid-template-columns:repeat(5,1fr);gap:14px' in css)
# 排版优化落点（补丁必须真的进了 styles.css）
check('排版优化：text-wrap 已落回', css.count('text-wrap') >= 8)
check('排版优化：overflow-wrap:anywhere 已落回', 'overflow-wrap:anywhere' in css)
# 中文排版约定：中文大标题禁止负字距
check('无中文标题负字距', not re.search(r'letter-spacing:\s*-\d', css))
check('无 CRLF 污染', '\r\n' not in open(os.path.join(APP, 'styles.css'),
      encoding='utf-8', newline='').read())

print('\nRESULT:', 'ALL PASS' if ok else 'HAS FAILURES')
sys.exit(0 if ok else 1)
