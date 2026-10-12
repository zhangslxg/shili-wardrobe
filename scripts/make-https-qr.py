#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成指向正式 HTTPS 地址的长期可用二维码。
任何网络环境下扫码都能打开（不再依赖店内 Wi-Fi / 电脑开机）。

用法：
    python scripts/make-https-qr.py <GitHub用户名> [仓库名] [输出文件名]
示例：
    python scripts/make-https-qr.py zhangsan shili-wardrobe
    python scripts/make-https-qr.py zhangsan shili-wardrobe 店铺二维码-https.png

依赖：
    pip install qrcode
输出：
    店铺二维码-https.png（暗紫墨 #0B0910 + 白底，与旧版局域网二维码同视觉）
"""
import sys

try:
    import qrcode
    from qrcode.constants import ERROR_CORRECT_M
except ImportError:
    sys.exit('缺少 qrcode 库，请先执行：pip install qrcode')


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    user = sys.argv[1].strip()
    repo = (sys.argv[2] if len(sys.argv) > 2 else 'shili-wardrobe').strip()
    out = sys.argv[3] if len(sys.argv) > 3 else '店铺二维码-https.png'

    url = 'https://%s.github.io/%s/index.html' % (user, repo)

    qr = qrcode.QRCode(error_correction=ERROR_CORRECT_M, box_size=12, border=2)
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color='#0B0910', back_color='#FFFFFF')
    img.save(out)

    print('已生成：%s' % out)
    print('二维码内容：%s' % url)
    print('提示：域名长期不变，此二维码可一直使用；自定义域名同理（改 URL 即可）。')


if __name__ == '__main__':
    main()
