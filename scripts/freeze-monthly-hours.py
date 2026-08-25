#!/usr/bin/env python3
"""把每月騎乘時數的歷史從 Strava 凍進 data/monthly-hours.json（一次性）。

為什麼要凍：「月騎乘時數 vs 15.3 h 損益線」是這半年最重要的單一指標，而它一直
在讀 data/strava.json —— Strava 訂閱 2026-08-30 到期，過了就再也生不出歷史。

為什麼不直接改讀 intervals：**intervals 的歷史不完整**。實測逐月對帳
（2026-08-25）：2025-04 ~ 2025-07 intervals 是 0 趟、Strava 有 33 趟 51 小時；
2025-08 少 5 趟、2025-09 少 1 趟、2026-01 少 1 趟。他的 intervals 帳號是
2025-08 才開始接 Garmin 的。2025-11 之後兩邊逐月誤差 ≤0.06 h（同一份 FIT）。

所以：**歷史用 Strava 凍住，當月與之後用 intervals 現算**。15.3 h 那條損益線是
用 17 個月的 Strava 移動時間迴歸出來的，凍住才能跟舊基準比。

    python3 scripts/freeze-monthly-hours.py                # 凍到上個月
    python3 scripts/freeze-monthly-hours.py --through 2026-07
"""
import argparse
import collections
import datetime
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ride_hours  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'monthly-hours.json')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--through', default=None, help='凍到哪個月（含），預設是上個月')
    a = ap.parse_args()

    today = datetime.date.today()
    through = a.through or (today.replace(day=1) - datetime.timedelta(days=1)).strftime('%Y-%m')

    sv = json.load(open(os.path.join(ROOT, 'data', 'strava.json'), encoding='utf-8'))
    # 護欄：Strava 停更之後再跑這支，會拿一份凍住的舊資料去「延長」凍結區間，
    # 把還沒發生的月份寫成 0 小時，而且會蓋掉 intervals 現算的那一段。
    upd = (sv.get('updated_at') or '')[:7]
    if upd and upd < through:
        sys.exit('拒絕：data/strava.json 只更新到 %s，凍到 %s 會把之後的月份寫成假的 0。'
                 '\nStrava 已經停更的話，這支就不該再跑了 —— 凍結區間之後由 intervals 現算。'
                 % (upd, through))
    rides = sv.get('recent_rides') or []
    # 一定要走 ride_hours：室內一趟在 Strava 有兩筆（手錶＋Rouvy），
    # 直接加總會把歷史凍成灌水版，而且之後永遠改不回來。
    per_day = ride_hours.hours_by_date(rides)
    km = collections.defaultdict(float)
    n = collections.Counter()
    for r in rides:
        m = (r.get('date') or '')[:7]
        if not m:
            continue
        km[m] += r.get('distance_km') or 0
        n[m] += 1
    hours = collections.defaultdict(float)
    for d, (ind, out) in per_day.items():
        hours[d[:7]] += ind + out

    months = {m: {'hours': round(h, 2), 'km': round(km[m], 1), 'rides': n[m]}
              for m, h in sorted(hours.items()) if m <= through}
    doc = {
        'frozen_through': through,
        'source': 'data/strava.json recent_rides（已用 scripts/ride_hours.py 去除室內重複）',
        'frozen_at': today.isoformat(),
        'note': ('這一段是歷史快照，不要重算。Strava API 訂閱 2026-08-30 到期，'
                 '之後 %s 以後的月份由 data/fit/_activities.json 現算。'
                 '15.3 h 損益線是用這份口徑迴歸出來的。' % through),
        'months': months,
    }
    json.dump(doc, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    open(OUT, 'a', encoding='utf-8').write('\n')
    print('凍結 %d 個月（%s ~ %s），合計 %.1f h → %s'
          % (len(months), min(months), max(months),
             sum(v['hours'] for v in months.values()), os.path.relpath(OUT, ROOT)))


if __name__ == '__main__':
    main()
