#!/usr/bin/env python3
"""分時期的功率曲線：把「我的引擎跟半年前比」算出來。

data/fit/_power_curve.json 只有全史最佳（scope: "all"），回答不了「有沒有變強」——
一條全史曲線上的每個點可能來自完全不同的月份，看不出方向。這支腳本改從
本機的 FIT 逐點功率重算，並且切成兩個等長的時間窗，讓同一條曲線可以自己比自己。

    python3 scripts/build-power-curve.py                # 產生 data/power-curve-windows.json
    python3 scripts/build-power-curve.py --days 182     # 改窗長（預設 182 天，約半年）
    python3 scripts/build-power-curve.py --check        # 只印不寫檔

資料源全部在 repo 內，不打任何 API：
  data/fit/*.fit    逐秒功率。檔名的最後一段是運動別，只吃「公路車」與「室內自行車」。

兩個口徑上的決定：

1. **中斷就切段。** FIT 的 record 通常是 1 Hz，但自動暫停、等紅燈停錶、
   隧道掉訊都會留下時間洞。跨過洞去算「連續 20 分鐘平均」是假的 —— 你並沒有
   連續踩 20 分鐘。所以只要相鄰兩點差超過 GAP_SEC，就當成兩段各自算。

2. **沒有功率的點當 0 不是當缺值。** 滑行就是 0 瓦，那是真的。把它跳過會讓
   下坡滑行的那一段「平均功率」憑空變高 —— 60 分鐘那個時長最容易被這樣灌水。
   但整趟都沒有功率欄位的（沒帶功率計）直接整趟跳過，那是缺資料不是零。
"""
import argparse
import collections
import glob
import json
import os
import sys
from datetime import timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'tcx'))

OUT = os.path.join(ROOT, 'data', 'power-curve-windows.json')
FIT_DIR = os.path.join(ROOT, 'data', 'fit')

# 跟 strava.html 的 PWR_DURATIONS 對齊，兩張圖才共用同一根 x 軸
DURATIONS = (5, 10, 30, 60, 120, 300, 600, 1200, 3600)
RIDE_KINDS = ('公路車', '自行車')      # 檔名最後一段
GAP_SEC = 8                            # 超過這個秒數視為錄製中斷，切段


def ride_files():
    out = []
    for p in sorted(glob.glob(os.path.join(FIT_DIR, '*.fit'))):
        kind = os.path.basename(p).rsplit('_', 1)[-1][:-4]
        if any(k in kind for k in RIDE_KINDS):
            out.append(p)
    return out


def power_segments(points):
    """把逐點功率切成「沒有中斷」的連續段，回傳每段一個 list[int]。

    回 None 表示這一趟根本沒有功率欄位（沒帶功率計），跟「整趟 0 瓦」不同。
    """
    if not any(p.get('w') is not None for p in points):
        return None
    segs, cur, prev = [], [], None
    for p in points:
        t = p.get('t')
        if t is None:
            continue
        if prev is not None:
            gap = (t - prev).total_seconds()
            if gap > GAP_SEC:
                if cur:
                    segs.append(cur)
                cur = []
            elif gap > 1.5:
                # 1–8 秒的小洞用 0 瓦補平：那多半是停在路口，不是沒錄到
                cur.extend([0] * max(0, int(round(gap)) - 1))
        cur.append(int(p.get('w') or 0))
        prev = t
    if cur:
        segs.append(cur)
    return segs


def best_mean(segs, n):
    """所有段裡最好的一段連續 n 秒平均。段比 n 短就跳過那一段。"""
    best = None
    for s in segs:
        if len(s) < n:
            continue
        run = sum(s[:n])
        if best is None or run > best:
            best = run
        for i in range(n, len(s)):
            run += s[i] - s[i - n]
            if run > best:
                best = run
    return None if best is None else best / n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--days', type=int, default=182, help='每個時間窗的長度（天），預設 182')
    ap.add_argument('--check', action='store_true', help='只印結果不寫檔')
    a = ap.parse_args()

    from analyze_tcx import parse_ride            # noqa: E402  （需要 fitdecode）

    files = ride_files()
    if not files:
        sys.exit('data/fit 裡沒有騎乘 FIT')

    rides = []                                    # (date, name, segs)
    skipped_nopower = []
    for p in files:
        base = os.path.basename(p)
        date = base[:10]
        try:
            _meta, _laps, points = parse_ride(p)
        except Exception as e:                    # noqa: BLE001
            print(f'  ! 讀不了 {base}: {e}', file=sys.stderr)
            continue
        segs = power_segments(points)
        if segs is None:
            skipped_nopower.append(base)
            continue
        rides.append((date, base.rsplit('_', 1)[-1][:-4], segs))

    if not rides:
        sys.exit('沒有任何一趟有功率資料')
    rides.sort()
    last = rides[-1][0]
    from datetime import date as D
    end = D.fromisoformat(last)
    mid = end - timedelta(days=a.days)
    start = mid - timedelta(days=a.days)

    windows = [
        {'key': 'prev', 'label': '前一段', 'from': start.isoformat(), 'to': mid.isoformat()},
        {'key': 'now', 'label': '最近', 'from': mid.isoformat(), 'to': end.isoformat()},
    ]
    for w in windows:
        w['rides'] = [r for r in rides if w['from'] < r[0] <= w['to']]

    out = {
        'generated': D.today().isoformat(),
        'window_days': a.days,
        'source': 'data/fit/*.fit',
        'durations': list(DURATIONS),
        'windows': [],
    }
    for w in windows:
        segs_all = [s for _d, _n, segs in w['rides'] for s in segs]
        best = []
        for n in DURATIONS:
            # 逐趟算，才知道那個最佳出自哪一天
            top = None
            for d, name, segs in w['rides']:
                v = best_mean(segs, n)
                if v is not None and (top is None or v > top[0]):
                    top = (v, d, name)
            best.append({'secs': n, 'watts': None if top is None else round(top[0]),
                         'date': None if top is None else top[1],
                         'name': None if top is None else top[2]})
        out['windows'].append({
            'key': w['key'], 'label': w['label'], 'from': w['from'], 'to': w['to'],
            'rides': len(w['rides']),
            'hours': round(sum(len(s) for _d, _n, sg in w['rides'] for s in sg) / 3600, 1),
            'best': best,
        })

    print(f"騎乘 FIT {len(files)} 支，有功率 {len(rides)} 支"
          f"（沒功率跳過 {len(skipped_nopower)} 支）")
    for w in out['windows']:
        print(f"\n{w['label']}  {w['from']} → {w['to']}  {w['rides']} 趟 / {w['hours']} 小時")
        for b in w['best']:
            print(f"    {b['secs']:>5}s  {str(b['watts'] or '—'):>4} W   {b['date'] or ''}")
    prev, now = {b['secs']: b['watts'] for b in out['windows'][0]['best']}, \
                {b['secs']: b['watts'] for b in out['windows'][1]['best']}
    print('\n變化（最近 − 前一段）：')
    for n in DURATIONS:
        if prev.get(n) and now.get(n):
            d = now[n] - prev[n]
            print(f"    {n:>5}s  {d:+4d} W  ({d / prev[n] * 100:+.1f}%)")

    if a.check:
        print('\n--check：沒有寫檔')
        return
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f'\n寫入 {os.path.relpath(OUT, ROOT)}')


if __name__ == '__main__':
    main()
