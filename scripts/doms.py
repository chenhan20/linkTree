#!/usr/bin/env python3
"""DOMS 估計 —— 延遲性肌肉痠痛的「預估」，不是量測值。

    python3 scripts/doms.py                       # 重算並印出最近的表
    python3 scripts/doms.py --days 30             # 拉長顯示視窗
    python3 scripts/doms.py --log 2026-08-19 9 --note "下樓梯會痛"   # 記主觀痠痛(0–10)並校準
    python3 scripts/doms.py --quiet               # 只重算不印（給 sync 用）

輸出 data/fit/_doms.json：
  activities[<intervals id>]  每一趟的 DOMS 指數與拆解
  daily[YYYY-MM-DD]           當天累積的預估痠痛（all=全天最高、am=早上七點）
  calibration                 主觀回報 vs 模型的對照

────────────────────────── 模型 ──────────────────────────
DOMS 主要來自**離心收縮**與**不習慣的動作**，跟心肺負荷（TL/TRIMP）是兩件事：
一趟 TL 188 的爬坡可能一點都不酸，一趟 TL 74 的久違跑步可以讓人下不了樓梯。
所以這裡不用 TL，改用三個乘數：

  raw   = 每小時離心係數(項目) × 時數 × 強度修正
  nov   = 重複訓練效應：同項目最近 42 天累積得越多，倍率越接近 1（最高 2.5）
  index = raw × nov / 10                         → 一趟課表的痠痛「本金」

  曲線  f(t) = (t/36)^3 · e^(3(1−t/36))          → 6–12 h 起、**36 h 高峰**、~96 h 退到一成
  每日  daily[d] = Σ 每趟 index × f(該日的 t)

已知的盲點，讀數字時要記得：
- **重訓沒有重量資料**（Garmin 匯出的總重量全是 0），只能用時間 × 固定係數，
  所以「輕鬆的上肢日」跟「大重量腿日」在這裡看起來一樣。腿日請自己 --log 校正。
- 沒有海拔／下坡資料（_activities.json 沒有這兩欄），所以**下坡跑被低估**。
- 個體差異很大。這支的用途是「排下一堂課之前先看一眼」，不是診斷。
"""
import json, argparse, datetime, math, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIT = os.path.join(ROOT, 'data', 'fit')
ACT = os.path.join(FIT, '_activities.json')
OUT = os.path.join(FIT, '_doms.json')
FB = os.path.join(FIT, '_doms_feedback.json')
REC = os.path.join(FIT, '_doms_recurring.json')

# 每小時的離心係數（跑步 = 100 當基準）
ECC = {'run': 100, 'bball': 100, 'treadmill': 85, 'class': 80, 'hike': 70,
       'lift': 55, 'ride': 12, 'swim': 3, 'other': 20}
SPORT = {
    'Run': 'run', 'TrailRun': 'run', 'VirtualRun': 'treadmill',
    'Ride': 'ride', 'VirtualRide': 'ride', 'GravelRide': 'ride', 'MountainBikeRide': 'ride',
    'WeightTraining': 'lift', 'Workout': 'lift',
    'Swim': 'swim', 'OpenWaterSwim': 'swim', 'Hike': 'hike',
    'Basketball': 'bball', 'Soccer': 'bball', 'Badminton': 'bball', 'Tennis': 'bball',
    'HighIntensityIntervalTraining': 'class', 'Crossfit': 'class', 'Elliptical': 'class',
}
PEAK_H = 36.0     # 高峰落在活動後 36 小時
SHAPE_K = 3.0     # 曲線陡度：越大退得越快
NOV_K = 1.5       # 重複訓練效應的最大加成（1 + NOV_K = 2.5 倍）
NOV_E0 = 60.0     # 曝光量的半衰刻度
EXPOSURE_DAYS = 42
EXPOSURE_TAU = 21.0
SCALE = 3.3       # 校準：不習慣的跑步、閾值強度、整整 1 小時 = 100 分


def sport_of(t):
    return SPORT.get(t or '', 'other')


def curve(hours):
    """t 小時後還剩幾成。t<0（活動還沒發生）回 0。"""
    if hours <= 0:
        return 0.0
    x = hours / PEAK_H
    return x ** SHAPE_K * math.exp(SHAPE_K * (1 - x))


def load(path, default):
    try:
        return json.load(open(path, encoding='utf-8'))
    except (FileNotFoundError, json.JSONDecodeError):
        return default



