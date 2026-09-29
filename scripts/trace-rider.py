#!/usr/bin/env python3
"""騎車照 → 向量插畫「騎士」，給 dawn.html（天還沒亮）當太陽裡的主角；輸出 assets/hero/rider.svg。

照片本身不進 repo（只留描出來的向量）。這支要 numpy / scipy / scikit-image / opencv-python-headless，
不在專案依賴裡，用臨時 venv 跑：

    python3 -m venv /tmp/trace-venv && /tmp/trace-venv/bin/pip install numpy scipy scikit-image opencv-python-headless
    /tmp/trace-venv/bin/python scripts/trace-rider.py <photo.png> assets/hero/rider.svg [icon.svg]

做法：
  1. GrabCut 把騎士從背景摳出來。下面的矩形／多邊形是「這張照片」的提示（座標是 1440×960 原圖）：
     哪裡一定是人、哪裡一定是背景（紅色三角錐、路人、樹）。換照片要重寫這一段。
  2. 在騎士外框裡：mean-shift＋雙邊濾波壓平顏色 → k-means（Lab，K=16）→ 眾數濾波抹掉碎斑 → 每一類的平均色。
  3. 每一類用 marching squares 描輪廓、RDP 簡化、中點二次貝茲平滑；由大到小疊上去，最底下是一圈墨線（剪影外擴 3px）。
輸出 viewBox = 530×770（騎士外框）。可選的第三個參數：另存一份「橘色太陽圓盤＋騎士」的獨立 SVG，
首頁圖示 assets/hero/rider-icon-128.png 就是它用 headless Chrome 透明背景截成 128px。
"""
import os
import sys

import cv2
import numpy as np
from scipy import ndimage as ndi
from skimage import measure

PHOTO, OUT = sys.argv[1], sys.argv[2]
ICON = sys.argv[3] if len(sys.argv) > 3 else None
K = 16
EPS, MINA, SG = 1.25, 26, 1.1
X0, Y0, X1, Y1 = 330, 190, 860, 962                # 騎士外框（原圖座標）

# ── 1. 摳圖 ────────────────────────────────────────────
img = cv2.imread(PHOTO)
H0, W0 = img.shape[:2]
gc = np.full((H0, W0), cv2.GC_BGD, np.uint8)
gc[190:H0, 330:860] = cv2.GC_PR_BGD
gc[200:H0, 345:840] = cv2.GC_PR_FGD


def fg(x0, y0, x1, y1): gc[y0:y1, x0:x1] = cv2.GC_FGD
def bg(x0, y0, x1, y1): gc[y0:y1, x0:x1] = cv2.GC_BGD


fg(410, 240, 520, 290)      # 頭盔
fg(430, 410, 600, 480)      # 車衣（只取正中央，邊緣交給 GrabCut）
fg(540, 520, 700, 700)      # 大腿
fg(430, 600, 520, 690)      # 短褲
fg(432, 302, 512, 334)      # 紅白鏡片
fg(506, 368, 530, 392)      # 下巴下的脖子
fg(612, 425, 640, 455)      # 鹿頭徽章
fg(762, 890, 822, 942)      # 紅鞋
bg(880, 0, W0, H0); bg(0, 0, 330, H0); bg(0, 0, W0, 180)
bg(775, 500, 905, 790)      # 三角錐（橘白）
bg(664, 516, 705, 576); bg(673, 576, 705, 642); bg(690, 646, 708, 700); bg(692, 652, 716, 678)   # 手後面的紅色三角錐
bg(398, 316, 434, 352)      # 頸後露出的路人橘衣
bg(552, 292, 610, 335)      # 肩上方的深色背景物
bg(1080, 300, 1310, 560)
cv2.fillPoly(gc, [np.array([(428, 598), (433, 598), (464, 694), (437, 694), (427, 662)], np.int32)], cv2.GC_BGD)   # 手臂與短褲之間露出的樹
cv2.grabCut(img, gc, None, np.zeros((1, 65)), np.zeros((1, 65)), 8, cv2.GC_INIT_WITH_MASK)
m = ((gc == cv2.GC_FGD) | (gc == cv2.GC_PR_FGD)).astype(np.uint8)
n, lab, st, _ = cv2.connectedComponentsWithStats(m)
m = (lab == 1 + np.argmax(st[1:, cv2.CC_STAT_AREA])).astype(np.uint8)
m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))

