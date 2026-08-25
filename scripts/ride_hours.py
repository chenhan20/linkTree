"""月騎乘時數：把室內的重複紀錄去掉。

為什麼需要這支：室內一趟會在 Strava 留下**兩筆**——手錶錄的（曲柄功率，
資料管線的正主）與 Rouvy 自己推的。`data/strava.json` 的 `recent_rides`
兩筆都收，於是月時數被灌水。實測 2026-08：帳面 17.7 h、去重後 14.4 h，
而損益線是 15.3 h —— 一個「已過線 +2.4 h」的結論其實是「還差 0.9 h」。
這個數字是他這半年最重要的單一指標，不能錯。

去重規則刻意不是「一律信手錶」：2026-08-19 手錶只錄到 3 分鐘、Rouvy 那份
才是完整的 36 分鐘。改成**同一天的室內活動分成手錶堆與 Rouvy 堆，取比較長
的那一堆** —— 兩邊都可能是漏錄的那一方。

Strava 停掉之後（訂閱大限 2026-08-30）就只剩手錶那一份，這支會自然退化成
「原樣加總」，不需要改。
"""
import collections


def is_indoor(r):
    return (r.get('sport_type') == 'VirtualRide' or r.get('trainer') is True
            or str(r.get('name') or '').upper().startswith('ROUVY'))


def _rouvy(r):
    return str(r.get('name') or '').upper().startswith('ROUVY')


def hours_by_date(rides, upto=None, month=None):
    """回傳 {日期: (室內小時, 戶外小時)}，室內已去重。"""
    days = collections.defaultdict(lambda: {'watch': 0.0, 'rouvy': 0.0, 'out': 0.0})
    for r in rides:
        d = (r.get('date') or '')
        if not d or (upto and d > upto) or (month and d[:7] != month):
            continue
        h = (r.get('moving_time_sec') or 0) / 3600.0
        if not is_indoor(r):
            days[d]['out'] += h
        elif _rouvy(r):
            days[d]['rouvy'] += h
        else:
            days[d]['watch'] += h
    return {d: (max(v['watch'], v['rouvy']), v['out']) for d, v in days.items()}


def month_hours(rides, month, upto=None):
    """回傳 (總時數, 室內, 戶外)。"""
    by = hours_by_date(rides, upto=upto, month=month)
    ind = sum(v[0] for v in by.values())
    out = sum(v[1] for v in by.values())
    return ind + out, ind, out


def dropped_hours(rides, month=None, upto=None):
    """被去掉的重複時數，用來在報表上講明白，不要靜默吃掉。"""
    days = collections.defaultdict(lambda: {'watch': 0.0, 'rouvy': 0.0})
    for r in rides:
        d = (r.get('date') or '')
        if not d or (upto and d > upto) or (month and d[:7] != month) or not is_indoor(r):
            continue
        h = (r.get('moving_time_sec') or 0) / 3600.0
        days[d]['rouvy' if _rouvy(r) else 'watch'] += h
    return sum(min(v['watch'], v['rouvy']) for v in days.values())


# ── 月騎乘時數：歷史吃凍結快照，當月與之後從 intervals 現算 ──────────────
#
# Strava 訂閱 2026-08-30 到期。歷史已經凍在 data/monthly-hours.json
# （見 scripts/freeze-monthly-hours.py 的說明：intervals 的歷史不完整，
# 2025-07 以前是 0 趟），之後的月份改從 data/fit/_activities.json 算。
# 兩邊口徑實測一致：2025-11 之後逐月誤差 ≤0.06 h，因為都是同一份 Garmin FIT。

import json
import os

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RIDE_TYPES = ('Ride', 'VirtualRide', 'GravelRide', 'MountainBikeRide')


def _load(*p):
    try:
        return json.load(open(os.path.join(_ROOT, *p), encoding='utf-8'))
    except (OSError, ValueError):
        return None


def monthly_series():
    """回傳 {月: {'hours','km','rides','src'}}，歷史＋現況接好的一整條。"""
    out = {}
    frozen = _load('data', 'monthly-hours.json') or {}
    through = frozen.get('frozen_through', '')
    for m, v in (frozen.get('months') or {}).items():
        out[m] = {**v, 'src': 'frozen'}

    acts = _load('data', 'fit', '_activities.json') or {}
    live = {}
    for v in acts.values():
        if v.get('type') not in RIDE_TYPES:
            continue
        m = str(v.get('start_date_local', ''))[:7]
        if not m or (through and m <= through):
            continue          # 凍結區間不重算，才不會讓損益線的基準漂掉
        d = live.setdefault(m, {'hours': 0.0, 'km': 0.0, 'rides': 0, 'src': 'intervals'})
        d['hours'] += (v.get('moving_time') or 0) / 3600.0
        d['km'] += (v.get('distance') or 0) / 1000.0
        d['rides'] += 1
    for m, d in live.items():
        d['hours'] = round(d['hours'], 2)
        d['km'] = round(d['km'], 1)
        out[m] = d
    return dict(sorted(out.items()))


def month_of(month):
    """單一月份，找不到就回 0。"""
    return monthly_series().get(month, {'hours': 0.0, 'km': 0.0, 'rides': 0, 'src': 'none'})
