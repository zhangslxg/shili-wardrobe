# 生成 catalog.json 起步数据：扫描 images/ 目录，为每张图生成一条 items 记录
# 注意：本脚本已由 prepare_images.py --catalog 取代（那条路更简单，先跑它）。
# 本应用不做商品化呈现，因此不生成 colors（色点）/ sizes（尺码）/ tags（标签）等商品规格字段。
import json, os, time
from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(ROOT, '..')
IMG = os.path.join(APP, 'images')

items = []
files = sorted(f for f in os.listdir(IMG) if f.lower().endswith(('.jpg', '.jpeg', '.png', '.webp')))
for i, fn in enumerate(files):
    p = os.path.join(IMG, fn)
    with Image.open(p) as im:
        w, h = im.size
    items.append({
        'id': 'good-%03d' % (i + 1),
        'categoryId': 'cat-default',
        'name': os.path.splitext(fn)[0],
        'image': 'images/' + fn,
        'desc': '',
        'sort': i + 1,
    })
    print(fn, w, 'x', h)

catalog = {
    'version': int(time.time() * 1000),
    'comment': '店里统一的在线图库。店主维护方式：数据管理页导入数据后点「导出当前数据」，把导出内容整体复制到本文件；version 用导出时间戳（客人端只认更大的版本号，更新才会同步到老客人手机）。客人扫码打开时自动拉取本文件，同 ID 覆盖、新 ID 追加、本机独有数据保留。本应用不涉及商品销售，无价格 / 库存 / 规格等字段。',
    'categories': [
        {'id': 'cat-default', 'name': '个人写真', 'sort': 5, 'desc': '', 'cover': ''}
    ],
    'items': items,
}

out = os.path.join(APP, 'catalog.json')
with open(out, 'w', encoding='utf-8') as f:
    json.dump(catalog, f, ensure_ascii=False, indent=2)
    f.write('\n')
print('\nwritten:', out, 'version =', catalog['version'], 'items =', len(items))
