#!/usr/bin/env python3
"""疊線版：真實軌跡折線 + 行政區歸戶。

跟密度版的差別：密度場的 bandwidth 本來就是設計來抹掉小於該尺度的結構，
所以看不到路線輪廓。這裡改成畫真的折線，並且**用每段線所在 25 m 格的
「不重複騎乘趟數」上色** —— 銳利的線 + 精確的數字，不必靠加法混色。

輸出
  routes    6 個色階各自的折線集合（世界座標，公尺，量化到 1 m）
  towns     行政區多邊形 + 該區的騎乘公里數/趟數（灰階填色用）
  coast     全台海岸線與縣市界（縮小時的底圖）
  places    你自己命名的 ITT 路段 + 次數
"""
import json, math, os, glob, collections, sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEO = os.path.join(REPO, 'data', 'geo')
CELL = 25.0
RDP_M = 8.0
BREAKS = [1, 2, 4, 8, 16, 32]          # 趟數的 log2 分級，跟色階一一對應

A = 6378137.0; F = 1 / 298.257222101; E2 = F * (2 - F); EP2 = E2 / (1 - E2)


def tm(lng, lat, lon0=121.0, k0=0.9999, FE=250000.0):
    p = math.radians(lat); dl = math.radians(lng - lon0)
    s, c, t = math.sin(p), math.cos(p), math.tan(p)
    N = A / math.sqrt(1 - E2 * s * s); T = t * t; C = EP2 * c * c; a1 = dl * c
    M = A * ((1 - E2 / 4 - 3 * E2 ** 2 / 64 - 5 * E2 ** 3 / 256) * p
             - (3 * E2 / 8 + 3 * E2 ** 2 / 32 + 45 * E2 ** 3 / 1024) * math.sin(2 * p)
             + (15 * E2 ** 2 / 256 + 45 * E2 ** 3 / 1024) * math.sin(4 * p)
             - (35 * E2 ** 3 / 3072) * math.sin(6 * p))
    x = k0 * N * (a1 + (1 - T + C) * a1 ** 3 / 6
                  + (5 - 18 * T + T * T + 72 * C - 58 * EP2) * a1 ** 5 / 120) + FE
    y = k0 * (M + N * t * (a1 * a1 / 2 + (5 - T + 9 * C + 4 * C * C) * a1 ** 4 / 24
              + (61 - 58 * T + T * T + 600 * C - 330 * EP2) * a1 ** 6 / 720))
    return x, y


def decode_polyline(s):
    pts = []; i = 0; lat = 0; lng = 0
    while i < len(s):
        for who in (0, 1):
            shift = 0; res = 0
            while True:
                b = ord(s[i]) - 63; i += 1
                res |= (b & 0x1f) << shift; shift += 5
                if b < 0x20: break
            d = ~(res >> 1) if res & 1 else res >> 1
            if who == 0: lat += d
            else: lng += d
        pts.append((lng * 1e-5, lat * 1e-5))
    return pts


def resample(xy, step):
    out = []
    if not xy: return out
    out.append(xy[0]); carry = 0.0
    for (x0, y0), (x1, y1) in zip(xy, xy[1:]):
        d = math.hypot(x1 - x0, y1 - y0)
        if d > 2000: out.append((x1, y1)); carry = 0.0; continue
        if d == 0: continue
        t = step - carry
        while t <= d:
            out.append((x0 + (x1 - x0) * t / d, y0 + (y1 - y0) * t / d)); t += step
        carry = (carry + d) % step
    return out


def rdp(pts, eps):
    if len(pts) < 3: return pts
    ax, ay = pts[0]; bx, by = pts[-1]
    dx, dy = bx - ax, by - ay
    den = math.hypot(dx, dy)
    imax, dmax = 0, -1.0
    for i in range(1, len(pts) - 1):
        px, py = pts[i]
        d = math.hypot(px - ax, py - ay) if den == 0 else \
            abs(dy * px - dx * py + bx * ay - by * ax) / den
        if d > dmax: imax, dmax = i, d
    if dmax <= eps: return [pts[0], pts[-1]]
    return rdp(pts[:imax + 1], eps)[:-1] + rdp(pts[imax:], eps)


