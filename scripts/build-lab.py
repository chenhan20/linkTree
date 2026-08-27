#!/usr/bin/env python3
"""實驗室頁（lab.html）的資料前處理 —— 把「瀏覽器讀不到的東西」先算完。

    python3 scripts/build-lab.py              # 產生 data/lab.json
    python3 scripts/build-lab.py --quiet      # 不印進度

為什麼要有這支：lab.html 想問四個問題，其中兩個的答案只存在於 .fit 裡 ——
瀏覽器沒有 FIT 解析器，也不該在使用者的手機上解 60 個二進位檔。所以逐秒踏頻分布、
路段視窗內的齒比停留時間，全部在這裡算成小小的直方圖與百分比，前端只負責畫。

四段產出：
  sleep_perf  「昨晚睡多少 → 今天騎得怎樣」。每趟有功率的騎乘配對當天早上的 wellness。
  scores      主課表的處方對帳（總分、四個維度、逐段的處方帶 vs 實際）。
  cadence     逐秒踏頻直方圖：整體 vs 各爬坡路段。**要解 FIT。**
  gears       各爬坡路段的齒比停留時間與「沒檔可下 / 沒下小盤」判讀。**要解 FIT。**

資料來源（都在 repo 裡，不打任何 API）：
  data/plan.json             baseline（FTP 238 / 閾值心率 163 / 體重 80）
  data/drivetrain.json       完整大盤與卡式帶。交叉鏈與「車上最輕檔」一律用它判定
  data/fit/_wellness.json    每日 CTL/ATL/HRV/靜息/睡眠（未來日是 intervals 的推算值，這裡切掉）
  data/fit/_activities.json  intervals.icu 每筆活動摘要（TL / NP / VI / decoupling / EF）
  data/strava.json           recent_rides 的 avg_watts / avg_heartrate / max_heartrate
                             —— _activities.json 沒有這三個欄位，用 (日期, HH:MM) 對起來，
                                103 筆騎乘目前 100% 命中
  data/fit/_scores/*.json    tools/tcx/score.py 的處方對帳結果（逐段處方帶與實際值）
  data/training-block.json   手寫週期計畫（PMC 上的課表點位、前測 / 後測日）
  data/fit/*.fit             逐秒 record 與換檔事件（踏頻分布、齒比停留時間）

⚠️ 三件不要重新推翻的事實
  1. 齒比資料唯一來源是「電子變速 → 私有 ANT → 手錶」，**2026-08-11 起斷線**。
     沒有換檔事件的那幾趟不是「沒換檔」，是手錶根本沒看到電變。這裡直接跳過，不補零。
  2. 判斷「沒檔可下」一定要用**展開（公尺）**跟 data/drivetrain.json 的**完整卡式帶**比，
     不能用「這一趟用過的飛輪」—— 那會把 50×19 誤判成交叉鏈，算出 94% 的假警報。
  3. 未來日的 CTL/ATL 是推算值。pmc.history 只到今天為止。

IF / TSS 一律用 baseline.ftp_w = 238 從 NP 重算（plan.json 明寫「報告裡的 IF/TSS 以
baseline.ftp_w 為準」），跟 _scores/*.json 對得起來；tl 則保留 intervals 自己用
icu_ftp 算的 icu_training_load，兩個數字不是同一件事，畫面上分開放。

實作備註：scripts/itt-gears.py 的檔名有連字號、不能直接 import，所以用 importlib 從路徑載入。
路段視窗定位（build_index / fit_for / load_fit / locate / gear_mix / cad_stats）全部沿用它的，
這裡一行都沒有重寫 —— 定位邏輯只能有一份，兩份一定會漂。
"""
import argparse
import datetime
import glob
import importlib.util
import json
import os
import sys
from bisect import bisect_right
from statistics import median

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TZ = datetime.timezone(datetime.timedelta(hours=8))          # 台北
WHEEL_CIRC_M = 2.105                                         # 700x25c，跟 itt-gears.py 同一個常數
CAD_LOW = 70                                                 # 低踏頻＝高扭力，跟 itt-gears.py 同一條線

