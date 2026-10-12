#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 PWA 所需 PNG 图标（192/512），视觉与 icon.svg 一致：
暗紫渐变圆角方块 + 白色衣架线条。Android 安装 PWA 要求 PNG 图标，
SVG 图标在部分设备不被安装提示接受，故补此脚本产出的两个尺寸。

用法：
    python scripts/make_icons.py
输出：
    icon-192.png / icon-512.png（仓库根目录）
"""
import os
from PIL import Image, ImageDraw

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
C_TOP = (139, 92, 246)    # #8B5CF6
C_BOTTOM = (109, 40, 217) # #6D28D9
CORNER = 28.0 / 92.0      # 与 SVG 圆角同比例（28/92）


def gradient(size):
    """对角渐变：小图逐像素插值后放大，平滑且快。"""
    n = 48
    small = Image.new('RGB', (n, n))
    px = small.load()
    for y in range(n):
        for x in range(n):
            t = (x + y) / (2 * (n - 1))
            px[x, y] = tuple(round(C_TOP[i] + (C_BOTTOM[i] - C_TOP[i]) * t) for i in range(3))
    return small.resize((size, size), Image.LANCZOS)


def make_icon(size):
    img = gradient(size).convert('RGBA')
    # 圆角遮罩
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, size - 1, size - 1], radius=round(size * CORNER), fill=255)
    img.putalpha(mask)

    d = ImageDraw.Draw(img)
    k = size / 24.0                      # SVG viewBox 24 → size
    w = max(2, round(1.7 * k))           # 与 SVG stroke-width 1.7 同比例
    W = (255, 255, 255, 255)

    def dot(x, y):
        r = w / 2.0
        d.ellipse([x - r, y - r, x + r, y + r], fill=W)

    # 衣架主体：两斜线（接头圆角化）
    d.line([(12 * k, 8.9 * k), (3.6 * k, 16.7 * k)], fill=W, width=w)
    d.line([(12 * k, 8.9 * k), (20.4 * k, 16.7 * k)], fill=W, width=w)
    dot(12 * k, 8.9 * k)
    dot(3.6 * k, 16.7 * k)
    dot(20.4 * k, 16.7 * k)

    # 底部托弧（折线近似原 SVG 弧线）
    d.line([(3.6 * k, 16.7 * k), (4.7 * k, 18.9 * k)], fill=W, width=w)
    d.line([(4.7 * k, 18.9 * k), (19.3 * k, 18.9 * k)], fill=W, width=w)
    d.line([(19.3 * k, 18.9 * k), (20.4 * k, 16.7 * k)], fill=W, width=w)
    dot(4.7 * k, 18.9 * k)
    dot(19.3 * k, 18.9 * k)

    # 顶部挂钩（圆弧近似）
    d.arc([10 * k, 3.6 * k, 14 * k, 7.6 * k], start=-70, end=170, fill=W, width=w)
    dot(12 * k, 5.6 * k)

    return img


def main():
    for size in (192, 512):
        icon = make_icon(size)
        out = os.path.join(BASE, 'icon-%d.png' % size)
        icon.save(out, 'PNG')
        print('generated:', out, icon.size)


if __name__ == '__main__':
    main()
