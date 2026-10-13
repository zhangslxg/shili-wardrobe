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
import glob
import json
import os
import re
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG_DIR = os.path.join(ROOT, "images")
MAX_EDGE = 1400          # 长边上限（px）
GOOD_EXT = (".jpg", ".jpeg", ".png", ".webp")
QUALITY = 82

# 命名约定（仅用于给出提示，不强制）：主图_001.jpg / 副图_02.png …


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
    """超长边则等比压到 MAX_EDGE。**按原格式保存**：
    早先一律写 JPEG，会把带透明的 png / webp 写成 JPEG 字节却留着原扩展名，
    透明通道丢失、文件内容与后缀不符，后续按后缀处理会出错。"""
    ext = os.path.splitext(path)[1].lower()
    try:
        with Image.open(path) as im:
            w, h = im.size
            long_edge = max(w, h)
            if long_edge <= MAX_EDGE:
                return None
            scale = MAX_EDGE / long_edge
            nw, nh = int(round(w * scale)), int(round(h * scale))
            out = im.resize((nw, nh), Image.LANCZOS)
            if ext == ".png":
                out.save(path, "PNG", optimize=True)          # 保留透明通道
            elif ext == ".webp":
                out.save(path, "WEBP", quality=QUALITY)
            else:
                out.convert("RGB").save(path, "JPEG", quality=QUALITY)
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
        # 分类 id 必须真实存在，否则条目会变成"游离条目"（categoryId 悬空），
        # 导入时 App 会整批报错。所以优先沿用 catalog.json 里已有的分类。
        cat_id, cat_name = "cat-default", "（请替换成真实风格）"
        cat_path = os.path.join(ROOT, "catalog.json")
        try:
            with open(cat_path, encoding="utf-8") as f:
                cats = (json.load(f) or {}).get("categories") or []
            if cats:
                first = sorted(cats, key=lambda c: c.get("sort", 0))[0]
                cat_id = first.get("id", cat_id)
                cat_name = first.get("name", cat_name)
        except Exception:
            pass

        print("\n===== 可粘进 catalog.json 的 items（起步模板，正式分类请到数据管理页调整）=====")
        items = []
        for i, p in enumerate(files, 1):
            stem = os.path.splitext(os.path.basename(p))[0]
            items.append(
                '    {\n'
                f'      "id": "good-{i:03d}",\n'
                f'      "categoryId": "{cat_id}",\n'
                f'      "name": "{stem}",\n'
                f'      "image": "images/{os.path.basename(p)}",\n'
                '      "desc": "",\n'
                f'      "sort": {i}\n'
                '    }'
            )
        print('  "items": [\n' + ",\n".join(items) + '\n  ]')
        print(f'\n（categoryId 已沿用 catalog.json 中排序最前的风格："{cat_id}" = {cat_name}；'
              '本应用不设价格/库存/尺码/颜色/标签等商品字段）')


if __name__ == "__main__":
    main()