def load_tracks():
    index = json.load(open(os.path.join(REPO, 'data/strava-archive/index.json')))
    detail = {os.path.basename(p)[:-5]: p
              for p in glob.glob(os.path.join(REPO, 'data/strava-archive/activities/*.json'))}
    tracks = []
    for a in index:
        if a.get('type') not in ('Ride', 'GravelRide', 'MountainBikeRide'): continue
        pl = None; did = str(a['id'])
        if did in detail:
            m = json.load(open(detail[did])).get('map') or {}
            pl = m.get('polyline') or m.get('summary_polyline')
        if not pl: pl = (a.get('map') or {}).get('summary_polyline')
        if not pl: continue
        ll = decode_polyline(pl)
        if len(ll) < 2: continue
        lo = [p[0] for p in ll]; la = [p[1] for p in ll]
        if not (119 < min(lo) and max(lo) < 123 and 21 < min(la) and max(la) < 26.5): continue
        tracks.append({'id': a['id'], 'name': a.get('name', ''),
                       'date': a.get('start_date_local', '')[:10], 'll': ll})
    return tracks


def decode_topo(topo, key):
    sx_, sy_ = topo['transform']['scale']; tx_, ty_ = topo['transform']['translate']
    arcs = []
    for arc in topo['arcs']:
        x = y = 0; pts = []
        for dx, dy in arc:
            x += dx; y += dy
            pts.append((x * sx_ + tx_, y * sy_ + ty_))
        arcs.append(pts)
    out = []
    for g in topo['objects'][key]['geometries']:
        polys = g['arcs'] if g['type'] == 'MultiPolygon' else [g['arcs']]
        rings = []
        for poly in polys:
            for ring in poly:
                pts = []
                for ai in ring:
                    seg = arcs[ai] if ai >= 0 else arcs[~ai][::-1]
                    pts.extend(seg if not pts else seg[1:])
                rings.append(pts)
        out.append({'props': g['properties'], 'rings': rings})
    return out



# 全台縣市界 -> arc 拓樸（海岸線與縣市界分開，共用的界線只存一份）。
# 原本是 build_taiwan.py 這支獨立腳本的產物，收進來讓管線只有一個進入點。
INSET = {'金門縣', 'kinmen', '連江縣', 'matsu'}


def build_coast(eps=1.2e-4):
    topo = json.load(open(os.path.join(GEO, 'counties-10t.json')))
    sx_, sy_ = topo['transform']['scale']
    tx_, ty_ = topo['transform']['translate']
    arcs = []
    for arc in topo['arcs']:
        x = y = 0
        pts = []
        for dx, dy in arc:
            x += dx; y += dy
            pts.append([x * sx_ + tx_, y * sy_ + ty_])
        arcs.append(pts)
    geoms = topo['objects']['counties']['geometries']

    use = {}
    for g in geoms:
        polys = g['arcs'] if g['type'] == 'MultiPolygon' else [g['arcs']]
        for poly in polys:
            for ring in poly:
                for a in ring:
                    aid = a if a >= 0 else ~a
                    use[aid] = use.get(aid, 0) + 1

    old2new, out_arcs, kind = {}, [], []
    for aid in sorted(use):
        simp = [[round(x, 5), round(y, 5)] for x, y in rdp(arcs[aid], eps)]
        old2new[aid] = len(out_arcs)
        out_arcs.append(simp)
        kind.append(1 if use[aid] >= 2 else 0)     # 1 = 縣市界，0 = 海岸線

    def remap(rings):
        return [[old2new[a] if a >= 0 else ~old2new[~a] for a in ring] for ring in rings]

    counties = []
    for g in geoms:
        polys = g['arcs'] if g['type'] == 'MultiPolygon' else [g['arcs']]
        nm = g['properties']['COUNTYNAME']
        counties.append({
            'name': nm,
            'group': 'inset' if nm in INSET else 'main',
            'polygons': [remap(poly) for poly in polys],
        })
    return {'arcs': out_arcs, 'arcKind': kind, 'counties': counties}


