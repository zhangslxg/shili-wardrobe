# 生成 catalog.json 种子数据：7 张唯一样片（缩略图_001 与主图_002 MD5 重复，剔除）
# 用 Pillow 自适应调色板提取每张图 3 个主色（hex），供详情页色点展示
import json, os, time
from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(ROOT, '..')
IMG = os.path.join(APP, 'images')

# 文件名 → 展示名（依据 7 张样片实际画面内容命名：同模特黑色露肩针织 + 暖调光影）
SAMPLES = [
    ('主图_001.jpg', '侧颜 · 抬眸'),
    ('主图_002.jpg', '正面 · 桌前'),
    ('主图_003.jpg', '侧望 · 远方'),
    ('主图_004.jpg', '四宫格精选'),
    ('主图_005.jpg', '侧影 · 凝思'),
    ('主图_006.jpg', '回眸 · 浅笑'),
    ('主图_007.jpg', '正面 · 从容'),
]

def dominant_colors(path, n=3):
    im = Image.open(path).convert('RGB')
    im.thumbnail((160, 160))                      # 缩小加速，主色不受影响
    q = im.quantize(colors=8, method=Image.MEDIANCUT).convert('RGB')
    colors = sorted(q.getcolors(maxcolors=160 * 160), key=lambda x: -x[0])
    out, seen = [], []
    for cnt, rgb in colors:
        hexc = '#%02X%02X%02X' % rgb
        # 与已选颜色曼哈顿距离小于 60 的视为同一色系，跳过
        if any(sum(abs(a - b) for a, b in zip(rgb, s)) < 60 for s in seen):
            continue
        seen.append(rgb); out.append(hexc)
        if len(out) >= n: break
    return out

items = []
for i, (fn, name) in enumerate(SAMPLES):
    p = os.path.join(IMG, fn)
    with Image.open(p) as im:
        w, h = im.size
    items.append({
        'id': 'sample-%03d' % (i + 1),
        'categoryId': 'cat-sample',
        'name': name,
        'image': 'images/' + fn,
        'sizes': [],
        'colors': dominant_colors(p, 3),
        'tags': ['样片', '露肩针织', '暖调光影'],
        'desc': '影楼样片预览 · %s（%d×%d）' % (name, w, h),
        'sort': i + 1,
    })
    print(fn, name, w, 'x', h, items[-1]['colors'])

catalog = {
    'version': int(time.time() * 1000),
    'comment': '店里统一的在线图库。店主维护方式：数据管理页导入数据后点「导出当前数据」，把导出内容整体复制到本文件；version 用导出时间戳（客人端只认更大的版本号，更新才会同步到老客人手机）。客人扫码打开时自动拉取本文件，同 ID 覆盖、新 ID 追加、本机独有数据保留。',
    'categories': [
        {'id': 'cat-sample', 'name': '暖调光影样片', 'sort': 1, 'desc': '黑色露肩针织 · 暖调光影肖像系列'}
    ],
    'items': items,
}

out = os.path.join(APP, 'catalog.json')
with open(out, 'w', encoding='utf-8') as f:
    json.dump(catalog, f, ensure_ascii=False, indent=2)
    f.write('\n')
print('\nwritten:', out, 'version =', catalog['version'], 'items =', len(items))
