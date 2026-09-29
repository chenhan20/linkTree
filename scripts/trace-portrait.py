#!/usr/bin/env python3
"""照片 → 分層向量肖像（SVG），給 dawn.html（天還沒亮）用；輸出 assets/dawn/portrait.svg。

照片本身不進 repo（只有描出來的向量）。這支要 numpy / scipy / scikit-image / pillow，
不在專案依賴裡，用臨時的 venv 跑：

    python3 -m venv /tmp/trace-venv && /tmp/trace-venv/bin/pip install numpy scipy scikit-image pillow
    /tmp/trace-venv/bin/python scripts/trace-portrait.py <photo.jpg> assets/dawn/portrait.svg [/tmp/sun.svg]

首頁「天還沒亮」的圓形圖示 assets/dawn/sun-128.png：用第三個參數存出 sun.svg，
再用 headless Chrome 以透明背景截成 128×128（CDP 的 Emulation.setDefaultBackgroundColorOverride a=0）。

CROP 是「頭＋肩」的正方形（以 1328 寬的顯示座標表示）；換一張構圖不同的照片要重調 CROP，
以及下面幾個寫死的座標（Y 門檻、iris 搜尋範圍 X／Y）。
輸出 viewBox 是 900×900；頁面上圓盤中心 (450,522)、半徑 378，頭髮超出圓盤上緣（pop-out）。

做法：把照片依顏色切成 背景／毛衣（高彩度橘）／頭髮與五官線條（暗）／皮膚 四個區域，
每個區域內依「模糊後的亮度」切成 2–4 階，每一階用 marching squares 描出等值線，
再用 Ramer–Douglas–Peucker 簡化、用中點二次貝茲曲線平滑。由亮到暗一層一層疊上去。
色票用 CSS 變數，頁面可以換色（夜裡偏冷、白天偏暖）。
"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from skimage import measure

SRC, OUT = sys.argv[1], sys.argv[2]
N = 900                                   # 描線用的解析度
CROP = (150, 250, 1180, 1280)             # 以 1328 寬的顯示座標表示的正方形（頭＋肩）

im = Image.open(SRC).convert('RGB')
s = im.size[0] / 1328
im = im.crop(tuple(int(v * s) for v in CROP)).resize((N, N), Image.LANCZOS)
a = np.asarray(im).astype(float)
R, G, B = a[..., 0], a[..., 1], a[..., 2]
mx, mn = a.max(2), a.min(2)
sat = (mx - mn) / np.maximum(mx, 1)
lum = .299 * R + .587 * G + .114 * B
Y = np.arange(N)[:, None] * np.ones((1, N))
X = np.ones((N, 1)) * np.arange(N)[None, :]


def blur(m, sg):
    return ndi.gaussian_filter(m.astype(float), sg)


def clean(m, open_r=0, close_r=0, min_area=0, fill=True):
    if close_r:
        m = ndi.binary_closing(m, structure=np.ones((close_r, close_r)))
    if open_r:
        m = ndi.binary_opening(m, structure=np.ones((open_r, open_r)))
    if fill:
        m = ndi.binary_fill_holes(m)
    if min_area:
        lab, n = ndi.label(m)
        if n:
            sizes = ndi.sum(m, lab, range(1, n + 1))
            keep = np.isin(lab, [i + 1 for i, z in enumerate(sizes) if z >= min_area])
            m = keep
    return m


# ── 區域 ─────────────────────────────────────────────────
bg = (mn > 226) & ((mx - mn) < 26)
fg = clean(~bg, open_r=3, close_r=5, min_area=4000)
fg = blur(fg, 1.2) > .5

lum_s = blur(lum, 1.6)
sweater = fg & (blur(sat, 1.5) > .56) & (Y > 690)
sweater = clean(sweater, open_r=3, close_r=5, min_area=3000)

ink_lo = fg & ~sweater & (lum_s < 88)            # 頭髮、瞳孔、鼻孔
ink_mid = fg & ~sweater & (lum_s < 128) & (Y < 640)   # 眉、眼線、嘴線、髮的邊緣（下巴以下是脖子的陰影，交給膚色階）
rim = fg & ~ndi.binary_erosion(fg, iterations=7) & (Y < 360)      # 髮緣被白底稀釋的那一圈，不要鋪膚色
top = fg & (Y < 135)                                                # 頭頂一定是頭髮（額頭在 y≈180 以下）
ink_mid = ink_mid | top
skin = fg & ~sweater & ~ink_lo & ~rim & ~top

lum_f = blur(lum, .9)
eye_band = fg & (Y > 350) & (Y < 425) & (X > 250) & (X < 640)
lid_lines = eye_band & (lum_f < 150) & ~ink_lo
ink_mid = ink_mid | lid_lines
# ── 輪廓工具 ─────────────────────────────────────────────
def rdp(pts, eps):
    if len(pts) < 3:
        return pts
    a_, b_ = pts[0], pts[-1]
    d = b_ - a_
    nrm = np.hypot(*d)
    if nrm == 0:
        dist = np.hypot(*(pts - a_).T)
    else:
        dist = np.abs(d[0] * (pts[:, 1] - a_[1]) - d[1] * (pts[:, 0] - a_[0])) / nrm
    i = int(np.argmax(dist))
    if dist[i] > eps:
        l = rdp(pts[:i + 1], eps)
        r = rdp(pts[i:], eps)
        return np.vstack([l[:-1], r])
    return np.vstack([a_, b_])


def area(p):
    x, y = p[:, 0], p[:, 1]
    return .5 * (np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


def path_from_mask(m, sg=1.1, eps=.85, min_area=14):
    """m: bool 遮罩 → SVG path d（evenodd 用）。座標是 N×N。"""
    f = blur(m, sg)
    f = np.pad(f, 1)
    d = []
    for c in measure.find_contours(f, .5):
        c = c[:, ::-1] - 1                                   # (x, y)，扣掉 padding
        if len(c) < 6:
            continue
        if abs(area(c)) < min_area:
            continue
        c = rdp(c[:-1] if np.allclose(c[0], c[-1]) else c, eps)
        if len(c) < 3:
            continue
        n = len(c)
        mid = [(c[i] + c[(i + 1) % n]) / 2 for i in range(n)]
        s_ = f'M{mid[-1][0]:.1f} {mid[-1][1]:.1f}'
        for i in range(n):
            s_ += f'Q{c[i][0]:.1f} {c[i][1]:.1f} {mid[i][0]:.1f} {mid[i][1]:.1f}'
        d.append(s_ + 'Z')
    return ''.join(d)


def q(v, p):
    return float(np.percentile(v, p))


layers = []          # (name, css-var, d)
# 1) 皮膚底（含髮與眉：底下先鋪膚色，髮邊才不會露白）
base_head = fg & ~sweater & ~rim & ~top
layers.append(('skin0', 'var(--sk0,#f2d3ba)', path_from_mask(base_head, 1.0, .9)))
layers.append(('sweater0', 'var(--sw0,#c85a3c)', path_from_mask(sweater, 1.0, .9)))

# 2) 皮膚陰影（依亮度分位數，三階）
sk = skin & ~ink_mid
vals = lum_s[sk]
t1, t2, t3 = q(vals, 42), q(vals, 16), q(vals, 4)
print('skin lum thresholds', round(t1), round(t2), round(t3), ' median', round(q(vals, 50)))
for name, t, col in (('skin1', t1, 'var(--sk1,#e9bc9d)'), ('skin2', t2, 'var(--sk2,#d9a382)'), ('skin3', t3, 'var(--sk3,#c48967)')):
    m = skin & (lum_s < t)
    m = clean(m, open_r=3, close_r=3, min_area=30, fill=False)
    layers.append((name, col, path_from_mask(m, 1.6, 1.0, 30)))

# 3) 毛衣（三階）
sv = lum_s[sweater]
s1, s2 = q(sv, 45), q(sv, 12)
for name, t, col in (('sweater1', s1, 'var(--sw1,#b04a2e)'), ('sweater2', s2, 'var(--sw2,#8f3a22)')):
    m = sweater & (lum_s < t)
    m = clean(m, open_r=3, close_r=3, min_area=60, fill=False)
    layers.append((name, col, path_from_mask(m, 2.0, 1.1, 60)))
# 毛衣亮面（受光）
m = sweater & (lum_s > q(sv, 82))
m = clean(m, open_r=3, close_r=3, min_area=80, fill=False)
layers.append(('sweaterH', 'var(--sw3,#dc7048)', path_from_mask(m, 2.4, 1.2, 80)))

# 4) 墨：中間（眉、眼線、嘴線）→ 深（髮、瞳孔）
lab, nlab = ndi.label(ink_lo)
sizes = ndi.sum(ink_lo, lab, range(1, nlab + 1))
big = np.isin(lab, [i + 1 for i, z in enumerate(sizes) if z > 6000])
hair_fat = ndi.binary_dilation(big, structure=np.ones((9, 9))) & fg & ~sweater
ink_lo = ink_lo | hair_fat
mid = ink_mid & ~ink_lo
mid = clean(mid, close_r=2, fill=False)
INK_LAYERS = [('inkMid', 'var(--ink1,#4a342b)', path_from_mask(ink_mid, .9, .8, 6)), ('ink', 'var(--ink0,#17120f)', path_from_mask(ink_lo, .9, .8, 6))]

# 5) 髮的光澤：髮區內較亮的一階
hair_zone = ink_mid & (Y < 470)
hv = lum_s[hair_zone & ink_lo]
if hv.size:
    hl = hair_zone & (lum_s > q(hv, 55)) & (lum_s < 128)
    hl = clean(hl, open_r=2, close_r=2, min_area=30, fill=False)
    HAIRH = ('hairH', 'var(--ink2,#3c332e)', path_from_mask(hl, 1.4, 1.0, 30))

# 6) 眼白：以兩顆虹膜為中心的橢圓，只取偏亮、低彩度的皮膚以外的部分
lab2, n2 = ndi.label(ink_lo & (Y > 360 * N / 900) & (Y < 470 * N / 900) & (X > 300) & (X < 600))
irises = []
for i in range(1, n2 + 1):
    ys, xs = np.where(lab2 == i)
    if 120 < len(ys) < 900:
        irises.append((xs.mean(), ys.mean()))
print('irises', [(round(x), round(y)) for x, y in irises])
wh = np.zeros((N, N), bool)
for cx, cy in irises:
    wh |= (((X - cx) / 50) ** 2 + ((Y - cy) / 14.5) ** 2) < 1
wh &= ~ink_mid & fg & (lum_s > 140)
wh = clean(wh, open_r=2, close_r=2, min_area=40, fill=False)
layers.append(('whites', 'var(--hi,#f7ebe0)', path_from_mask(wh, 1.0, .8, 30)))

lids = ''
for cx, cy in irises:
    lids += (f'<path fill="var(--sk1,#e9bc9d)" d="M{cx-56:.0f} {cy-26:.0f}L{cx+56:.0f} {cy-26:.0f}L{cx+52:.0f} {cy-1:.0f}Q{cx:.0f} {cy+9:.0f} {cx-52:.0f} {cy-1:.0f}Z"/>'
             f'<path fill="none" stroke="var(--ink0,#17120f)" stroke-width="3.2" stroke-linecap="round" d="M{cx-52:.0f} {cy-1:.0f}Q{cx:.0f} {cy+9:.0f} {cx+52:.0f} {cy-1:.0f}"/>')
LIDS = f'<g id="lids" style="opacity:var(--lid,0)">{lids}</g>'
layers += INK_LAYERS + ([HAIRH] if 'HAIRH' in dir() else [])
body = '\n'.join(f'<path id="{n}" fill="{c}" fill-rule="evenodd" d="{d}"/>' for n, c, d in layers if d) + '\n' + LIDS
svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {N} {N}">\n{body}\n</svg>\n'
open(OUT, 'w', encoding='utf-8').write(svg)
print('bytes', len(svg), {n: len(d) for n, c, d in layers})

# 獨立可用的「太陽」：圓盤＋裁切＋肖像，色票用 var() 的預設值（白天版），給首頁當圖示（<img> 用）。
SUN = sys.argv[3] if len(sys.argv) > 3 else None    # 選用：第三個參數＝另存一份獨立的太陽 SVG（首頁圖示是把它截成 128px PNG）
sun = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="20 40 860 860">'
       '<defs><clipPath id="c"><rect x="-200" y="-200" width="1300" height="722"/><circle cx="450" cy="522" r="378"/></clipPath></defs>'
       '<circle cx="450" cy="522" r="378" fill="#ffe19a"/>'
       f'<g clip-path="url(#c)">{body}</g></svg>\n')
if SUN:
    open(SUN, 'w', encoding='utf-8').write(sun)
    print('sun bytes', len(sun))
