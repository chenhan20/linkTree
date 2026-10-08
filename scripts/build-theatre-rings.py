#!/usr/bin/env python3
"""放映室（theatre.html）與首頁「放映室」區塊共用的三種圓環，寫成 assets/theatre/ring-*.svg。

每一種圓環的材質跟那支片自己的世界一樣，預覽圖（圓形）放在環裡面：

  ring-pelican.svg      速度儀表弧 —— 鵜鶘騎單車的 HUD 語彙（270° 弧、刻度、日落橘掃到 68%）
  ring-film-paper.svg   水墨圓相（ensō）—— 宣紙白，用在深色底（首頁、序／尾）
  ring-film-ink.svg     同一筆，墨色，用在宣紙底（放映室的十六分二十五秒那一張）；右下角一枚朱紅印章（只有他和紀錄是紅的）
  ring-t60.svg          倒數環 —— T-60 的語彙（60 格＝60 個倒數秒、每 10 格一個 GO 節點、12 點鐘那一格是 T-0 的訊號橘）
  ring-chronicle.svg    像素圈 —— 4 格一像素、金色，下緣一格深金，1 點鐘方向一枚橘色金幣

viewBox 200×200，環帶在半徑 86–99；圓形預覽的半徑要 ≤ 84（CSS 裡是 inset:8%）。
沒有隨機性（圓相的墨跡用固定的種子），重跑產生的檔案完全一樣。

    python3 scripts/build-theatre-rings.py
"""
import math
import os
import random

OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'theatre')
C = 100  # 圓心


def pol(r, deg):
    a = math.radians(deg)
    return C + r * math.cos(a), C + r * math.sin(a)


def f(v):
    return f'{v:.2f}'.rstrip('0').rstrip('.')


# ── 鵜鶘：速度儀表弧 ─────────────────────────────────────────
def pelican():
    start, span = 135, 270           # SVG 角度：0°＝3 點鐘、順時針；135°＝左下，掃過上方到右下
    val = 0.68
    R = 93

    def arc(a0, a1, r):
        x0, y0 = pol(r, a0)
        x1, y1 = pol(r, a1)
        large = 1 if (a1 - a0) % 360 > 180 else 0
        return f'M{f(x0)} {f(y0)}A{r} {r} 0 {large} 1 {f(x1)} {f(y1)}'

    ticks = []
    n = 30
    for i in range(n + 1):
        a = start + span * i / n
        major = i % 5 == 0
        r0, r1 = (86, 91) if major else (87.5, 90)
        x0, y0 = pol(r0, a)
        x1, y1 = pol(r1, a)
        ticks.append(f'<path d="M{f(x0)} {f(y0)}L{f(x1)} {f(y1)}" stroke="#efe8dc" stroke-opacity="{.55 if major else .28}" stroke-width="{1.4 if major else .9}"/>')
    tip = start + span * val
    tx, ty = pol(R, tip)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" fill="none">
<defs>
<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="14" y1="170" x2="186" y2="30">
<stop offset="0" stop-color="#dc7336"/><stop offset=".55" stop-color="#ff9a5a"/><stop offset="1" stop-color="#ffc28f"/>
</linearGradient>
<filter id="glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.2"/></filter>
</defs>
<path d="{arc(start, start + span, R)}" stroke="#efe8dc" stroke-opacity=".16" stroke-width="3.2" stroke-linecap="round"/>
<path d="{arc(start, tip, R)}" stroke="#ff9a5a" stroke-opacity=".55" stroke-width="7" stroke-linecap="round" filter="url(#glow)"/>
<path d="{arc(start, tip, R)}" stroke="url(#g)" stroke-width="3.6" stroke-linecap="round"/>
{chr(10).join(ticks)}
<circle cx="{f(tx)}" cy="{f(ty)}" r="4.2" fill="#fff4e6"/>
<circle cx="{f(tx)}" cy="{f(ty)}" r="7.5" fill="#ffc28f" fill-opacity=".28"/>
</svg>
'''


# ── 水墨：圓相 ─────────────────────────────────────────────
def enso(color, seal):
    rnd = random.Random(1625)        # 十六分二十五秒
    a0, sweep = -128, 322            # 起筆在左上、順時針寫一圈，留 38° 的缺口
    N = 260
    outer, inner = [], []
    for i in range(N + 1):
        t = i / N
        a = a0 + sweep * t
        # 起筆重、收筆輕；中段有一次換氣（t≈.55）筆壓略鬆
        w = 8.6 * (1 - t) ** 0.72 + 1.5 + 1.1 * math.sin(t * math.pi * 3.1)
        w *= 1 - .18 * math.exp(-((t - .55) / .05) ** 2)
        r = 92.5 - 3.4 * t + 1.1 * math.sin(t * 9.2) + .6 * math.sin(t * 23)
        xo, yo = pol(r + w / 2, a)
        xi, yi = pol(r - w / 2, a)
        outer.append((xo, yo))
        inner.append((xi, yi))
    pts = outer + inner[::-1]
    d = 'M' + 'L'.join(f'{f(x)} {f(y)}' for x, y in pts) + 'Z'
    # 飛白：收筆最後 30% 有幾條掉隊的細毫
    dry = []
    for k in range(7):
        t0 = .70 + rnd.random() * .12
        t1 = min(1.0, t0 + .10 + rnd.random() * .16)
        off = (rnd.random() - .5) * 4.6
        pp = []
        for j in range(24):
            t = t0 + (t1 - t0) * j / 23
            a = a0 + sweep * t
            r = 92.5 - 3.4 * t + off
            x, y = pol(r, a)
            pp.append(f'{f(x)} {f(y)}')
        dry.append(f'<path d="M{"L".join(pp)}" stroke="{color}" stroke-opacity="{.35 + rnd.random() * .4:.2f}" stroke-width="{.5 + rnd.random() * .7:.2f}" stroke-linecap="round"/>')
    stamp = ''
    if seal:
        sx, sy = pol(94, 48)
        # 印章：實心朱紅方塊＋內縮一圈宣紙色細框（不放字，免得一顆看不懂的假字）
        stamp = f'''<g transform="translate({f(sx)} {f(sy)}) rotate(6)" filter="url(#rough)"><rect x="-8.5" y="-8.5" width="17" height="17" fill="#a8322b"/>
