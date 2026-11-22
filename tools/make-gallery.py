# -*- coding: utf-8 -*-
"""生成 19 种四格骨牌的总览图（核对形状有无遗漏时用）。

运行：python tools/make-gallery.py   →  项目根目录下的 19-shapes.png
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

W_BG = (247, 242, 232)
CARD = (255, 253, 248)
LINE = (228, 218, 202)
INK = (58, 48, 38)
INK2 = (122, 108, 92)


def hsl_hex(h, s, l):
    """与 assets/pieces.js 里的 hslHex 保持一致，方便按颜色对照页面。"""
    s /= 100.0
    l /= 100.0

    def f(n):
        k = (n + h / 30.0) % 12
        a = s * min(l, 1 - l)
        return l - a * max(-1, min(k - 3, 9 - k, 1))

    return tuple(int(round(255 * f(n))) for n in (0, 8, 4))

def norm(cells):
    mr = min(r for r, c in cells); mc = min(c for r, c in cells)
    return tuple(sorted((r - mr, c - mc) for r, c in cells))

def grow():
    cur = {norm([(0, 0)])}
    for _ in range(3):
        nxt = set()
        for sh in cur:
            s = set(sh)
            for (r, c) in sh:
                for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    p = (r + dr, c + dc)
                    if p not in s:
                        nxt.add(norm(list(s | {p})))
        cur = nxt
    return sorted(cur, key=lambda sh: (max(r for r, c in sh) + 1,
                                       max(c for r, c in sh) + 1, sh))

SH = grow()
assert len(SH) == 19

F_CN = r"C:\Windows\Fonts\msyh.ttc"
F_CNB = r"C:\Windows\Fonts\msyhbd.ttc"
F_MONO = r"C:\Windows\Fonts\consola.ttf"

f_title = ImageFont.truetype(F_CNB, 34)
f_sub = ImageFont.truetype(F_CN, 20)
f_num = ImageFont.truetype(F_CNB, 24)
f_dim = ImageFont.truetype(F_CN, 17)
f_mono = ImageFont.truetype(F_MONO, 17)
f_group = ImageFont.truetype(F_CN, 18)

COLS = 5
CARD_W, CARD_H = 236, 214
GAP = 18
PAD = 40
HEAD_H = 132
TAIL_H = 74

rows = (len(SH) + COLS - 1) // COLS
W = PAD * 2 + COLS * CARD_W + (COLS - 1) * GAP
H = HEAD_H + rows * CARD_H + (rows - 1) * GAP + TAIL_H

img = Image.new("RGB", (W, H), W_BG)
d = ImageDraw.Draw(img)

d.text((PAD, 34), "四格连通拼图 · 共 19 种", font=f_title, fill=INK)
d.text((PAD, 82), "上下左右相连的 4 格，固定朝向使用：旋转、镜像都算不同种类", font=f_sub, fill=INK2)

CELL = 34
for i, sh in enumerate(SH):
    r_i, c_i = divmod(i, COLS)
    x0 = PAD + c_i * (CARD_W + GAP)
    y0 = HEAD_H + r_i * (CARD_H + GAP)
    d.rounded_rectangle([x0, y0, x0 + CARD_W, y0 + CARD_H], radius=18, fill=CARD, outline=LINE, width=2)

    h = max(r for r, c in sh) + 1
    w = max(c for r, c in sh) + 1
    # 形状画在卡片上半部居中，颜色与页面上的序号色一致
    gw, gh = w * CELL, h * CELL
    ox = x0 + (CARD_W - gw) // 2
    oy = y0 + 52 + (100 - gh) // 2
    fill = hsl_hex((i * 137.508 + 8) % 360, 52, 64)
    for (r, c) in sh:
        cx = ox + c * CELL + 2
        cy = oy + r * CELL + 2
        d.rounded_rectangle([cx, cy, cx + CELL - 4, cy + CELL - 4], radius=7, fill=fill)

    d.text((x0 + 16, y0 + 14), "#%02d" % (i + 1), font=f_num, fill=INK)
    d.text((x0 + CARD_W - 16, y0 + 19), "%d×%d" % (w, h), font=f_dim, fill=INK2, anchor="ra")

    # 底部：点阵示意 + 坐标说明
    art = []
    for r in range(h):
        art.append("".join("#" if (r, c) in sh else "." for c in range(w)))
    yy = y0 + 168
    d.text((x0 + 16, yy), "/".join(art), font=f_mono, fill=INK2)

d.text((PAD, H - TAIL_H + 18),
       "分布：1×4 横 1 种 · 2×2 方 1 种 · 3×2 共 8 种 · 2×3 共 8 种 · 1×4 竖 1 种 = 19 种",
       font=f_group, fill=INK2)

out = Path(__file__).resolve().parent.parent / "19-shapes.png"
img.save(out, "PNG")
print(out, img.size)
