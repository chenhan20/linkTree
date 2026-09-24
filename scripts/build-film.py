#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build-film.py —— 產生 data/film.json（微電影《十六分二十五秒》strava_film.html 的資料）

那一頁是一支水墨風的 3D 短片：真實地形上的中社路，一條毛筆字一樣的軌跡，
筆畫粗細＝當下功率、鼓聲＝當天的心跳。這支腳本把片子要的東西一次備好：

  terrain   兩層高程網格（台北盆地北半＋內湖山區 90 m；中社路一帶 25 m）
            來源是 data/segment-terrain.json 裡四十幾塊路段 DEM（Terrarium），
            沒被蓋到的地方用真實位置的程序化山體補（觀音山、大屯、七星、象山…），
            淡水河、基隆河照 data/taipei-outline.json 挖成河道
  roads     幾條他常爬的路（中社、風櫃嘴、碧山、劍南、至善），路段 stream 投影
  climbs    中社路每一次有 FIT 的成績：逐 2 秒的位置、海拔、心率、功率、踏頻、速度
  strokes   同上但只留距離與功率（逐 5 秒），畫「一年的筆跡」用
  rides     第一趟（Strava 摘要折線）、7/30 下雨回頭、2/27 一日北彰、3/28 三鐵
  atlas     他騎過的每一條路（data/ride-atlas.json 的六個層級；RDP 30 m、差分編碼）
  taiwan    海岸線（ride-atlas 的 coast）與幾個地名，一日北彰與三鐵那兩幕用

座標：TWD97 / TM2（跟 build-ride-atlas.py 同一條公式），再平移到中社路頂為原點；
x 向東、z 向南（three.js 相機預設看 -z＝北）。台灣全島那兩幕另用公里座標。

片子是一支固定的故事，不在 CI 裡跑；有了新的中社成績想換最後一幕，就重跑一次：
  python3 scripts/build-film.py