# 踏頻直方圖的分箱。兩端各留一個大箱子（0-40 是滑行剛回踩、120+ 是衝刺），
# 中間 5 rpm 一格 —— 爬坡踏頻的問題發生在 55-75 這一帶，格子要細到看得出來。
BIN_EDGES = [0, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100, 105, 110, 120, 999]

J = lambda *p: json.load(open(os.path.join(ROOT, *p), encoding='utf-8'))


def _load_itt_gears():
    """scripts/itt-gears.py 的檔名有連字號，import 不進來，只能用路徑載。"""
    path = os.path.join(ROOT, 'scripts', 'itt-gears.py')
    spec = importlib.util.spec_from_file_location('itt_gears', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


IG = _load_itt_gears()

_QUIET = False


def log(msg):
    if not _QUIET:
        print(msg, flush=True)


def r1(v, nd=1):
    return round(v, nd) if isinstance(v, (int, float)) else None


def ri(v):
    return int(round(v)) if isinstance(v, (int, float)) else None


# ══════════════════════════════════════════════════════════════════════
# FIT 快取 —— 一個檔案只解一次，cadence 與 gears 共用
# ══════════════════════════════════════════════════════════════════════
_FIT_CACHE = {}
_FIT_N = 0


def fit(path):
    global _FIT_N
    if path not in _FIT_CACHE:
        _FIT_N += 1
        log('    [{:>2}] 解 {}'.format(_FIT_N, os.path.basename(path)))
        _FIT_CACHE[path] = IG.load_fit(path)
    return _FIT_CACHE[path]


# effort 的 start_time 只到分鐘，locate() 用「±180 秒內爬升最多」自我校正。elapsed_sec 本身
# 錯掉的時候（Strava 那筆 effort 跟設定檔的路段定義對不起來），校正也救不回來 —— 視窗會歪到
# 把climb 前的平路一起框進去。用「框到的距離 vs 設定檔距離」當守門員：差超過 15% 就整筆丟掉，
# 因為歪掉的視窗算出來的 verdict 是錯的（例：中社 2025-08-19 框到 5.64 km，設定 3.94 km，
# 平均 13 km/h —— 那不是一段 6.3% 的爬坡）。itt-gears.py 印警告但照樣顯示，這裡是餵給圖的資料，
# 寧可少一筆也不要一筆假的。
WIN_TOL = 0.15
_WIN_BAD = []


def win_ok(loc, e):
    cfg = e.get('dist_km')
    if not cfg or not loc['dist']:
        return True
    off = abs(loc['dist'] / 1000 - cfg) / cfg
    if off > WIN_TOL:
        _WIN_BAD.append((e['group'], e['date'], round(loc['dist'] / 1000, 2), cfg, round(off * 100)))
        return False
    return True


# ══════════════════════════════════════════════════════════════════════
# sleep_perf —— 昨晚睡多少 → 今天騎得怎樣
# ══════════════════════════════════════════════════════════════════════
def build_sleep_perf(baseline, wellness, acts, scores_by_date):
    """每趟有功率的騎乘，配對**同一個日期鍵**的 wellness。

    intervals.icu 的 wellness 是以「起床那天」為鍵：2026-08-25 那格寫的是
    sleepSecs 7080（1:58）、sleepScore 28，正是他 8/25 早上起來的那一晚。
    所以同日直接對，不需要往前推一天 —— 這個對齊是用該已知點驗過的，別改成 date-1。
    """
    ftp = baseline['ftp_w']
    # _activities.json 沒有 avg_watts / avg_heartrate / max_heartrate，去 strava.json 補。
    sm = {}
    for x in J('data', 'strava.json').get('recent_rides') or []:
        sm[(x.get('date'), x.get('time'))] = x

    rows, miss_strava = [], 0
    for v in acts.values():
        if 'Ride' not in (v.get('type') or ''):
            continue
        np_w = v.get('icu_weighted_avg_watts')
        sd = v.get('start_date_local') or ''
        s = sm.get((sd[:10], sd[11:16])) or {}
        avg_w = s.get('avg_watts')
        if not np_w and not avg_w:
            continue                                     # 沒功率的騎乘（例如只有心率）不進來
        if not s:
            miss_strava += 1
        date = sd[:10]
        moving = v.get('moving_time') or v.get('elapsed_time') or 0
        # IF/TSS 用 baseline FTP 從 NP 重算；沒 NP 才退回 Strava 自己算的。
        if np_w:
            iff = np_w / ftp
            tss = ri(moving * np_w * iff / (ftp * 3600) * 100)
        else:
            iff = s.get('if_score')
            tss = s.get('tss')
        w = wellness.get(date) or {}
        ctl, atl = w.get('ctl'), w.get('atl')
        sc = scores_by_date.get(date)
        rows.append({
            'date': date,
            'sleep_secs': ri(w.get('sleepSecs')),
            'sleep_score': ri(w.get('sleepScore')),
            'hrv': ri(w.get('hrv')),
            'resting_hr': ri(w.get('restingHR')),
            'ctl': r1(ctl),
            'atl': r1(atl),
            'tsb': r1(ctl - atl) if isinstance(ctl, (int, float)) and isinstance(atl, (int, float)) else None,
            'ride': {
                'name': v.get('name') or '',
                'type': v.get('type') or '',
                'if': r1(iff, 3),
                'tss': ri(tss),
                'vi': r1(v.get('icu_variability_index'), 2),
                'avg_w': r1(avg_w),
                'np_w': r1(np_w),
                'avg_hr': ri(s.get('avg_heartrate')),
                'max_hr': ri(s.get('max_heartrate')),
                'decoupling': r1(v.get('decoupling'), 2),
                'ef': r1(v.get('icu_efficiency_factor'), 3),
                'tl': ri(v.get('icu_training_load')),
                'moving_sec': int(moving),
            },
            'score': ({'total': sc['total']['score'], 'grade': sc['total']['grade']} if sc else None),
        })
    rows.sort(key=lambda r: r['date'])
    if miss_strava:
        log('    ⚠️ {} 趟在 strava.json 找不到對應紀錄，avg_w/avg_hr/max_hr 給 null'.format(miss_strava))
    return rows


# ══════════════════════════════════════════════════════════════════════
# scores —— 主課表的處方對帳
# ══════════════════════════════════════════════════════════════════════
def build_scores(score_files):
    """dimensions 四個維度＋逐段的「處方帶 vs 實際」。

    有些堂數沒有踏頻處方（例如課表 B 全程不指定踏頻），那一堂的 dimensions.cadence 是 null、
    total.weights_used 裡也沒有 cadence 這一格（權重重新分配到另外三個）。
    這裡照抄 weights_used，缺的維度給 null —— 不要自己補 0，0 分跟「沒這個維度」是兩件事。

    逐段：處方帶在 dimensions.compliance.segments[].steadiness.band_w，
    實際值在頂層 segments[].actual，兩邊用 name 對起來（score.py 保證同名唯一）。
    """
    out = []
    for d in score_files:
        dims = d.get('dimensions') or {}
        total = d.get('total') or {}
        comp = {s['name']: s for s in ((dims.get('compliance') or {}).get('segments') or [])}
        segs = []
        for s in d.get('segments') or []:
            a = s.get('actual') or {}
            c = comp.get(s.get('name')) or {}
            st = c.get('steadiness') or {}
            segs.append({
                'name': s.get('name') or '',
                'role': s.get('role') or '',
                'planned_sec': ri(s.get('planned_sec')),
                'actual_sec': ri(s.get('matched_sec')),
                'band': st.get('band_w') or None,
                'avg_w': r1(a.get('avg_w')),
                'avg_hr': ri(a.get('avg_hr')),
                'avg_cad': r1(a.get('avg_cad')),
                'in_band_pct': r1(st.get('in_band_pct')),
                'score': r1(c.get('score')),
            })
        out.append({
            'date': d.get('date'),
            'label': (d.get('plan') or {}).get('label') or '',
            'total': r1(total.get('score')),
            'grade': total.get('grade') or '',
            'dims': {k: (r1((dims.get(k) or {}).get('score')) if isinstance(dims.get(k), dict) else None)
                     for k in ('compliance', 'discipline', 'durability', 'cadence')},
            'weights': total.get('weights_used') or total.get('weights') or {},
            'segments': segs,
        })
    out.sort(key=lambda r: r['date'])
    return out


# ══════════════════════════════════════════════════════════════════════
# cadence —— 逐秒踏頻直方圖
# ══════════════════════════════════════════════════════════════════════
def _cad_hist(points):
    """只累積**移動中**（速度 ≥0.5 m/s）且踏頻 >0 的秒數。

    停紅燈跟滑行不是踩踏行為，混進來會在低踏頻端長出一根假柱子。
    每個取樣點的權重用「到下一點的秒數」（上限 10 秒，避免暫停造成的大洞被算進去）。
    """
    secs = [0.0] * (len(BIN_EDGES) - 1)
    samples = []
    for i, p in enumerate(points):
        if p['spd'] is None or p['spd'] < 0.5 or not p['cad']:
            continue
        dt = min((points[i + 1]['t'] - p['t']).total_seconds(), 10.0) if i + 1 < len(points) else 1.0
        if dt <= 0:
            continue
        c = p['cad']
        b = bisect_right(BIN_EDGES, c) - 1
        b = max(0, min(b, len(secs) - 1))
        secs[b] += dt
        samples.append(c)
    return secs, samples


def build_cadence(idx):
    """overall ＝ 2026 年全部戶外公路車；by_segment ＝ 各路段視窗內的踏頻。

    by_segment 只收**有齒比資料的 effort**（2026-05 → 2026-08-11 那一段電變還連著手錶）。
    這不只是為了跟 gears 對齊：那段期間是同一套器材、同一個訓練階段，
    混進更早的趟數會讓分布同時反映「器材不同」與「體能不同」，看不出東西。
    n_efforts 就是實際疊進去的 effort 數，secs 是它們的總和 —— 跟 overall 的「N 趟」同一種意思。
    """
    # ── overall ──────────────────────────────────────────────────────
    paths = sorted(p for p in glob.glob(os.path.join(ROOT, 'data', 'fit', '2026-*公路車*.fit'))
                   if not any(k in p for k in ('跑步', '肌力', '游泳', '室內', 'ROUVY')))
    log('  overall：2026 年戶外公路車 {} 趟'.format(len(paths)))
    total = [0.0] * (len(BIN_EDGES) - 1)
    for p in paths:
        pts, _, _, _ = fit(p)
        secs, _ = _cad_hist(pts)
        for i, v in enumerate(secs):
            total[i] += v

    # ── by_segment ───────────────────────────────────────────────────
    by_seg = []
    for g in sorted(idx):
        acc = [0.0] * (len(BIN_EDGES) - 1)
        samples, n = [], 0
        name = grade = None
        for e in idx[g]:
            path = IG.fit_for(e['date'])
            if not path:
                continue
            pts, gears, _, _ = fit(path)
            if not gears:
                continue
            loc = IG.locate(pts, e['start'], e['date'], e['elapsed'])
            if loc is None or not win_ok(loc, e):
                continue
            secs, sm = _cad_hist(loc['win'])
            if not sm:
                continue
            for i, v in enumerate(secs):
                acc[i] += v
            samples += sm
            n += 1
            name, grade = e['name'], e['grade']
        if not n:
            continue
        by_seg.append({'key': g, 'name': name, 'grade': grade,
                       'secs': [ri(v) for v in acc],
                       'median': ri(median(samples)), 'n_efforts': n})
    by_seg.sort(key=lambda s: (s['grade'] is None, -(s['grade'] or 0)))
    return {
        'bin_edges': BIN_EDGES,
        'overall': {'secs': [ri(v) for v in total],
                    'label': '全部戶外騎乘 {} 趟'.format(len(paths))},
        'by_segment': by_seg,
    }


# ══════════════════════════════════════════════════════════════════════
# gears —— 這段坡是沒檔可下，還是沒下小盤？
# ══════════════════════════════════════════════════════════════════════
def build_gears(idx, drivetrain):
    """把 itt-gears.py report() 的判讀搬成資料（同樣的門檻、同樣的四種結論）。

    唯一的差別：bike 一律用 data/drivetrain.json 的完整大盤＋卡式帶，
    不用「這一趟看到過的齒」。理由見檔頭第 2 點。
    """
    fronts = sorted(drivetrain['chainrings'])
    rears = sorted(drivetrain['cassette'])
    dev = lambda f, r: f / r * WHEEL_CIRC_M
    bike_min = dev(min(fronts), max(rears))
    big, small = max(fronts), min(fronts)

    out, no_gear = [], []
    for g in sorted(idx):
        for e in idx[g]:
            path = IG.fit_for(e['date'])
            if not path:
                continue
            pts, gears, aux, _ = fit(path)
            if not gears:
                no_gear.append((g, e['date']))
                continue
            loc = IG.locate(pts, e['start'], e['date'], e['elapsed'])
            if loc is None or not win_ok(loc, e):
                continue
            mix = IG.gear_mix(loc['win'], gears)
            if mix is None:
                no_gear.append((g, e['date']))
                continue
            acc, covered = mix['acc'], mix['covered']
            seg_min = min(dev(f, r) for f, r in acc)
            # 「掛在最輕檔」＝展開落在車上最輕檔的 2% 以內（同展開的不同組合算同一檔）
            at_min = [(k, v) for k, v in acc.items() if dev(*k) <= bike_min * 1.02]
            low_pct = sum(v[0] for _, v in at_min) / covered * 100
            cadn = sum(v[3] for _, v in at_min)
            low_cad = (sum(v[1] for _, v in at_min) / cadn) if cadn else None
            # 交叉鏈：大盤配最大兩片、或小盤配最小兩片（data/drivetrain.json 的 _cross_chain_rule）
            xsec = sum(v[0] for (f, r), v in acc.items()
                       if (f == big and r in rears[-2:]) or (f == small and r in rears[:2]))
            if seg_min > bike_min * 1.02:
                verdict = '沒下小盤' if len(fronts) > 1 else '沒用到最輕檔'
            elif low_pct > 45 and low_cad and low_cad < CAD_LOW:
                verdict = '沒檔可下'
            elif low_pct > 45:
                verdict = '接近見底'
            else:
                verdict = '齒比還有餘裕'
            cs = IG.cad_stats(loc['win'])
            out.append({
                'group': g, 'name': e['name'], 'grade': e['grade'], 'date': e['date'],
                'dist_km': r1(loc['dist'] / 1000, 2),
                'low_pct': r1(low_pct), 'low_cad': r1(low_cad),
                'cad_med': (cs['med'] if cs else None),
                'cross_pct': r1(xsec / covered * 100),
                'verdict': verdict,
                'bike_min_dev': r1(bike_min, 2), 'seg_min_dev': r1(seg_min, 2),
                'mix': [{'f': f, 'r': r, 'dev_m': r1(dev(f, r), 2), 'secs': ri(v[0]),
                         'pct': r1(v[0] / covered * 100), 'cad': ri(v[1] / v[3]) if v[3] else None,
                         'w': ri(v[2] / v[4]) if v[4] else None}
                        for (f, r), v in sorted(acc.items(), key=lambda kv: -kv[1][0])],
            })
    out.sort(key=lambda r: (r['group'], r['date']))
    if no_gear:
        log('    沒有齒比資料（電變沒連上手錶）：{} 個 effort，最新 {}'.format(
            len(no_gear), max(d for _, d in no_gear)))
    return out


# ══════════════════════════════════════════════════════════════════════
# pmc —— 體能與疲勞，加上這個區塊的課表點位
# ══════════════════════════════════════════════════════════════════════
def build_pmc(wellness, block, today):
    """未來日的 CTL/ATL 是 intervals 依「今天之後不再訓練」推算的，講「現在」時一定要切掉。"""
    hist = [{'d': d, 'ctl': r1(v.get('ctl')), 'atl': r1(v.get('atl'))}
            for d, v in sorted(wellness.items())
            if d <= today and isinstance(v.get('ctl'), (int, float))]
    cur = next((h for h in reversed(hist) if h['d'] <= today), None)

    sessions, pre_test, post_test = [], None, None
    for s in block.get('sessions') or []:
        t, a = s.get('target') or {}, s.get('actual') or {}
        sessions.append({'date': s.get('date'), 'name': s.get('name') or '',
                         'code': s.get('code') or '', 'support': bool(s.get('support')),
                         'target_tss': ri(t.get('tss')), 'actual_tss': ri(a.get('tss')),
                         'minutes': ri(s.get('minutes'))})
        if a.get('test') is not None and pre_test is None:
            w = wellness.get(s['date']) or {}
            ctl, atl = w.get('ctl'), w.get('atl')
            pre_test = {'date': s['date'],
                        'tsb': r1(ctl - atl) if isinstance(ctl, (int, float))
                        and isinstance(atl, (int, float)) else None}
        if t.get('tss') is not None:
            post_test = s.get('date')
    sessions.sort(key=lambda s: s['date'])
    return {'today': today,
            'ctl': cur['ctl'] if cur else None, 'atl': cur['atl'] if cur else None,
            'history': hist, 'sessions': sessions,
            'pre_test': pre_test, 'post_test_date': post_test}


# ══════════════════════════════════════════════════════════════════════
def main():
    global _QUIET
    ap = argparse.ArgumentParser()
    ap.add_argument('--quiet', action='store_true', help='不印進度')
    ap.add_argument('--out', default=os.path.join('data', 'lab.json'), help='輸出路徑')
    ap.add_argument('--date', default=None, help='把哪一天當成今天（預設：台北時間今天）')
    a = ap.parse_args()
    _QUIET = a.quiet

    today = a.date or datetime.datetime.now(TZ).strftime('%Y-%m-%d')
    plan = J('data', 'plan.json')
    b = plan['baseline']
    baseline = {'ftp_w': b['ftp_w'], 'threshold_hr': b['threshold_hr'],
                'max_hr_observed': b['max_hr_observed'], 'weight_kg': b['weight_kg'],
                'wheel_circ_m': WHEEL_CIRC_M}
    drivetrain = J('data', 'drivetrain.json')
    wellness = J('data', 'fit', '_wellness.json')
    acts = J('data', 'fit', '_activities.json')
    block = J('data', 'training-block.json')
    score_files = [json.load(open(p, encoding='utf-8'))
                   for p in sorted(glob.glob(os.path.join(ROOT, 'data', 'fit', '_scores', '*.json')))]
    score_files = [d for d in score_files if d.get('scored')]
    scores_by_date = {d['date']: d for d in score_files}

    log('=== build-lab ·（以 {} 為今天）==='.format(today))

    log('\n[1/5] sleep_perf')
    sleep_perf = build_sleep_perf(baseline, wellness, acts, scores_by_date)
    log('    {} 筆有功率的騎乘'.format(len(sleep_perf)))

    log('\n[2/5] scores')
    scores = build_scores(score_files)
    log('    {} 堂已對帳'.format(len(scores)))

    # 路段索引：(群組, 日期) -> effort。cadence 與 gears 共用同一份，FIT 只解一次。
    idx = IG.build_index()

    log('\n[3/5] gears（要解 FIT）')
    gears = build_gears(idx, drivetrain)
    log('    {} 個 effort 有齒比資料'.format(len(gears)))

    log('\n[4/5] cadence（要解 FIT）')
    cadence = build_cadence(idx)
    log('    overall {} 個分箱、by_segment {} 個路段'.format(
        len(cadence['overall']['secs']), len(cadence['by_segment'])))

    if _WIN_BAD:
        log('\n    ⚠️ 視窗歪掉、整筆丟掉的 effort（框到的距離 vs 設定檔，差 >{:.0%}）：'.format(WIN_TOL))
        for g, d_, got, want, off in sorted(set(_WIN_BAD)):
            log('       {:<16}{}  {:.2f} km vs {:.2f} km（+{}%）'.format(g, d_, got, want, off))

    log('\n[5/5] pmc')
    pmc = build_pmc(wellness, block, today)
    log('    history {} 天（切掉未來日）、sessions {} 堂'.format(
        len(pmc['history']), len(pmc['sessions'])))

    out = {
        'generated_at': datetime.datetime.now(TZ).isoformat(timespec='seconds'),
        'baseline': baseline,
        'drivetrain': {'chainrings': sorted(drivetrain['chainrings']),
                       'cassette': sorted(drivetrain['cassette'])},
        'sleep_perf': sleep_perf,
        'scores': scores,
        'cadence': cadence,
        'gears': gears,
        'pmc': pmc,
    }
    path = a.out if os.path.isabs(a.out) else os.path.join(ROOT, a.out)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
        f.write('\n')
    log('\n寫出 {}（{:.1f} KB，解了 {} 個 FIT）'.format(
        os.path.relpath(path, ROOT), os.path.getsize(path) / 1024, _FIT_N))


if __name__ == '__main__':
    main()
