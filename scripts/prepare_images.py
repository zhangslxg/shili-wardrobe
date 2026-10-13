#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
换正式图 · 图片预检与目录生成工具
================================
用途：店主把真实衣服照片放进 images/ 后，跑本脚本做三件事：
  1) 检查每张图是否符合上线标准（长边 <= 1400px、格式 jpg/png/webp、命名 主图_NNN 等）
  2) --fix 时把超长边的图自动压到长边 1400px（原地覆盖，jpg 质量 82）
  3) --catalog 时打印一段可直接粘进 catalog.json 的 items 列表（起步用）

用法（在衣橱App 目录下执行）：
  检查（只读，不改动文件）：
    python scripts/prepare_images.py
  自动压缩超长边图片：
    python scripts/prepare_images.py --fix
  生成起步用 catalog items：
    python scripts/prepare_images.py --catalog

注意：本脚本只认 images/ 目录；生成清单后，正式命名/分类请在「数据管理页」里调整。
"""
import os
import sys
import glob
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG_DIR = os.path.join(ROOT, "images")
MAX_EDGE = 1400          # 长边上限（px）
GOOD_EXT = (".jpg", ".jpeg", ".png", ".webp")
QUALITY = 82

# 命名约定：主图_001.jpg / 主图_002.jpg ... 或 <单品ID>.jpg
import re
NAME_RE = re.compile(r"^(主图|副图|细节|主图_|img|good|item)[-_]?\d*\.?\w*$", re.IGNORECASE)


def check_one(path):
    name = os.path.basename(path)
    ext = os.path.splitext(name)[1].lower()
    problems = []
    if ext not in GOOD_EXT:
        problems.append(f"格式不支持({ext})")
    try:
        with Image.open(path) as im:
            w, h = im.size
    except Exception as e:
        return name, 0, 0, 0, [f"无法读取: {e}"]
    long_edge = max(w, h)
    kb = os.path.getsize(path) // 1024
    if long_edge > MAX_EDGE:
        problems.append(f"长边{long_edge}px> {MAX_EDGE}")
    # 命名建议（非强制，仅提示）
    stem = os.path.splitext(name)[0]
    if not re.match(r"^(主图|副图|细节)[_-]?\d{1,3}$", stem) and not re.match(r"^[A-Za-z0-9_-]+$", stem):
        problems.append("命名建议: 主图_001.jpg 或 单品ID.jpg")
    return name, w, h, kb, problems


def fix_one(path):
    try:
        with Image.open(path) as im:
            w, h = im.size
            long_edge = max(w, h)
            if long_edge <= MAX_EDGE:
                return None
            scale = MAX_EDGE / long_edge
            nw, nh = int(round(w * scale)), int(round(h * scale))
            im = im.convert("RGB")
            im = im.resize((nw, nh), Image.LANCZOS)
            im.save(path, "JPEG", quality=QUALITY)
            return f"{os.path.basename(path)} {w}x{h} -> {nw}x{nh}"
    except Exception as e:
        return f"{os.path.basename(path)} 压缩失败: {e}"


def main():
    fix = "--fix" in sys.argv
    cat = "--catalog" in sys.argv
    if not os.path.isdir(IMG_DIR):
        print(f"[错误] 找不到目录: {IMG_DIR}")
        sys.exit(1)

    files = sorted(glob.glob(os.path.join(IMG_DIR, "*") ))
    files = [f for f in files if os.path.splitext(f)[1].lower() in GOOD_EXT]
    if not files:
        print("[提示] images/ 里还没有图片。把衣服照片按命名约定放进去后，再跑本脚本。")
        return

    print(f"在 images/ 发现 {len(files)} 张图片，标准：长边 <= {MAX_EDGE}px\n")
    ready = 0
    for p in files:
        name, w, h, kb, probs = check_one(p)
        if probs:
            print(f"  [需处理] {name:<18} {w}x{h:<6} {kb:>4}KB  -> " + "; ".join(probs))
        else:
            print(f"  [ OK   ] {name:<18} {w}x{h:<6} {kb:>4}KB")
            ready += 1

    if fix:
        print("\n--fix 模式：压缩超长边图片...")
        for p in files:
            r = fix_one(p)
            if r:
                print("  " + r)

    print(f"\n结果：{ready}/{len(files)} 张可直接上线。")

    if cat:
        print("\n===== 可粘进 catalog.json 的 items（起步模板，正式分类请到数据管理页调整）=====")
        items = []
        for i, p in enumerate(files, 1):
            stem = os.path.splitext(os.path.basename(p))[0]
            items.append(
                '    {\n'
                f'      "id": "good-{i:03d}",\n'
                f'      "categoryId": "cat-default",\n'
                f'      "name": "{stem}",\n'
                f'      "image": "images/{os.path.basename(p)}",\n'
                '      "sizes": [],\n'
                '      "colors": [],\n'
                '      "tags": [],\n'
                f'      "desc": "",\n'
                f'      "sort": {i}\n'
                '    }'
            )
        print('  "items": [\n' + ",\n".join(items) + '\n  ]')
        print('\n（别忘了在 categories 里加一个 "id": "cat-default" 的分类）')


if __name__ == "__main__":
    main()