"""
import base64
import datetime as dt
import json
import math
import os
import sys

import fitdecode
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'film.json')
FIT_DIR = os.path.join(ROOT, 'data', 'fit')
TZ = dt.timedelta(hours=8)

ORIGIN = (25.10779, 121.57121)          # 中社路 全段的終點（路段 stream 的最後一點）
CLIMB_ID = 1761462
WIDE = dict(lat=(25.000, 25.185), lng=(121.395, 121.640), step=90.0)
NEAR = dict(lat=(25.078, 25.143), lng=(121.543, 121.611), step=30.0)
ROADS = [(1761462, '中社路'), (641218, '風櫃嘴'), (7506566, '碧山'), (956558, '劍南路'),
         (760056, '至善路'), (733780, '北安劍南')]

# 程序化補山：沒有 DEM 的地方照真實位置擺（緯度、經度、峰高 m、半徑 m）
MASSIFS = [
    (25.1375, 121.4255, 600, 2600, '觀音山'),
    (25.1756, 121.5226, 1000, 3200, '大屯山'),
    (25.1717, 121.5522, 1050, 3000, '七星山'),
    (25.1500, 121.6000, 520, 2600, '五指山'),
    (25.0270, 121.5770, 330, 1500, '象山'),
    (25.0200, 121.6200, 360, 2200, '南港山'),
    (25.1650, 121.4700, 180, 2200, '竹圍丘'),
]


# ── 投影（TWD97 / TM2 zone 121，跟 build-ride-atlas.py 同一條級數）────────
A = 6378137.0; F_ = 1 / 298.257222101; E2 = F_ * (2 - F_); EP2 = E2 / (1 - E2)


def tm(lng, lat, lon0=121.0, k0=0.9999, FE=250000.0):
    lng = np.asarray(lng, dtype=float); lat = np.asarray(lat, dtype=float)
    p = np.radians(lat); dl = np.radians(lng - lon0)
    s, c, t = np.sin(p), np.cos(p), np.tan(p)
    N = A / np.sqrt(1 - E2 * s * s); T = t * t; C = EP2 * c * c; a1 = dl * c
    M = A * ((1 - E2 / 4 - 3 * E2 ** 2 / 64 - 5 * E2 ** 3 / 256) * p
             - (3 * E2 / 8 + 3 * E2 ** 2 / 32 + 45 * E2 ** 3 / 1024) * np.sin(2 * p)
             + (15 * E2 ** 2 / 256 + 45 * E2 ** 3 / 1024) * np.sin(4 * p)
             - (35 * E2 ** 3 / 3072) * np.sin(6 * p))
    x = k0 * N * (a1 + (1 - T + C) * a1 ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * EP2) * a1 ** 5 / 120) + FE
    y = k0 * (M + N * t * (a1 * a1 / 2 + (5 - T + 9 * C + 4 * C * C) * a1 ** 4 / 24
              + (61 - 58 * T + T * T + 600 * C - 330 * EP2) * a1 ** 6 / 720))
    return x, y


E0, N0 = (float(v) for v in tm(ORIGIN[1], ORIGIN[0]))
M_LAT = 110770.0
M_LNG = 111320.0 * math.cos(math.radians(ORIGIN[0]))


def to_local(lat, lng):
    E, N = tm(lng, lat)
    return E - E0, N0 - N


def to_latlng(x, z):
    """local → 經緯度：用正算做三次牛頓修正（台北這麼小的範圍兩次就到公分）。"""
    E = np.asarray(x, dtype=float) + E0; N = N0 - np.asarray(z, dtype=float)
    lng = ORIGIN[1] + (E - E0) / M_LNG; lat = ORIGIN[0] + (N - N0) / M_LAT
    for _ in range(3):
        e, n = tm(lng, lat)
        lng = lng + (E - e) / M_LNG; lat = lat + (N - n) / M_LAT
    return lat, lng


def load(*p, default=None):
    try:
        return json.load(open(os.path.join(ROOT, *p), encoding='utf-8'))
    except (OSError, ValueError):
        return default


# ── 高程 ──────────────────────────────────────────────────────────────
def value_noise(x, z, scale, seed):
    gx, gz = x / scale, z / scale
    ix, iz = np.floor(gx), np.floor(gz); fx, fz = gx - ix, gz - iz
    def h(i, j):
        v = np.sin(i * 127.1 + j * 311.7 + seed * 74.7) * 43758.5453
        return v - np.floor(v)
    u, v = fx * fx * (3 - 2 * fx), fz * fz * (3 - 2 * fz)
    a, b, c, d = h(ix, iz), h(ix + 1, iz), h(ix, iz + 1), h(ix + 1, iz + 1)
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v


def push_pull(val, mask):
    """推拉補洞：沒有 DEM 的格子從周圍真實高程平滑延伸過去（不會在拼塊邊界留下斷崖）。"""
    def down(a):
        h, w = a.shape
        a = np.pad(a, ((0, h % 2), (0, w % 2)), mode='edge')
        return a[0::2, 0::2] + a[1::2, 0::2] + a[0::2, 1::2] + a[1::2, 1::2]
    stack = [(np.where(mask, val, 0.0), mask.astype(float))]
    while min(stack[-1][0].shape) > 2:
        a, m = stack[-1]
        stack.append((down(a), down(m)))
    a, m = stack[-1]
    cur = np.where(m > 0, a / np.maximum(m, 1e-9), a.sum() / max(m.sum(), 1e-9))
    for lvl in range(len(stack) - 2, -1, -1):
        a, m = stack[lvl]
        up = np.repeat(np.repeat(cur, 2, axis=0), 2, axis=1)[:a.shape[0], :a.shape[1]]
        up = (4 * up + np.roll(up, 1, 0) + np.roll(up, -1, 0) + np.roll(up, 1, 1) + np.roll(up, -1, 1)) / 8
        frac = np.clip(m / (4 ** lvl), 0, 1)
        cur = np.where(m > 0, frac * (a / np.maximum(m, 1e-9)) + (1 - frac) * up, up)
    return cur


def fallback_height(x, z):
    """沒有 DEM 的地方：真實位置的幾座山用高斯＋雜訊堆出來（疊在補洞的結果上）。"""
    h = np.full(x.shape, 4.0)
    for lat, lng, peak, rad, _ in MASSIFS:
        mx, mz = to_local(lat, lng)
        d2 = ((x - mx) ** 2 + (z - mz) ** 2) / (rad * rad)
        ridge = 0.75 + 0.5 * value_noise(x, z, rad * 0.35, peak)
        h = np.maximum(h, peak * np.exp(-d2 * 1.6) * ridge)
    h += 25 * (value_noise(x, z, 900, 3) - 0.5) * np.clip(h / 200, 0, 1)
    return h


def grid_heights(box):
    x0, z1 = to_local(box['lat'][0], box['lng'][0])     # 西南角
    x1, z0 = to_local(box['lat'][1], box['lng'][1])     # 東北角
    x0, x1, z0, z1 = float(x0), float(x1), float(z0), float(z1)
    step = box['step']
    nx = int(math.floor((x1 - x0) / step)) + 1
    nz = int(math.floor((z1 - z0) / step)) + 1
    xs = x0 + np.arange(nx) * step
    zs = z0 + np.arange(nz) * step
    X, Z = np.meshgrid(xs, zs)                           # 列＝z（北→南）、欄＝x（西→東）
    lat, lng = to_latlng(X, Z)

    # 拼塊之間羽化混合：越靠近拼塊邊緣權重越低、解析度越高權重越大。
    # 各路段的 DEM 是不同 zoom、不同時間抓的，邊界上常差幾十米——硬切換會在山上切出一道牆。
    acc = np.zeros(X.shape); wsum = np.zeros(X.shape); wet = np.zeros(X.shape)
    for pid, p in (load('data', 'segment-terrain.json', default={}) or {}).items():
        n = p['n']
        inside = (lat >= p['minLat']) & (lat <= p['maxLat']) & (lng >= p['minLng']) & (lng <= p['maxLng'])
        if not inside.any():
            continue
        h = np.asarray(p['h'], dtype=float).reshape(n, n)
        u = (lng[inside] - p['minLng']) / (p['maxLng'] - p['minLng'])
        v = (p['maxLat'] - lat[inside]) / (p['maxLat'] - p['minLat'])
        gy, gx = v * (n - 1), u * (n - 1)
        iy = np.clip(np.floor(gy).astype(int), 0, n - 2); ix = np.clip(np.floor(gx).astype(int), 0, n - 2)
        fy = gy - iy; fx = gx - ix
        val = (h[iy, ix] * (1 - fx) * (1 - fy) + h[iy, ix + 1] * fx * (1 - fy)
               + h[iy + 1, ix] * (1 - fx) * fy + h[iy + 1, ix + 1] * fx * fy)
        ok = val > -60                                   # Terrarium 在河口有 -7550 這種壞值
        e = np.minimum.reduce([u, 1 - u, v, 1 - v])
        t = np.clip(e / 0.14, 0, 1)
        w = t * t * (3 - 2 * t) * (4.0 ** (p['z'] - 13)) * ok
        acc[inside] += w * np.where(ok, val, 0)
        wet[inside] += w * (np.where(ok, val, 99) <= 0.05)
        wsum[inside] += w
    covered = wsum > 0.25
    dem = np.where(covered, acc / np.maximum(wsum, 1e-9), np.nan)
    water = covered & (wet / np.maximum(wsum, 1e-9) > 0.5)

    fb = fallback_height(X, Z)
    known = np.where(covered, np.maximum(dem, 0), 0.0)
    cur = push_pull(known, covered)
    # 調和補洞：已知格子固定、未知格子反覆取四鄰平均，邊界上就一定連續（推拉只負責給個好的起點）
    def nb_avg(a):
        q = np.pad(a, 1, mode='edge')
        return (q[:-2, 1:-1] + q[2:, 1:-1] + q[1:-1, :-2] + q[1:-1, 2:]) / 4
    for _ in range(900):
        cur = np.where(covered, known, nb_avg(cur))
    # 離 DEM 越遠，越讓給程序化的山（大屯、七星、觀音山這些本來就不在任何路段的 DEM 裡）
    near_dem = covered.astype(float)
    for _ in range(int(round(900 / step))):
        near_dem = np.maximum(near_dem, nb_avg(near_dem) * 0.985)
    w = np.clip(near_dem, 0, 1) ** 2
    h = np.where(covered, known, cur + np.maximum(0.0, fb - cur) * (1 - w))

    # 河道：Terrarium 的負值（兩個以上的水鄰居才算）＋台北市界那份手描河流
    wn = sum(np.roll(water, s, a) for s in (1, -1) for a in (0, 1))
    water = water & (wn >= 2)
    bank = np.ones(X.shape)
    for r in (load('data', 'taipei-outline.json', default={}) or {}).get('rivers', []):
        half = 150 if r['name'] == '淡水河' else 70
        pts = np.array([to_local(a, b) for a, b in r['points']])
        for (ax, az), (bx, bz) in zip(pts[:-1], pts[1:]):
            dx, dz = bx - ax, bz - az
            L2 = dx * dx + dz * dz or 1.0
            t = np.clip(((X - ax) * dx + (Z - az) * dz) / L2, 0, 1)
            d = np.hypot(X - (ax + t * dx), Z - (az + t * dz))
            water |= d < half
            bank = np.minimum(bank, np.clip((d - half) / 160.0, 0, 1))
    # 河道：水面是 -3 m，岸邊用距離做緩坡（90 m 網格硬切會是一格一格的台階）
    h = np.where(water & (h < 25), -3.0, np.where(h < 30, h * (0.25 + 0.75 * bank) + 0.6 * (1 - bank), h))
    return dict(x0=round(x0, 1), z0=round(z0, 1), dx=step, nx=nx, nz=nz,
                h=pack_u16(h), cov=round(float(covered.mean()), 3)), (xs, zs, h)


def pack_u16(h):
    v = np.clip(np.round((h + 10) * 10), 0, 65535).astype('<u2')
    return base64.b64encode(v.tobytes()).decode('ascii')


# ── FIT ───────────────────────────────────────────────────────────────
def fit_records(name):
    path = os.path.join(FIT_DIR, name)
    out = []
    with fitdecode.FitReader(path) as fr:
        for m in fr:
            if not (isinstance(m, fitdecode.FitDataMessage) and m.name == 'record'):
                continue
            g = lambda k: m.get_value(k, fallback=None)
            la, lo = g('position_lat'), g('position_long')
            out.append(dict(
                ts=g('timestamp'), lat=la * 180 / 2 ** 31 if la is not None else None,
                lng=lo * 180 / 2 ** 31 if lo is not None else None,
                alt=g('enhanced_altitude') if g('enhanced_altitude') is not None else g('altitude'),
                hr=g('heart_rate'), pw=g('power'), cad=g('cadence'),
                spd=g('enhanced_speed') if g('enhanced_speed') is not None else g('speed'),
                dist=g('distance')))
    return out


def rnd(v, k=0):
    return None if v is None else (round(v) if k == 0 else round(v, k))


def climb_streams(effort, gate):
    """從那趟 FIT 切出這一次中社路：起點＝最接近路段起點、時間也對得上的那一筆。"""
    recs = [r for r in fit_records(effort['fit']) if r['ts'] is not None]
    if not recs:
        return None
    hh, mm = (int(v) for v in effort['start_time'].split(':'))
    day = recs[0]['ts'] + TZ
    want = day.replace(hour=hh, minute=mm, second=0, microsecond=0) - TZ
    gx, gz = gate
    best, bi = 1e18, None
    for i, r in enumerate(recs):
        dtt = (r['ts'] - want).total_seconds()
        if dtt < -90 or dtt > 150 or r['lat'] is None:
            continue
        x, z = to_local(r['lat'], r['lng'])
        d = (float(x) - gx) ** 2 + (float(z) - gz) ** 2
        if d < best:
            best, bi = d, i
    if bi is None or best > 90 ** 2:
        return None
    t0 = recs[bi]['ts']
    el = effort['elapsed_sec']
    d0 = recs[bi]['dist'] or 0
    pts = []
    for r in recs[bi:]:
        t = (r['ts'] - t0).total_seconds()
        if t > el + 0.5:
            break
        if r['lat'] is None:
            continue
        x, z = to_local(r['lat'], r['lng'])
        pts.append([round(t), round(float(x), 1), round(float(z), 1), rnd(r['alt'], 1), r['hr'], r['pw'],
                    r['cad'], rnd((r['spd'] or 0) * 3.6, 1), round((r['dist'] or d0) - d0, 1)])
    return pts


def every(pts, k):
    out = pts[::k]
    if pts and out[-1] is not pts[-1]:
        out.append(pts[-1])
    return out


def track_local(name, step_s, fields=('hr', 'pw', 'cad', 'spd')):
    recs = [r for r in fit_records(name) if r['ts'] is not None and r['lat'] is not None]
    t0 = recs[0]['ts']
    out, last = [], -1e9
    for r in recs:
        t = (r['ts'] - t0).total_seconds()
        if t - last < step_s:
            continue
        last = t
        x, z = to_local(r['lat'], r['lng'])
        row = [round(t), round(float(x), 1), round(float(z), 1), rnd(r['alt'], 1)]
        for f in fields:
            row.append(rnd((r[f] or 0) * 3.6, 1) if f == 'spd' else r[f])
        out.append(row)
    return out, (t0 + TZ).strftime('%H:%M:%S')


def trim_ends(pts, m, xy=(0, 1)):
    """隱私：頭尾各 m（同單位）的路徑不要——出發、回家那一段通常就是住處。"""
    if len(pts) < 3:
        return pts
    a, b = xy
    cum = [0.0]
    for p, q in zip(pts, pts[1:]):
        cum.append(cum[-1] + math.hypot(q[a] - p[a], q[b] - p[b]))
    return [p for p, c in zip(pts, cum) if m <= c <= cum[-1] - m]


def track_km(name, step_s, trim_km=0.8):
    """全島座標（TWD97 公里）：一日北彰、三鐵。"""
    recs = [r for r in fit_records(name) if r['ts'] is not None and r['lat'] is not None]
    t0 = recs[0]['ts']
    out, last = [], -1e9
    for r in recs:
        t = (r['ts'] - t0).total_seconds()
        if t - last < step_s:
            continue
        last = t
        E, N = tm(r['lng'], r['lat'])
        out.append([round(t), round(float(E) / 1000, 1), round(float(N) / 1000, 1), rnd(r['alt']), r['hr'], r['pw']])
    # 全島尺度只要 100 m 精度；頭尾 trim_km 不收（三鐵是公開賽道，不用切）
    total = round((recs[-1]['ts'] - t0).total_seconds())
    return (trim_ends(out, trim_km, (1, 2)) if trim_km else out), (t0 + TZ).strftime('%H:%M'), total


def rdp(pts, eps):
    if len(pts) < 3:
        return list(pts)
    (ax, ay), (bx, by) = pts[0], pts[-1]
    dx, dy = bx - ax, by - ay
    den = math.hypot(dx, dy)
    imax, dmax = 0, -1.0
    for i in range(1, len(pts) - 1):
        px, py = pts[i]
        d = math.hypot(px - ax, py - ay) if den == 0 else abs(dy * px - dx * py + bx * ay - by * ax) / den
        if d > dmax:
            imax, dmax = i, d
    if dmax <= eps:
        return [pts[0], pts[-1]]
    return rdp(pts[:imax + 1], eps)[:-1] + rdp(pts[imax:], eps)


def poly_decode(s):
    pts = []; i = lat = lng = 0
    while i < len(s):
        for who in (0, 1):
            shift = res = 0
            while True:
                b = ord(s[i]) - 63; i += 1
                res |= (b & 0x1f) << shift; shift += 5
                if b < 0x20:
                    break
            d = ~(res >> 1) if res & 1 else res >> 1
            if who == 0:
                lat += d
            else:
                lng += d
        pts.append((lat / 1e5, lng / 1e5))
    return pts


def main():
    film = {'origin': {'lat': ORIGIN[0], 'lng': ORIGIN[1], 'E': round(E0, 1), 'N': round(N0, 1)}}

    wide, _ = grid_heights(WIDE)
    near, _ = grid_heights(NEAR)
    film['terrain'] = {'wide': wide, 'near': near}
    print(f"地形 wide {wide['nx']}×{wide['nz']}（DEM 覆蓋 {wide['cov']:.0%}）、near {near['nx']}×{near['nz']}（{near['cov']:.0%}）")

    streams = load('data', 'segment-streams.json', default={}) or {}
    roads = {}
    for sid, name in ROADS:
        s = streams.get(str(sid))
        if not s:
            continue
        pts = []
        for la, lo, el in s['pts']:
            x, z = to_local(la, lo)
            pts.append([round(float(x), 1), round(float(z), 1), round(el, 1)])
        roads[name] = pts
    film['roads'] = roads

    segs = {s['id']: s for s in (load('data', 'itt-segments.json', default=[]) or [])}
    seg = segs[CLIMB_ID]
    gate = roads['中社路'][0][:2]
    effs = sorted((e for e in seg['efforts'] if e.get('elapsed_sec')), key=lambda e: (e['date'], e.get('start_time') or ''))
    climbs, strokes, allef = [], [], []
    for e in effs:
        allef.append([e['date'], e.get('start_time') or '', round(e['elapsed_sec']), e.get('avg_watts'), e.get('avg_heartrate')])
        if e.get('source') != 'fit' or not e.get('fit') or not e.get('start_time'):
            continue
        pts = climb_streams(e, gate)
        if not pts or len(pts) < 30:
            print(f"  ⚠︎ {e['date']} {e['start_time']} 切不出來，略過")
            continue
        strokes.append({'d': e['date'], 't': e['start_time'], 's': round(e['elapsed_sec']),
                        'p': [[round(p[8]), p[5]] for p in every(pts, 8)]})
        # 逐 2 秒：[秒, 路段上的距離 m, 心率, 功率, 踏頻, 速度 km/h]
        climbs.append({'d': e['date'], 't': e['start_time'], 's': round(e['elapsed_sec']),
                       'w': e.get('avg_watts'), 'hr': e.get('avg_heartrate'),
                       'pts': [[p[0], round(p[8]), p[4], p[5], p[6], p[7]] for p in every(pts, 2)]})
    # 片子的旁白是照這幾天寫的（「今」那卷是 2026-09-15），重跑也要留著它們；最新一次另外附上
    keep = {'2025-08-12', '2025-10-14', '2026-04-14', '2026-09-15'}
    latest = climbs[-1]['d'] if climbs else None
    film['climbs'] = [c for c in climbs if c['d'] in keep or c['d'] == latest]
    film['strokes'] = strokes
    film['efforts'] = allef
    film['climb'] = {'id': CLIMB_ID, 'name': '中社路', 'km': seg.get('distance_km'),
                     'kom': seg.get('kom_elapsed_sec')}
    print(f"中社路 {len(allef)} 次，有 FIT 的 {len(strokes)} 次，片子用 {len(film['climbs'])} 次逐秒資料")

    # 其他幾趟
    idx = load('data', 'strava-archive', 'index.json', default=[]) or []
    rides = {}
    for a in idx:
        d = a['start_date_local'][:10]
        if d == '2025-04-27' and a.get('sport_type') == 'Ride':
            pts = [to_local(la, lo) for la, lo in poly_decode(a['map']['summary_polyline'] or '')]
            rides['first'] = {'d': d, 't': a['start_date_local'][11:16], 'km': round(a['distance'] / 1000, 1),
                              'sec': a['moving_time'], 'el': round(a.get('total_elevation_gain') or 0),
                              'route': trim_ends([[round(float(x)), round(float(z))] for x, z in pts], 500)}
        if d == '2025-06-07' and a.get('sport_type') == 'Ride':
            rides['firstClimb'] = {'d': d, 'name': a['name'], 'hr': a.get('average_heartrate'), 'hrMax': a.get('max_heartrate')}
    ec = next((e for e in effs if e['date'] == '2025-06-07'), None)
    if ec and 'firstClimb' in rides:
        rides['firstClimb'].update({'s': round(ec['elapsed_sec']), 'hrClimb': ec.get('avg_heartrate')})
        cat = load('data', 'strava-archive', 'segment-catalog.json', default={}) or {}
        cs = next((s for s in cat.get('segments', []) if s['id'] == CLIMB_ID), None)
        ce = cs and next((e for e in cs['efforts'] if e['date'] == '2025-06-07'), None)
        if ce:
            rides['firstClimb']['moving'] = ce.get('moving_sec')

    rain1, t0 = track_local('2026-07-30_i175153454_內湖區-公路車.fit', 1)
    spike = max(rain1, key=lambda p: p[5] or 0)
    # 只留掉頭前後那一段（片子只用 1935–2130 秒）；出發與回家的路不收
    rain = [[p[0], round(p[1]), round(p[2]), rnd(p[3]), p[4], p[5], p[7]] for p in every(rain1, 3) if 1800 <= p[0] <= 2200]
    burst = [[p[0], p[4], p[5], p[6], p[7]] for p in rain1 if abs(p[0] - spike[0]) <= 20]
    rides['rain'] = {'d': '2026-07-30', 'start': t0, 'pts': rain, 'burst': burst, 'spike': spike[0],
                     'best5': next((p['watts'] for p in (load('data', 'strava.json', default={}) or {}).get('power_prs', [])
                                    if p.get('duration_sec') == 5), None)}
    far, ft0, fsec = track_km('2026-02-27_i175156177_中和區-公路車.fit', 30)
    rides['far'] = {'d': '2026-02-27', 'start': ft0, 'sec': fsec, 'pts': far}
    tri = []
    for kind, name, step in (('swim', '2026-03-28_i175155945_台東市-開放水域游泳.fit', 10),
                             ('ride', '2026-03-28_i175155934_台東市-公路車.fit', 30),
                             ('run', '2026-03-28_i175155889_台東市-跑步.fit', 30)):
        pts, st, _ = track_km(name, step, 0)
        tri.append({'kind': kind, 'start': st, 'pts': pts})
    rides['tri'] = tri
    film['rides'] = rides

    # 他騎過的每一條路（ride-atlas 的六個層級，TWD97 → 本地）
    atlas = load('data', 'ride-atlas.json', default={}) or {}
    wx0, wz1 = to_local(WIDE['lat'][0], WIDE['lng'][0]); wx1, wz0 = to_local(WIDE['lat'][1], WIDE['lng'][1])
    lay = []
    for tier, lines in enumerate(atlas.get('routes') or []):
        keep_lines = []
        for ln in lines:
            pts = [(E - E0, N0 - N) for E, N, *_ in ln]
            pts = [q for q in pts if wx0 <= q[0] <= wx1 and wz0 <= q[1] <= wz1]
            pts = rdp(pts, 30)
            if len(pts) >= 2:
                # 差分編碼：第一點絕對座標，之後存與前一點的差（數字短，檔案小一半）
                flat, px, pz = [], 0, 0
                for x, z in pts:
                    x, z = round(x), round(z)
                    flat += [x - px, z - pz]
                    px, pz = x, z
                keep_lines.append(flat)
        lay.append(keep_lines)
    film['atlas'] = lay
    # 海岸線／縣界：ride-atlas 存的是經緯度，要先投影成 TWD97 再簡化（單位 km）
    coast = atlas.get('coast') or {}
    arcs, kinds = [], []
    for arc, kind in zip(coast.get('arcs', []), coast.get('arcKind') or []):
        E, N = tm([q[0] for q in arc], [q[1] for q in arc])
        pts = rdp([(float(e), float(n)) for e, n in zip(np.atleast_1d(E), np.atleast_1d(N))], 250)
        if len(pts) >= 2:
            arcs.append([[round(e / 1000, 2), round(n / 1000, 2)] for e, n in pts]); kinds.append(kind)
    film['taiwan'] = {
        'arcs': arcs,
        'kind': kinds,
        'places': [[n, *(round(float(v) / 1000, 2) for v in tm(lo, la))] for n, la, lo in (
            ('臺北', 25.047, 121.517), ('彰化', 24.080, 120.542), ('臺中', 24.148, 120.674),
            ('新竹', 24.804, 120.968), ('臺東', 22.755, 121.150), ('花蓮', 23.991, 121.611),
            ('高雄', 22.627, 120.301))],
    }
    places = []
    for n, la, lo in (('中社路', 25.10755, 121.56161), ('風櫃嘴', 25.13652, 121.60254), ('碧山', 25.0960, 121.5840),
                      ('劍南路', 25.0930, 121.5530), ('台北 101', 25.0340, 121.5645), ('大稻埕', 25.0565, 121.5075),
                      ('關渡', 25.1190, 121.4650), ('觀音山', 25.1375, 121.4255), ('內湖', 25.0830, 121.5890),
                      ('七星山', 25.1717, 121.5522), ('基隆河', 25.0790, 121.5440), ('淡水河', 25.0900, 121.4700)):
        x, z = to_local(la, lo)
        places.append([n, round(float(x)), round(float(z))])
    film['places'] = places

    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(film, f, ensure_ascii=False, separators=(',', ':'))
        f.write('\n')
    print(f"寫入 {os.path.relpath(OUT, ROOT)}（{os.path.getsize(OUT) // 1024} KB）")


if __name__ == '__main__':
    main()
