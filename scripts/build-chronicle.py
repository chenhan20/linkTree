#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build-chronicle.py —— 產生 data/chronicle.json（運動編年史動畫 strava_chronicle.html 的資料）

那一頁是一支約 100 秒的像素動畫：一個月一關，地形高低＝那個月騎了幾小時，
路上的金幣＝Strava 路段 PR，最後是中社路歷來每一次成績同場競速。
畫面上的每個數字都從這份檔案來，文案（笑點）寫在頁面裡。

純本機彙整，不打任何 API、不到一秒。

口徑（刻意跟其他頁一致，不自己發明）：
  月時數／公里／趟數  scripts/ride_hours.py 的 monthly_series()：歷史吃凍結快照、
                      之後從 intervals 現算，室內重複已去掉。15.3 h 損益線就是用這個口徑迴歸的。
  逐筆活動            data/strava-archive/index.json（harvest-strava.js 封存的全史，含 PR 數與讚數）；
                      封存最後一天之後改讀 data/fit/_activities.json（intervals.icu，沒有 PR 數與讚數）。
                      Strava 訂閱斷掉之後這支照樣能跑，只是新月份的金幣會停在 0。
  爬升                只算戶外。Rouvy 的虛擬爬升不是真的爬。
  eFTP                _wellness.json 的 sportInfo[Ride].eftp，切到今天（檔案裡有未來日的推算值）；
                      2025-08 是 intervals 剛接上帳號的收斂期（199 → 235 兩週），不收。
  中社路              itt-segments.json 全部成績（2025-06 起，前四筆只有 Strava）＋ segment-grades.json 的 FIT 坡度剖面

隱私：Walk／Hike 不收；名稱裡有家庭字眼的活動只留數字、名稱清掉（這個 repo 是公開的）。

用法：
  python3 scripts/build-chronicle.py            # 寫檔
  python3 scripts/build-chronicle.py --dry-run  # 只印摘要
