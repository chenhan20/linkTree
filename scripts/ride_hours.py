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