<rect x="-5.6" y="-5.6" width="11.2" height="11.2" fill="none" stroke="#f3ecdf" stroke-width="1.1" stroke-opacity=".85"/></g>'''
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" fill="none">
<defs>
<filter id="ink" x="-5%" y="-5%" width="110%" height="110%">
<feTurbulence type="fractalNoise" baseFrequency=".045" numOctaves="3" seed="7" result="n"/>
<feDisplacementMap in="SourceGraphic" in2="n" scale="3.4" xChannelSelector="R" yChannelSelector="G"/>
</filter>
<filter id="rough" x="-10%" y="-10%" width="120%" height="120%">
<feTurbulence type="fractalNoise" baseFrequency=".18" numOctaves="2" seed="3" result="n"/>
<feDisplacementMap in="SourceGraphic" in2="n" scale="1.6" xChannelSelector="R" yChannelSelector="G"/>
</filter>
</defs>
<g filter="url(#ink)"><path d="{d}" fill="{color}"/>{''.join(dry)}</g>
{stamp}
</svg>
'''


# ── 編年史：像素圈 ──────────────────────────────────────────
def chronicle():
    cell = 4
    n = 200 // cell
    cx = cy = n / 2
    ring = set()
    for j in range(n):
        for i in range(n):
            d = math.hypot(i + .5 - cx, j + .5 - cy)
            if 22.6 <= d < 24.4:     # 環帶約 1.8 格厚，才不會在斜角斷掉
                ring.add((i, j))
    shadow = {(i, j + 1) for (i, j) in ring} - ring
    # 1 點鐘方向：一枚 2×2 格的橘色金幣，蓋掉環上原本的格子
    coin_c = pol(94, -55)
    ci, cj = int(coin_c[0] // cell), int(coin_c[1] // cell)
    coin = {(ci + di, cj + dj) for di in (0, 1) for dj in (0, 1)}
    ring -= coin
    shadow -= coin

    def rects(cells, fill):
        # 同一列相鄰的格子併成一條，檔案小很多
        out = []
        for j in sorted({c[1] for c in cells}):
            xs = sorted(c[0] for c in cells if c[1] == j)
            s = p = xs[0]
            for x in xs[1:] + [None]:
                if x is not None and x == p + 1:
                    p = x
                    continue
                out.append(f'<rect x="{s * cell}" y="{j * cell}" width="{(p - s + 1) * cell}" height="{cell}"/>')
                if x is not None:
                    s = p = x
        return f'<g fill="{fill}">{"".join(out)}</g>'

    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" shape-rendering="crispEdges">
{rects(shadow, '#9a7a2e')}
{rects(ring, '#f3c969')}
{rects(coin, '#ff9a5a')}
<rect x="{(ci) * cell}" y="{cj * cell}" width="{cell}" height="{cell}" fill="#ffd9b8"/>
</svg>
'''


# ── T-60：倒數環 ─────────────────────────────────────────────
def t60():
    ticks = []
    for i in range(60):
        a = -90 + 6 * i              # 12 點鐘＝T-0（i=0），順時針倒數回來
        if i == 0:
            continue                 # T-0 另畫
        major = i % 10 == 0
        r0, r1 = (84.5, 95) if major else (88, 93.5)
        x0, y0 = pol(r0, a)
        x1, y1 = pol(r1, a)
        col, op, w = ('#9fb4e8', .8, 1.7) if major else ('#cfd8f0', .34, 1.0)
        ticks.append(f'<path d="M{f(x0)} {f(y0)}L{f(x1)} {f(y1)}" stroke="{col}" stroke-opacity="{op}" stroke-width="{w}"/>')
    x0, y0 = pol(83, -90)
    x1, y1 = pol(99, -90)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" fill="none" stroke-linecap="round">
{chr(10).join(ticks)}
<path d="M{f(x0)} {f(y0)}L{f(x1)} {f(y1)}" stroke="#ff6a1f" stroke-width="3"/>
<circle cx="100" cy="{f(100 - 99)}" r="2.4" fill="#ffb27a" stroke="none"/>
</svg>
'''


def main():
    os.makedirs(OUT, exist_ok=True)
    files = {
        'ring-pelican.svg': pelican(),
        'ring-film-paper.svg': enso('#f3ecdf', False),
        'ring-film-ink.svg': enso('#2a2622', True),
        'ring-chronicle.svg': chronicle(),
        'ring-t60.svg': t60(),
    }
    for name, svg in files.items():
        with open(os.path.join(OUT, name), 'w', encoding='utf-8') as fh:
            fh.write(svg)
        print(f'{name:22s} {len(svg):6d} bytes')


if __name__ == '__main__':
    main()
