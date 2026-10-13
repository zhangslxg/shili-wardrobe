# 生成「店主端独立 App」专属图标：在品牌相机图标右下角叠加紫色徽章 + 螺母形。
# 与顾客端图标同底同字形，仅加徽章区分 —— 任务栏/桌面上两个 App 不会认错。
# 幂等：可重复运行，输出稳定。用法：python scripts/_gen_admin_icons.py
import io, os

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(ROOT, '..')

# 徽章几何（512 基准，按实际尺寸等比缩放）。
# 位置依据实测：白字形包围盒 (58,79)-(453,421)，衣架两个下端伸进左下/右下角，
# 右上角 100x100 区域白像素为 0 —— 徽章放右上角，与字形零重叠。
# 圆角安全：圆角矩形角弧圆心 (400,112) 半径 112，徽章圆 (405,100) r78 完全在内。
BADGE_CX, BADGE_CY = 405, 100   # 右上角
BADGE_R = 78                    # 白圆半径
HEX_R = 38                      # 螺母外接圆半径
HEX_W = 12                      # 螺母线宽
BADGE_FILL = (237, 233, 254, 255)   # #EDE9FE 近白圆（紫底上高对比）
HEX_COLOR = (124, 58, 237, 255)     # #7C3AED 紫螺母

# admin-icon.svg：与 PNG 同设计（手写矢量，衣架字形 + 右上角徽章；
# 背景渐变取自现有品牌图标实测角色 #8B5CF6 → #6D28D9）
SVG = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#8B5CF6"/>
      <stop offset="1" stop-color="#6D28D9"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#bg)"/>
  <g transform="translate(256 250) scale(8.6) translate(-12 -12)">
    <path d="M12 7.6a2 2 0 1 1 2-2c0 1.1-2 1.9-2 3.2" fill="none" stroke="#FFFFFF" stroke-width="1.7" stroke-linecap="round"/>
    <path d="M12 8.9 3.6 16.7a1.4 1.4 0 0 0 1 2.3h14.8a1.4 1.4 0 0 0 1-2.3z" fill="none" stroke="#FFFFFF" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  <!-- 店主端标识：右上角白圆 + 紫螺母形（管理） -->
  <circle cx="405" cy="100" r="78" fill="#EDE9FE"/>
  <polygon points="405,62 438,81 438,119 405,138 372,119 372,81" fill="none" stroke="#7C3AED" stroke-width="12" stroke-linejoin="round"/>
</svg>
'''


def hex_points(cx, cy, r):
    """正六边形顶点（顶点朝上），PIL 坐标系 y 向下。"""
    import math
    return [(cx + r * math.cos(math.radians(a - 90)),
             cy + r * math.sin(math.radians(a - 90))) for a in range(0, 360, 60)]


def make_admin_icon(src_path, dst_path):
    size = Image.open(src_path).size[0]
    k = size / 512.0
    im = Image.open(src_path).convert('RGBA')
    d = ImageDraw.Draw(im)
    cx, cy, r = BADGE_CX * k, BADGE_CY * k, BADGE_R * k
    # 白圆徽章
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=BADGE_FILL)
    # 螺母：紫色六边形描边
    pts = hex_points(cx, cy, HEX_R * k)
    w = max(2, round(HEX_W * k))
    for i in range(6):
        d.line([pts[i], pts[(i + 1) % 6]], fill=HEX_COLOR, width=w)
    im.save(dst_path)
    return size


def main():
    out = []
    for base, admin in (('icon-192.png', 'admin-icon-192.png'),
                        ('icon-512.png', 'admin-icon-512.png')):
        src = os.path.join(APP, base)
        dst = os.path.join(APP, admin)
        if not os.path.exists(src):
            raise SystemExit('缺少基础图标：' + src)
        n = make_admin_icon(src, dst)
        out.append('%s (%dpx)' % (admin, n))
    svg_path = os.path.join(APP, 'admin-icon.svg')
    with io.open(svg_path, 'w', encoding='utf-8', newline='') as f:
        f.write(SVG)
    out.append('admin-icon.svg')
    print('已生成：' + '、'.join(out))


if __name__ == '__main__':
    main()