def bin_of(n):
    i = 0
    while i < len(BREAKS) - 1 and n >= BREAKS[i + 1]: i += 1
    return i


def main():
    sys.setrecursionlimit(100000)
    tracks = load_tracks()
    print(f'{len(tracks)} 趟戶外騎乘（台灣境內）')

    # 25 m 網格：不重複趟數。折線上色與 hover 都用這一份。
    cells = collections.defaultdict(set)
    resampled = []
    for ai, t in enumerate(tracks):
        rs = resample([tm(a, b) for a, b in t['ll']], CELL)
        resampled.append(rs)
        for x, y in rs:
            cells[(int(x // CELL), int(y // CELL))].add(ai)
    cellN = {k: len(v) for k, v in cells.items()}
    print(f'25 m 格 {len(cellN):,} 個   最多 {max(cellN.values())} 趟')

    # 折線：簡化後每個點查它所在格的趟數，再依色階切成連續的段
    groups = [[] for _ in BREAKS]
    npts = 0
    for rs in resampled:
        simp = rdp(rs, RDP_M)
        npts += len(simp)
        cur_b, run = None, []
        for x, y in simp:
            n = cellN.get((int(x // CELL), int(y // CELL)), 1)
            b = bin_of(n)
            if b != cur_b:
                if run and len(run) > 1: groups[cur_b].append(run)
                run = run[-1:] if run else []      # 接上一段，線才不會斷
                cur_b = b
            # 第三個值是這一點所在 25 m 格的精確趟數，給 hover 用
            run.append([int(round(x)), int(round(y)), n])
        if run and len(run) > 1: groups[cur_b].append(run)
    print(f'簡化到 {RDP_M:.0f} m 誤差 -> {npts:,} 點')
    for i, g in enumerate(groups):
        lo = BREAKS[i]; hi = BREAKS[i + 1] - 1 if i + 1 < len(BREAKS) else None
        seg = sum(len(p) for p in g)
        print(f'  {lo}{"–" + str(hi) if hi else "+"} 趟：{len(g):>5} 段 / {seg:>6} 點')

    # 行政區歸戶
    towns_raw = decode_topo(json.load(open(os.path.join(GEO, 'towns-10t.json'))), 'towns')
    tw = []
    for t in towns_raw:
        rings_m = [[tm(a, b) for a, b in r] for r in t['rings']]
        xs = [q[0] for r in rings_m for q in r]; ys = [q[1] for r in rings_m for q in r]
        tw.append({'p': t['props'], 'rings_m': rings_m, 'rings_ll': t['rings'],
                   'bb': (min(xs), min(ys), max(xs), max(ys))})
    G = 2000.0
    grid = collections.defaultdict(list)
    for ti, t in enumerate(tw):
        x0, y0, x1, y1 = t['bb']
        for gx in range(int(x0 // G), int(x1 // G) + 1):
            for gy in range(int(y0 // G), int(y1 // G) + 1):
                grid[(gx, gy)].append(ti)

    def pip(x, y, rings):
        ins = False
        for r in rings:
            n = len(r); j = n - 1
            for i in range(n):
                xi, yi = r[i]; xj, yj = r[j]
                if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                    ins = not ins
                j = i
        return ins

    km = collections.Counter(); rides = collections.defaultdict(set)
    for ai, rs in enumerate(resampled):
        for x, y in rs:
            for ti in grid.get((int(x // G), int(y // G)), ()):
                t = tw[ti]; x0, y0, x1, y1 = t['bb']
                if x < x0 or x > x1 or y < y0 or y > y1: continue
                if pip(x, y, t['rings_m']):
                    km[ti] += CELL / 1000.0; rides[ti].add(ai); break
    print(f'\n騎過的行政區 {len(km)} 個')

    # 底圖收哪些區：騎過的 + 北北基（放大時要有街廓感）
    METRO = {'台北市', '新北市', '基隆市'}
    keep = set(km) | {ti for ti, t in enumerate(tw) if t['p']['COUNTYNAME'] in METRO}
    towns_out = []
    for ti in sorted(keep):
        t = tw[ti]
        rings = [[[round(a, 5), round(b, 5)] for a, b in rdp(list(r), 1.2e-4)]
                 for r in t['rings_ll']]
        towns_out.append({'name': t['p']['TOWNNAME'], 'county': t['p']['COUNTYNAME'],
                          'km': round(km.get(ti, 0.0), 1), 'rides': len(rides.get(ti, ())),
                          'rings': rings})
    towns_out.sort(key=lambda d: -d['km'])
    print(f'底圖收錄行政區 {len(towns_out)} 個（騎過的 + 北北基）')
    for t in towns_out[:8]:
        print(f'  {t["county"]}{t["name"]:<5} {t["km"]:>7.1f} km  {t["rides"]:>3} 趟')

    # 地名：用 itt-config 的 groups[]（母路線）當命名層。
    # ITT 改成「母路線 + 分段」之後，光是中社路就有 6 條分段、至善路 5 條，
    # 各自都超過標名門檻，會在同一條路上互相搶標籤。改成一組只出一個名字：
    # 名字取 groups[].nameZh，次數取該組所有分段裡最高的（分段常常比全段還多筆），
    # 座標就用那條最高的分段中點。
    itt = {s['id']: s for s in json.load(open(os.path.join(REPO, 'data/itt-segments.json')))}
    cfg = json.load(open(os.path.join(REPO, 'data/itt-config.json')))
    grp_name = {g['id']: g['nameZh'] for g in cfg.get('groups', [])}
    seg_grp = {s['id']: s.get('group') for s in cfg.get('segments', [])}

    best = {}
    for f in glob.glob(os.path.join(REPO, 'data/strava-archive/segments/*.json')):
        m = json.load(open(f)).get('meta', {})
        sid = m.get('id')
        if sid not in itt:
            continue
        pl = (m.get('map') or {}).get('polyline')
        if not pl:
            continue
        gid = seg_grp.get(sid)
        name = grp_name.get(gid) or itt[sid]['name'].replace('ITT', '').strip()
        n = len(itt[sid].get('efforts') or [])
        key = gid or name
        if key in best and best[key]['n'] >= n:
            continue
        pts = decode_polyline(pl)
        mid = pts[len(pts) // 2]
        best[key] = {'name': name, 'lng': round(mid[0], 5), 'lat': round(mid[1], 5), 'n': n}
    places = sorted(best.values(), key=lambda p: -p['n'])
    print('\n地名（母路線層級，共 %d 條）：' % len(places))
    for p in places:
        print('  %3d 次  %s' % (p['n'], p['name']))

    coast = build_coast()
    out = {
        'meta': {'cell_m': CELL, 'rdp_m': RDP_M, 'breaks': BREAKS,
                 'activities': len(tracks), 'max_n': max(cellN.values()),
                 'total_km': round(sum(len(r) for r in resampled) * CELL / 1000),
                 'towns_ridden': len(km), 'projection': 'EPSG:3826 TWD97/TM2'},
        'routes': groups, 'towns': towns_out, 'places': places,
        'coast': {'arcs': coast['arcs'], 'arcKind': coast['arcKind'],
                  'counties': [{'name': c['name'], 'group': c['group'],
                                'polygons': c['polygons']} for c in coast['counties']]},
    }
    path = os.path.join(REPO, 'data', 'ride-atlas.json')
    json.dump(out, open(path, 'w'), ensure_ascii=False, separators=(',', ':'))
    print(f'\n-> {path}  {os.path.getsize(path)/1024:.0f} KB')


main()
