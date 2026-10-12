# 综合校验：语法 / 结构 / 数据 schema / 风格库接线 / 发布资产
import json, os, re, subprocess, sys, tempfile
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

# ---------- 1. JS 语法 ----------
for jsf in ['app.js', 'sw.js']:
    r = subprocess.run(['node', '--check', os.path.join(APP, jsf)], capture_output=True, text=True)
    check('node --check ' + jsf, r.returncode == 0, r.stderr.strip()[:300])

appjs = read('app.js')

# ---------- 2. index.html 结构 ----------
html = read('index.html')
class P(HTMLParser):
    VOID = {'meta','link','img','br','hr','input','path','circle','rect','line','ellipse'}
    def __init__(self):
        super().__init__(); self.stack=[]; self.errs=[]
    def handle_starttag(self, tag, attrs):
        if tag not in self.VOID: self.stack.append(tag)
    def handle_endtag(self, tag):
        if tag in self.VOID: return
        if not self.stack or self.stack[-1] != tag: self.errs.append('mismatch </%s>' % tag)
        else: self.stack.pop()
p = P(); p.feed(html)
check('index.html 标签配对', not p.errs and not p.stack, str(p.errs[:3] + p.stack[:3]))

# 风格库接线：HTML 里的 id，JS 里必须全部引用
for elid in ['stylelib','sl-wall-stage','sl-wall-track','sl-wall-count','sl-browser',
             'sl-browser-title','sl-stage','sl-track','sl-dots','sl-count','sl-name','sl-meta']:
    check('index.html 含 #' + elid, ('id="%s"' % elid) in html)
    check('app.js 引用 #' + elid, ("$('#%s')" % elid) in appjs or ("getElementById('%s')" % elid) in appjs)
check('顶栏风格库按钮', 'id="btn-stylelib"' in html)
check('JS 绑定按钮点击', "addEventListener('click', openStyleLib)" in appjs)

# ---------- 3. 风格库 JS 要件 ----------
for frag, name in [
    ('function makeSwiper', '通用滑动手势工厂'),
    ('function openStyleLib', '开库函数'),
    ('function closeStyleLib', '关库函数'),
    ('function slBackWall', '浏览层返回（栈一致）'),
    ('function slToWall', '回风格墙'),
    ('function openBrowser', '进入风格浏览'),
    ('function renderStyleWall', '渲染风格墙'),
    ('function updateBrowserChrome', '浏览层 chrome 更新'),
    ("history.pushState({ sl: 1 }", '开库压栈 sl:1'),
    ("history.pushState({ sl: 2 }", '进风格压栈 sl:2'),
    ('SL_EDGE', '边缘手势常量'),
    ('SL_CLOSE_DY', '下滑返回常量'),
    ('bindStyleLibEdge', '边缘手势绑定函数'),
    ("act === 'sl-close'", 'data-act: sl-close'),
    ("act === 'sl-back-wall'", 'data-act: sl-back-wall'),
    ("act === 'sl-detail'", 'data-act: sl-detail'),
    ('sl-immersive', '沉浸模式 class'),
    ('pushState' in appjs and 'popstate' in appjs, 'popstate 栈管理存在'),
]:
    if isinstance(frag, bool):
        check(name, frag)
    else:
        check('JS 要件: ' + name, frag in appjs)

# popstate 分层逻辑
check('popstate 分层处理', "s.sl === 1 && sl.layer === 'browser'" in appjs and 'closeStyleLib(true)' in appjs)

# ---------- 4. CSS 要件 ----------
css = read('styles.css')
check('CSS 花括号配对', css.count('{') == css.count('}'), '%d vs %d' % (css.count('{'), css.count('}')))
for frag, name in [
    ('.stylelib{', '风格库覆盖层'),
    ('.stylelib.open', '开库展开态'),
    ('.sl-wall-stage', '风格墙舞台'),
    ('.sl-wall-track', '风格墙 track'),
    ('.sl-browser', '浏览层'),
    ('.sl-browser.on', '浏览层展开'),
    ('.sl-stage', '浏览舞台'),
    ('.sl-slide img', '浏览图规则'),
    ('max-height:100%', '比例保持 max-height'),
    ('touch-action:none', '手势区禁用原生滚动'),
    ('prefers-reduced-motion', '降低动效降级'),
    ('sl-immersive', '沉浸模式样式'),
    ('pv-anim', 'track 过渡类（与 preview 共用）'),
]:
    check('CSS 要件: ' + name, frag in css)
m = re.search(r'\.sl-slide img\{([^}]*)\}', css)
check('.sl-slide img 含 max-width/max-height/auto',
      bool(m) and 'max-width:100%' in m.group(1) and 'max-height:100%' in m.group(1)
      and 'width:auto' in m.group(1) and 'height:auto' in m.group(1))

# ---------- 5. catalog.json schema 校验（与 normalizeImport 规则一致） ----------
cat = json.loads(read('catalog.json'))
check('catalog version 为数字', isinstance(cat.get('version'), int) and cat['version'] > 1)
cats = cat['categories']; items = cat['items']
catids = {c['id'] for c in cats}
check('catalog 分类非空', len(cats) >= 1)
check('catalog 分类 id 唯一', len(catids) == len(cats))
for c in cats:
    check('分类字段完整: ' + c.get('id', '?'), bool(c.get('id')) and bool(c.get('name')))
check('catalog 7 件物品', len(items) == 7)
imgrefs = []
for it in items:
    valid = bool(it.get('id')) and bool(it.get('name')) and it.get('categoryId') in catids
    check('物品字段完整: ' + it.get('id', '?'), valid)
    img = it.get('image', '')
    if img:
        imgrefs.append(img)
        check('图片磁盘存在: ' + img, os.path.exists(os.path.join(APP, img.replace('/', os.sep))))
check('图片引用无重复（去重缩略图_001）', len(imgrefs) == len(set(imgrefs)) == 7)
check('物品 id 唯一', len({i['id'] for i in items}) == 7)
# 主色格式
for it in items:
    for c in it.get('colors', []):
        if not re.fullmatch(r'#[0-9A-Fa-f]{6}', c or ''):
            check('主色 hex 格式: ' + it['id'], False, c); break
    else:
        check('主色 hex 格式: ' + it['id'], all(re.fullmatch(r'#[0-9A-Fa-f]{6}', c) for c in it.get('colors', [])))

# ---------- 6. 发布资产 ----------
man = json.loads(read('manifest.webmanifest'))
check('manifest start_url', man.get('start_url') in ('./index.html', './', 'index.html'))
icons = [i['src'] for i in man.get('icons', [])]
for ic in icons:
    check('manifest 图标磁盘存在: ' + ic, os.path.exists(os.path.join(APP, ic.lstrip('./').replace('/', os.sep))))
check('sw 版本 v7', "var CACHE = 'wardrobe-v7';" in read('sw.js'))
check('apple-touch-icon', 'apple-touch-icon' in html)
check('workflow 存在', os.path.exists(os.path.join(APP, '.github/workflows/deploy.yml')))
check('.nojekyll 存在', os.path.exists(os.path.join(APP, '.nojekyll')))

print('\nRESULT:', 'ALL PASS' if ok else 'HAS FAILURES')
sys.exit(0 if ok else 1)
