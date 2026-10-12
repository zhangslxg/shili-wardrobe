# 一次性校验脚本：preview 单图滑动查看器改造
import re, os, subprocess, sys, tempfile
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(ROOT, '..')
html = open(os.path.join(APP, 'preview.html'), encoding='utf-8').read()
css = open(os.path.join(APP, 'styles.css'), encoding='utf-8').read()
sw = open(os.path.join(APP, 'sw.js'), encoding='utf-8').read()
ok = True

def check(name, cond, detail=''):
    global ok
    print(('PASS' if cond else 'FAIL'), name, detail)
    if not cond: ok = False

# 1. HTML 标签配对
class P(HTMLParser):
    VOID = {'meta','link','img','br','hr','input','path','circle','rect','line'}
    def __init__(self):
        super().__init__(); self.stack=[]; self.errs=[]
    def handle_starttag(self, tag, attrs):
        if tag not in self.VOID: self.stack.append(tag)
    def handle_endtag(self, tag):
        if tag in self.VOID: return
        if not self.stack or self.stack[-1] != tag:
            self.errs.append('mismatch: </%s> stack=%s' % (tag, self.stack[-3:]))
        else: self.stack.pop()
p = P(); p.feed(html)
check('HTML 标签配对', not p.errs and not p.stack, str(p.errs + p.stack))

# 2. 内联脚本抽出来 node --check
m = re.search(r'<script>(.*?)</script>', html, re.S)
check('存在内联脚本', bool(m))
if m:
    js = m.group(1)
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as f:
        f.write(js); tmp = f.name
    r = subprocess.run(['node', '--check', tmp], capture_output=True, text=True)
    check('内联 JS 语法 (node --check)', r.returncode == 0, r.stderr.strip()[:200])
    os.unlink(tmp)

# 3. 8 个图片引用且磁盘存在
imgs = re.findall(r'src="(images/[^"]+)"', html)
check('共 8 个图片引用', len(imgs) == 8, str(len(imgs)))
check('图片引用无重复', len(set(imgs)) == len(imgs))
for i in imgs:
    check('磁盘存在: ' + i, os.path.exists(os.path.join(APP, i.replace('/', os.sep))))

# 4. 原始比例保持规则（max 双向约束 + auto）
rule = re.search(r'\.pv-slide img\{([^}]*)\}', css)
check('CSS 存在 .pv-slide img 规则', bool(rule))
if rule:
    body = rule.group(1).replace(' ', '')
    check('max-width:100%', 'max-width:100%' in body)
    check('max-height:100%', 'max-height:100%' in body)
    check('width:auto', 'width:auto' in body)
    check('height:auto', 'height:auto' in body)

# 5. 滑动交互要件
check('track 元素', 'id="pv-track"' in html)
check('prev 按钮', 'id="pv-prev"' in html)
check('next 按钮', 'id="pv-next"' in html)
check('pointerdown 手势', 'pointerdown' in html)
check('keydown 方向键', "e.key === 'ArrowLeft'" in html)
check('touch-action:none', 'touch-action:none' in css)

# 6. sw 版本一致
check('sw CACHE=wardrobe-v7', "var CACHE = 'wardrobe-v7';" in sw)
check('sw 注释含 v7', 'v7' in sw.split('\n')[2])
check('sw.js 语法', subprocess.run(['node','--check',os.path.join(APP,'sw.js')],capture_output=True).returncode == 0)

# 7. 旧网格类已清除
check('旧 .pv-grid 已移除', '.pv-grid' not in css)
check('旧 .pv-scroll 已移除', '.pv-scroll' not in css)

print('\nRESULT:', 'ALL PASS' if ok else 'HAS FAILURES')
sys.exit(0 if ok else 1)