# ── 2. 分色 ────────────────────────────────────────────
im = img[Y0:Y1, X0:X1]
mk = m[Y0:Y1, X0:X1] > 0
H, W = im.shape[:2]
flat = cv2.bilateralFilter(cv2.pyrMeanShiftFiltering(im, 7, 20), 7, 30, 7)
labc = cv2.cvtColor(flat, cv2.COLOR_BGR2LAB).astype(np.float32)
cv2.setRNGSeed(1)
_, lbl, _ = cv2.kmeans(labc[mk], K, None, (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 40, .5), 5, cv2.KMEANS_PP_CENTERS)
L = np.full((H, W), -1, np.int32); L[mk] = lbl.ravel()
Ls = L.copy()
for _ in range(2):
    pad = np.pad(Ls, 2, constant_values=-1)
    stack = np.stack([pad[dy:dy + H, dx:dx + W] for dy in range(5) for dx in range(5)], 0)
    mode = np.zeros((H, W), np.int32); best = np.zeros((H, W), np.int32)
    for k in range(K):
        c = (stack == k).sum(0); upd = c > best; mode[upd] = k; best[upd] = c[upd]
    Ls = np.where(mk, mode, -1)
bgr = im.astype(np.float32)
cols = []
for k in range(K):
    mm = Ls == k
    if not mm.any():
        cols.append(None); continue
    c = bgr[mm].mean(0)
    hsv = cv2.cvtColor(np.uint8([[c]]), cv2.COLOR_BGR2HSV)[0, 0].astype(float)
    hsv[1] = min(255, hsv[1] * 1.08); hsv[2] = min(255, hsv[2] * 1.02)
    rgb = cv2.cvtColor(np.uint8([[hsv]]), cv2.COLOR_HSV2BGR)[0, 0][::-1]
    cols.append('#%02x%02x%02x' % tuple(int(v) for v in rgb))
areas = sorted(((int((Ls == k).sum()), k) for k in range(K)), reverse=True)


# ── 3. 描輪廓 ──────────────────────────────────────────
def rdp(pts, eps):
    if len(pts) < 3: return pts
    a, b = pts[0], pts[-1]; d = b - a; nn = np.hypot(*d)
    dist = np.hypot(*(pts - a).T) if nn == 0 else np.abs(d[0] * (pts[:, 1] - a[1]) - d[1] * (pts[:, 0] - a[0])) / nn
    i = int(np.argmax(dist))
    if dist[i] > eps:
        l = rdp(pts[:i + 1], eps); r = rdp(pts[i:], eps); return np.vstack([l[:-1], r])
    return np.vstack([a, b])


def path_of(mask, min_area=MINA):
    f = np.pad(ndi.gaussian_filter(mask.astype(float), SG), 1); out = []
    for c in measure.find_contours(f, .5):
        c = c[:, ::-1] - 1
        if len(c) < 6: continue
        x, y = c[:, 0], c[:, 1]
        if abs(.5 * (np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))) < min_area: continue
        c = rdp(c[:-1] if np.allclose(c[0], c[-1]) else c, EPS)
        if len(c) < 3: continue
        nn = len(c); mid = [(c[i] + c[(i + 1) % nn]) / 2 for i in range(nn)]
        s = f'M{mid[-1][0]:.1f} {mid[-1][1]:.1f}'
        for i in range(nn): s += f'Q{c[i][0]:.1f} {c[i][1]:.1f} {mid[i][0]:.1f} {mid[i][1]:.1f}'
        out.append(s + 'Z')
    return ''.join(out)


sil = ndi.binary_dilation(mk, iterations=3)
body = [f'<path fill="#1b1616" fill-rule="evenodd" d="{path_of(sil, 30)}"/>']
for a, k in areas:
    if cols[k] is None or a < 40: continue
    d = path_of(ndi.binary_dilation(Ls == k, iterations=1) & sil)
    if d: body.append(f'<path fill="{cols[k]}" fill-rule="evenodd" d="{d}"/>')
inner = '\n'.join(body)
svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}">\n{inner}\n</svg>\n'
open(OUT, 'w', encoding='utf-8').write(svg)
print('rider bytes', len(svg), 'colors', [c for a, k in areas for c in [cols[k]] if c])

# 選用：獨立的「太陽＋騎士」（首頁圖示）。座標系同 dawn.html 的 sun：viewBox 900×900，圓盤中心 (450,560) 半徑 330，
# 騎士縮放 1.05、底部略超出圓盤（用圓形裁掉），頭盔探出圓盤上緣。
if ICON:
    s = 1.05
    rx, ry = 450 - W * s / 2, 930 - H * s
    icon = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="60 60 780 860">'
            '<defs><radialGradient id="d" cx=".5" cy=".4" r=".7"><stop offset="0" stop-color="#ffc247"/><stop offset="1" stop-color="#ff7a26"/></radialGradient>'
            '<clipPath id="c"><rect x="-200" y="-200" width="1300" height="760"/><circle cx="450" cy="560" r="330"/></clipPath></defs>'
            '<circle cx="450" cy="560" r="330" fill="url(#d)"/>'
            f'<g clip-path="url(#c)"><g transform="translate({rx:.1f} {ry:.1f}) scale({s})">{inner}</g></g></svg>\n')
    open(ICON, 'w', encoding='utf-8').write(icon)
    print('icon bytes', len(icon))