def recurring(rows):
    """把「沒被錶錄到但每週固定發生」的活動合成成佔位的一趟。

    來源 data/fit/_doms_recurring.json。同一天已經有同 sport 的真實活動就讓位，
    所以哪天他真的戴錶錄了籃球，佔位會自動消失，不會重複計算。
    """
    cfg = load(REC, {})
    evs = [e for e in cfg.get('events', []) if e.get('enabled', True)]
    if not evs:
        return []
    real = {(r['date'], r['sport']) for r in rows}
    last = max((r['date'] for r in rows), default=None)
    end = max(datetime.date.fromisoformat(last) if last else datetime.date.today(),
              datetime.date.today()) + datetime.timedelta(days=7)
    out = []
    for e in evs:
        sp = e['sport']
        if sp not in ECC:
            continue
        hh, mm = (int(x) for x in e.get('start', '20:00').split(':'))
        if e.get('dates'):                      # 一次性的特例（不是每週）
            days = [datetime.date.fromisoformat(x) for x in e['dates']]
        else:
            d = datetime.date.fromisoformat(e['from'])
            d += datetime.timedelta(days=(e['weekday'] - d.weekday()) % 7)
            stop = min(end, datetime.date.fromisoformat(e['to'])) if e.get('to') else end
            days = []
            while d <= stop:
                days.append(d)
                d += datetime.timedelta(days=7)
        for d in days:
            if (d.isoformat(), sp) not in real:
                inten = e.get('intensity')
                imul = min(2.2, max(0.5, (inten / 70.0) ** 1.4)) if inten else 1.0
                hours = float(e.get('hours', 1.0))
                out.append({
                    'id': 'recur:{}:{}'.format(e['id'], d.isoformat()),
                    'sport': sp, 'type': e.get('name'), 'name': e.get('name'),
                    'start': datetime.datetime.combine(d, datetime.time(hh, mm)).isoformat(),
                    'date': d.isoformat(), 'min': round(hours * 60),
                    'raw': ECC[sp] * hours * imul,
                    'intensity': inten, 'tl': None, 'placeholder': True,
                })
    return out


def compute():
    acts = load(ACT, {})
    rows = []
    for aid, v in acts.items():
        sd = v.get('start_date_local') or ''
        if len(sd) < 16:
            continue
        secs = sum(v.get('icu_hr_zone_times') or []) or (v.get('moving_time') or 0)
        if not secs:
            continue
        sp = sport_of(v.get('type'))
        inten = v.get('icu_intensity')
        # 重訓的 icu_intensity 是心率算的（~30%），跟機械負荷無關 → 不用它
        if sp == 'lift' or not inten:
            imul = 1.0
        else:
            imul = min(2.2, max(0.5, (inten / 70.0) ** 1.4))
        raw = ECC[sp] * (secs / 3600.0) * imul
        rows.append({'id': aid, 'sport': sp, 'type': v.get('type'), 'name': v.get('name'),
                     'start': sd, 'date': sd[:10], 'min': round(secs / 60), 'raw': raw,
                     'intensity': inten, 'tl': v.get('icu_training_load')})
    rows += recurring(rows)          # 補上籃球／有氧課這種沒被錄到的固定行程
    rows.sort(key=lambda r: r['start'])

    # 重複訓練效應：同項目最近 42 天的曝光量越高，這一趟越不會酸
    out = {}
    for i, r in enumerate(rows):
        t0 = datetime.datetime.fromisoformat(r['start'])
        exp = 0.0
        for q in rows[:i]:
            if q['sport'] != r['sport']:
                continue
            dd = (t0 - datetime.datetime.fromisoformat(q['start'])).total_seconds() / 86400.0
            if 0 < dd <= EXPOSURE_DAYS:
                exp += q['raw'] * math.exp(-dd / EXPOSURE_TAU)
        nov = 1 + NOV_K * math.exp(-exp / NOV_E0)
        r['exposure'] = round(exp, 1)
        r['novelty'] = round(nov, 2)
        r['index'] = round(r['raw'] * nov / SCALE, 1)
        r['peak_at'] = (t0 + datetime.timedelta(hours=PEAK_H)).strftime('%Y-%m-%d %H:%M')
        last = next((q['date'] for q in reversed(rows[:i]) if q['sport'] == r['sport']), None)
        gap = (t0.date() - datetime.date.fromisoformat(last)).days if last else None
        r['days_since_same_sport'] = gap
        r['why'] = '{}／{} 分／強度修正 {:.2f}／新鮮度 ×{:.2f}{}'.format(
            r['sport'], r['min'], (r['raw'] / max(ECC[r['sport']] * r['min'] / 60, 1e-9)), nov,
            '（上次同項目 {} 天前）'.format(gap) if gap is not None else '（沒有前例）')
        out[r['id']] = {k: r[k] for k in ('date', 'sport', 'type', 'name', 'min', 'index',
                                          'novelty', 'exposure', 'peak_at',
                                          'days_since_same_sport', 'why')}
        if r.get('placeholder'):
            out[r['id']]['placeholder'] = True

    # 每日累積
    if rows:
        d0 = datetime.date.fromisoformat(rows[0]['date'])
        d1 = max(datetime.date.fromisoformat(rows[-1]['date']) + datetime.timedelta(days=5),
                 datetime.date.today())
        # 先把每個整點的「總和」算出來再取當天最高。
        # （各趟自己的當日最高再相加會重複計算 —— 兩趟的高峰時間根本不同。）
        daily = {}
        d = d0
        while d <= d1:
            live = [r for r in rows
                    if datetime.date.fromisoformat(r['date']) <= d
                    and (d - datetime.date.fromisoformat(r['date'])).days <= 6]
            hourly = []
            for h in range(24):
                t = datetime.datetime.combine(d, datetime.time(h))
                hourly.append(sum(r['index'] * curve(
                    (t - datetime.datetime.fromisoformat(r['start'])).total_seconds() / 3600.0)
                    for r in live))
            top = max(live, key=lambda r: r['index'] * curve(
                (datetime.datetime.combine(d, datetime.time(12))
                 - datetime.datetime.fromisoformat(r['start'])).total_seconds() / 3600.0),
                default=None)
            if max(hourly, default=0) >= 0.5:
                daily[d.isoformat()] = {'all': round(max(hourly), 1), 'am': round(hourly[7], 1),
                                        'top': top['id'] if top else None}
            d += datetime.timedelta(days=1)
    else:
        daily = {}

    fb = load(FB, [])
    cal = []
    for f in fb:
        got = daily.get(f['date'], {}).get('all')
        cal.append({'date': f['date'], 'rating': f['rating'], 'model': got,
                    'model_0_10': round(got / 10.0, 1) if got is not None else None,
                    'note': f.get('note', '')})
    doc = {
        '_model': '離心係數 × 時數 × 強度修正 × 重複訓練效應；曲線 36 小時高峰、~96 小時退到一成。'
                  '這是估計不是量測，重訓沒有重量資料、沒有下坡資料，見 scripts/doms.py 的說明。',
        'version': 1,
        'params': {'peak_h': PEAK_H, 'shape_k': SHAPE_K, 'nov_k': NOV_K, 'nov_e0': NOV_E0,
                   'ecc': ECC, 'scale': SCALE},
        'activities': out,
        'daily': daily,
        'calibration': cal,
    }
    tmp = OUT + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=1, sort_keys=True)
    os.replace(tmp, OUT)
    return doc