"""
import collections
import datetime as dt
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import ride_hours  # noqa: E402

OUT = os.path.join(ROOT, 'data', 'chronicle.json')
BREAKEVEN_H = 15.3                     # 跟 coach-brief.py、strava.html 收成頁同一個常數
CLIMB_ID = 1761462                     # 中社路 全段：唯一從第一個月騎到現在的爬坡
PR_SEGMENTS = [(1761462, '中社路'), (641218, '風櫃嘴'), (956558, '劍南路')]
PRIVATE_WORDS = ('孕', '老婆', '太太', '寶寶', '小孩', '兒子', '女兒', '餵', '奶')

try:
    from zoneinfo import ZoneInfo
    TODAY = dt.datetime.now(ZoneInfo('Asia/Taipei')).date().isoformat()
except Exception:                      # CI 的 runner 是 UTC，沒有 zoneinfo 時用 +8 硬算
    TODAY = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=8)).date().isoformat()


def load(*p, default=None):
    try:
        return json.load(open(os.path.join(ROOT, *p), encoding='utf-8'))
    except (OSError, ValueError):
        return default


def sport_of(t, trainer=False):
    t = t or ''
    if t in ('VirtualRide',) or (t in ride_hours.RIDE_TYPES and trainer):
        return 'vride'
    if t in ride_hours.RIDE_TYPES:
        return 'ride'
    if t in ('Run', 'VirtualRun', 'TrailRun'):
        return 'run'
    if t == 'Swim':
        return 'swim'
    if t in ('WeightTraining', 'Workout', 'Crossfit'):
        return 'gym'
    return None                        # Walk / Hike / 其他：不收


def clean_name(n):
    n = (n or '').strip()
    return '' if any(w in n for w in PRIVATE_WORDS) else n


# ── 逐筆活動：Strava 封存為主，之後接 intervals ──────────────────────────
def collect_activities():
    idx = load('data', 'strava-archive', 'index.json', default=[]) or []
    acts = []
    strava_through = ''
    for a in idx:
        sp = sport_of(a.get('sport_type') or a.get('type'), a.get('trainer'))
        loc = str(a.get('start_date_local') or '')
        if not loc:
            continue
        strava_through = max(strava_through, loc[:10])
        if not sp:
            continue
        name = a.get('name') or ''
        if sp == 'ride' and (a.get('distance') or 0) == 0:
            sp = 'vride'               # 手錶錄的室內（沒速度來源）在 Strava 是 Ride＋0 km
        acts.append({
            'd': loc[:10], 't': loc[11:16], 'sp': sp,
            'km': round((a.get('distance') or 0) / 1000, 1),
            'h': round((a.get('moving_time') or 0) / 3600, 2),
            'el': round(a.get('total_elevation_gain') or 0) if sp == 'ride' else 0,
            'pr': a.get('pr_count') or 0, 'ku': a.get('kudos_count') or 0,
            'name': clean_name(name),
            'rouvy': (a.get('device_name') == 'Rouvy') or name.upper().startswith('ROUVY'),
            'dw': bool(a.get('device_watts')), 'dev': a.get('device_name') or '',
            'src': 'strava',
        })

    ignore = set(((load('data', 'fit', '_ignore_activities.json', default={}) or {}).get('ids') or {}).keys())
    est = load('data', 'fit', '_est_distance.json', default={}) or {}
    for aid, v in (load('data', 'fit', '_activities.json', default={}) or {}).items():
        loc = str(v.get('start_date_local') or '')
        if not loc or loc[:10] <= strava_through or aid in ignore:
            continue
        sp = sport_of(v.get('type'))
        if not sp:
            continue
        km = (v.get('distance') or 0) / 1000
        if sp == 'ride' and not km:
            sp = 'vride'
            km = (est.get(aid) or {}).get('km') or 0
        acts.append({
            'd': loc[:10], 't': loc[11:16], 'sp': sp, 'km': round(km, 1),
            'h': round((v.get('moving_time') or 0) / 3600, 2),
            'el': round(v.get('total_elevation_gain') or 0) if sp == 'ride' else 0,
            'pr': 0, 'ku': 0, 'name': clean_name(v.get('name')), 'rouvy': False,
            'dw': bool(v.get('power_meter')), 'dev': v.get('device_name') or '', 'src': 'intervals',
        })
    acts = [a for a in acts if a['d'] <= TODAY]
    acts.sort(key=lambda a: (a['d'], a['t']))
    return dedupe_indoor(acts), strava_through


def dedupe_indoor(acts):
    """同一天的室內騎乘分手錶堆與 Rouvy 堆，留比較長的那一堆（ride_hours.py 同規則）。"""
    piles = collections.defaultdict(lambda: {'watch': [], 'rouvy': []})
    for a in acts:
        if a['sp'] == 'vride':
            piles[a['d']]['rouvy' if a['rouvy'] else 'watch'].append(a)
    drop = set()
    for p in piles.values():
        if p['watch'] and p['rouvy']:
            hw = sum(a['h'] for a in p['watch'])
            hr = sum(a['h'] for a in p['rouvy'])
            loser = p['rouvy'] if hw >= hr else p['watch']
            # 被去掉的那一堆如果帶著 PR 數或讚數，搬到留下來的第一筆，金幣才不會少
            keep = (p['watch'] if loser is p['rouvy'] else p['rouvy'])[0]
            for a in loser:
                keep['pr'] += a['pr']
                keep['ku'] += a['ku']
                drop.add(id(a))
    return [a for a in acts if id(a) not in drop]


# ── eFTP：切到今天、丟掉收斂期、每週取樣 ─────────────────────────────────
def eftp_series():
    w = load('data', 'fit', '_wellness.json', default={}) or {}
    out = []
    for d in sorted(w):
        if d > TODAY or d < '2025-09-01':
            continue
        ef = None
        for si in (w[d] or {}).get('sportInfo') or []:
            if si.get('type') == 'Ride' and si.get('eftp'):
                ef = si['eftp']
        if ef:
            out.append((d, round(ef)))
    weekly = [p for i, p in enumerate(out) if i % 7 == 0]
    if out and weekly[-1] != out[-1]:
        weekly.append(out[-1])
    peak = max(out, key=lambda p: p[1]) if out else None
    return weekly, peak


# ── 路段 PR 演進 ────────────────────────────────────────────────────────
def segment_history():
    segs = {s['id']: s for s in (load('data', 'itt-segments.json', default=[]) or [])}
    events, climb = [], None
    for sid, label in PR_SEGMENTS:
        s = segs.get(sid)
        if not s:
            continue
        effs = sorted((e for e in s.get('efforts') or [] if e.get('elapsed_sec') and e.get('date', '') <= TODAY),
                      key=lambda e: (e['date'], e.get('start_time') or ''))
        best = None
        for i, e in enumerate(effs):
            if best is None or e['elapsed_sec'] < best:
                events.append({'d': e['date'], 'k': 'itt', 'seg': label, 's': round(e['elapsed_sec']),
                               'prev': best and round(best), 'first': i == 0})
                best = e['elapsed_sec']
        if sid == CLIMB_ID:
            grades = ((load('data', 'segment-grades.json', default={}) or {}).get(str(sid)) or {})
            climb = {
                'id': sid, 'name': label, 'km': s.get('distance_km'),
                'step_m': grades.get('step'), 'grade': grades.get('grade') or [],
                'efforts': [[e['date'], e.get('start_time') or '', round(e['elapsed_sec']), e.get('avg_watts')]
                            for e in effs],
            }
    return events, climb


def power_records():
    prs = (load('data', 'strava.json', default={}) or {}).get('power_prs') or []
    return [{'label': p.get('duration_label'), 'sec': p.get('duration_sec'), 'w': p.get('watts'),
             'd': p.get('date'), 'name': clean_name(p.get('activity_name'))}
            for p in prs if p.get('watts') and (p.get('date') or '') <= TODAY]


# ── 自動偵測的里程碑 ─────────────────────────────────────────────────────
def milestones(acts):
    ev = []
    seen = set()
    for a in acts:
        key = 'ride' if a['sp'] in ('ride', 'vride') else a['sp']
        if key not in seen:
            seen.add(key)
            ev.append({'d': a['d'], 'k': 'first', 'sp': key, 'name': a['name'], 'km': a['km']})
    fr = next((a for a in acts if 'Forerunner 970' in a['dev']), None)
    if fr:
        ev.append({'d': fr['d'], 'k': 'gear', 'what': 'watch'})
    nb = next((a for a in acts if '新車' in a['name']), None)
    if nb:
        ev.append({'d': nb['d'], 'k': 'gear', 'what': 'bike', 'name': nb['name']})
    pm = next((a for a in acts if a['sp'] == 'ride' and a['dw'] and a['km'] > 0), None)
    if pm:
        ev.append({'d': pm['d'], 'k': 'gear', 'what': 'power'})

    far = climb = 0
    early = '06:00'
    for a in acts:
        if a['sp'] != 'ride':
            continue
        if a['km'] > far:
            if a['km'] >= 50:
                ev.append({'d': a['d'], 'k': 'far', 'km': a['km'], 'prev': far, 'name': a['name']})
            far = a['km']
        if a['el'] > climb:
            if a['el'] >= 1000:
                ev.append({'d': a['d'], 'k': 'climb', 'el': a['el'], 'prev': climb, 'name': a['name']})
            climb = a['el']
        if a['t'] and a['t'] < early:
            if a['t'] < '05:30':
                ev.append({'d': a['d'], 'k': 'early', 't': a['t'], 'name': a['name']})
            early = a['t']

    tri = collections.defaultdict(list)
    for a in acts:
        if '三鐵' in a['name']:
            tri[a['d']].append(a)
    for d, legs in tri.items():
        ev.append({'d': d, 'k': 'tri', 'name': legs[0]['name'].split(' ')[0],
                   'legs': [[l['sp'], l['km'], l['h']] for l in legs]})
    return ev


def main():
    dry = '--dry-run' in sys.argv
    acts, strava_through = collect_activities()
    series = ride_hours.monthly_series()
    weekly, peak = eftp_series()
    seg_events, climb = segment_history()

    first_m = min([a['d'][:7] for a in acts] + list(series))
    months, m = [], first_m
    while m <= TODAY[:7]:
        s = series.get(m, {})
        mine = [a for a in acts if a['d'][:7] == m]
        runs = [a for a in mine if a['sp'] == 'run']
        swims = [a for a in mine if a['sp'] == 'swim']
        ef = [v for d, v in weekly if d[:7] == m]
        months.append({
            'm': m, 'h': round(s.get('hours', 0), 2), 'km': round(s.get('km', 0), 1),
            'rides': s.get('rides', 0), 'elev': sum(a['el'] for a in mine),
            'runs': len(runs), 'run_km': round(sum(a['km'] for a in runs), 1),
            'swims': len(swims), 'swim_km': round(sum(a['km'] for a in swims), 1),
            'gym': sum(1 for a in mine if a['sp'] == 'gym'),
            'pr': sum(a['pr'] for a in mine), 'kudos': sum(a['ku'] for a in mine),
            'eftp': ef[-1] if ef else None,
            'partial': m == TODAY[:7],
        })
        y, mm = int(m[:4]), int(m[5:])
        m = f'{y + (mm == 12)}-{(mm % 12) + 1:02d}'

    events = milestones(acts) + seg_events
    if peak:
        events.append({'d': peak[0], 'k': 'eftp_peak', 'w': peak[1]})
    for p in power_records():
        events.append({'d': p['d'], 'k': 'power', 'label': p['label'], 'sec': p['sec'], 'w': p['w'],
                       'name': p['name']})
    events.sort(key=lambda e: e['d'])

    rides = [a for a in acts if a['sp'] == 'ride']
    longest = max(rides, key=lambda a: a['km']) if rides else None
    highest = max(rides, key=lambda a: a['el']) if rides else None
    earliest = min((a for a in rides if a['t']), key=lambda a: a['t']) if rides else None
    full = [x for x in months if not x['partial']]
    totals = {
        'days': len({a['d'] for a in acts}),
        'rides': sum(x['rides'] for x in months), 'ride_km': round(sum(x['km'] for x in months)),
        'ride_h': round(sum(x['h'] for x in months), 1), 'elev': sum(x['elev'] for x in months),
        'runs': sum(x['runs'] for x in months), 'run_km': round(sum(x['run_km'] for x in months), 1),
        'swims': sum(x['swims'] for x in months), 'swim_km': round(sum(x['swim_km'] for x in months), 1),
        'gym': sum(x['gym'] for x in months), 'pr': sum(x['pr'] for x in months),
        'kudos': sum(x['kudos'] for x in months),
        'longest': longest and {'d': longest['d'], 'km': longest['km'], 'name': longest['name']},
        'highest': highest and {'d': highest['d'], 'el': highest['el'], 'name': highest['name']},
        'earliest': earliest and {'d': earliest['d'], 't': earliest['t'], 'name': earliest['name']},
        'best_month': max(full, key=lambda x: x['h'])['m'] if full else None,
        'above_breakeven': [x['m'] for x in months if x['h'] >= BREAKEVEN_H],
    }

    out = {
        # 刻意不放產生時間：CI 一天跑兩班，內容沒變就不該多一個 commit
        'today': TODAY, 'strava_through': strava_through, 'breakeven_h': BREAKEVEN_H,
        'months': months, 'eftp': weekly, 'events': events, 'climb': climb,
        'totals': totals,
        # 逐筆：日期、時間、項目、公里、小時、爬升、PR 數、讚數、名稱
        'acts': [[a['d'], a['t'], a['sp'], a['km'], a['h'], a['el'], a['pr'], a['ku'], a['name']] for a in acts],
    }

    print(f"編年史 {months[0]['m']} → {months[-1]['m']}（{len(months)} 個月）・活動 {len(acts)} 筆・事件 {len(events)} 個")
    print(f"  騎乘 {totals['rides']} 趟 {totals['ride_km']} km {totals['ride_h']} h・爬升 {totals['elev']} m・"
          f"路段 PR {totals['pr']}・Strava 封存到 {strava_through}")
    if dry:
        return
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
        f.write('\n')
    print(f"  寫入 {os.path.relpath(OUT, ROOT)}（{os.path.getsize(OUT) // 1024} KB）")


if __name__ == '__main__':
    main()