def band(v):
    return ('—' if v < 10 else '低' if v < 25 else '中' if v < 45 else '高' if v < 65 else '很高')


def show(doc, days):
    today = datetime.date.today().isoformat()
    print('=== DOMS 預估（估計值，不是量測值）===\n')
    acts = sorted(doc['activities'].items(), key=lambda kv: kv[1]['date'], reverse=True)
    since = (datetime.date.today() - datetime.timedelta(days=days)).isoformat()
    print('── 每趟的痠痛本金（近 {} 天）'.format(days))
    print('{:12}{:11}{:>5}{:>7}{:>8}   {:13}{}'.format(
        '日期', '項目', '分', '指數', '新鮮度', '高峰', '名稱'))
    for aid, a in acts:
        if a['date'] < since:
            continue
        print('{:12}{:11}{:>5}{:>7}{:>8}   {:13}{}'.format(
            a['date'], a['sport'], a['min'], round(a['index']), '×{:.2f}'.format(a['novelty']),
            a['peak_at'][5:], (a['name'] or '')[:18]))
    print('\n── 每日預估（am = 早上七點，訓練窗口那個時間點）')
    print('{:11}{:>7}{:>7}  {}'.format('日期', '全天', 'am', '判讀'))
    for d in sorted(doc['daily']):
        if d < since:
            continue
        v = doc['daily'][d]
        mark = ' ← 今天' if d == today else ''
        print('{:12}{:>7}{:>7}   {:6}{}'.format(
            d, round(v['all']), round(v['am']), band(v['all']), mark))
    if doc['calibration']:
        print('\n── 校準（主觀 0–10 vs 模型）')
        for c in doc['calibration']:
            print('  {}  主觀 {}/10   模型 {}/10  {}'.format(
                c['date'], c['rating'], c['model_0_10'], c['note']))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--days', type=int, default=21)
    ap.add_argument('--quiet', action='store_true')
    ap.add_argument('--log', nargs=2, metavar=('DATE', 'RATING'), help='記一筆主觀痠痛 0–10')
    ap.add_argument('--note', default='')
    a = ap.parse_args()
    if a.log:
        fb = load(FB, [])
        fb = [x for x in fb if x['date'] != a.log[0]]
        fb.append({'date': a.log[0], 'rating': float(a.log[1]), 'note': a.note})
        fb.sort(key=lambda x: x['date'])
        json.dump(fb, open(FB, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print('已記錄 {} 主觀痠痛 {}/10 {}'.format(a.log[0], a.log[1], a.note))
    doc = compute()
    if not a.quiet:
        show(doc, a.days)
    return 0


if __name__ == '__main__':
    sys.exit(main())
