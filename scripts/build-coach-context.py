#!/usr/bin/env python3
"""產生 athlete/coach-context.md —— 一份給「任何 AI 教練」讀的單一檔案。

用途：把這個檔（或它的 raw 連結）貼給任何 AI，加一句「我今天有 3 小時，排什麼？」，
它就有足夠的脈絡回答，不用再問二十個問題。

`athlete/gpt_教練前提資訊.txt` 是同一個念頭的手寫版，停在 2026-04 就過期了 ——
那正是這支腳本存在的理由：**數字一律重算，判讀原則才手寫**。

分工用 HTML 註解標記：
    <!-- auto:狀態 -->  … 這中間每次重跑都會被整段換掉 …  <!-- /auto:狀態 -->
標記以外的文字是手寫的，腳本一個字都不會動。第一次執行會寫出完整骨架。

    python3 scripts/build-coach-context.py
    python3 scripts/build-coach-context.py --date 2026-08-21   # 把哪天當今天
"""
import argparse, collections, datetime, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'athlete', 'coach-context.md')
TPE = datetime.timezone(datetime.timedelta(hours=8))
BREAKEVEN, SLOPE = 15.3, 0.64      # 跟 coach-brief.py 同一組常數，見該檔註解


def J(*p, default=None):
    try:
        return json.load(open(os.path.join(ROOT, *p), encoding='utf-8'))
    except Exception:
        return default


def hm(sec):
    sec = int(sec or 0)
    return '%d:%02d' % (sec // 3600, sec % 3600 // 60)


def num(v, f='{:.0f}', dash='—'):
    return f.format(v) if isinstance(v, (int, float)) else dash


# ══ 各區塊 ═══════════════════════════════════════════════════════════
def sec_state(today):
    """現在的狀態。放第一個，因為「今天要練什麼」最先需要的就是這些。"""
    L = []
    base = J('athlete', '基本資料.json', default={}) or {}
    per = base.get('personal', {})
    bm = base.get('body_metrics', {})
    by = per.get('birth_date')
    age = None
    if by:
        b = datetime.date.fromisoformat(by)
        t = datetime.date.fromisoformat(today)
        age = t.year - b.year - ((t.month, t.day) < (b.month, b.day))
    blk = J('data', 'training-block.json', default={}) or {}
    ftp = blk.get('ftp')
    wt = bm.get('latest_weight_kg')
    L.append('| 項目 | 值 | 備註 |')
    L.append('|---|---|---|')
    L.append('| 年齡 / 身高 | %s 歲 / %s cm | |' % (age or '—', per.get('height_cm', '—')))
    L.append('| 體重 | %s kg | 最低 %s kg（%s）· 最高 %s kg |' % (
        num(wt, '{:.1f}'),
        num((bm.get('weight_trend_summary') or {}).get('lowest_weight_kg'), '{:.1f}'),
        (bm.get('weight_trend_summary') or {}).get('lowest_period_start', '—'),
        num((bm.get('weight_trend_summary') or {}).get('highest_weight_kg'), '{:.1f}')))
    if ftp and wt:
        L.append('| FTP | **%s W**（%.2f W/kg） | 錶上設定 234 |' % (ftp, ftp / wt))

    w = J('data', 'fit', '_wellness.json', default={}) or {}
    days = sorted(d for d in w if d <= today)
    if days:
        last = days[-1]
        d0 = w[last]
        ctl, atl = d0.get('ctl'), d0.get('atl')
        tsb = ctl - atl if isinstance(ctl, (int, float)) and isinstance(atl, (int, float)) else None
        L.append('| CTL / ATL / TSB | %s / %s / %s | %s |' % (
            num(ctl, '{:.1f}'), num(atl, '{:.1f}'), num(tsb, '{:+.1f}'), last))
        hrvs = [w[d]['hrv'] for d in days[-7:] if w[d].get('hrv')]
        if hrvs:
            L.append('| HRV | 最新 %s · 7 日均 %.1f | 基線 52–71，**連兩天低於 52 就踩恢復煞車** |'
                     % (num(next((w[d]['hrv'] for d in reversed(days) if w[d].get('hrv')), None)),
                        sum(hrvs) / len(hrvs)))
        sl = [(d, w[d].get('sleepSecs')) for d in days[-3:] if w[d].get('sleepSecs')]
        if sl:
            L.append('| 近三晚睡眠 | %s | |' % ' · '.join('%s %s' % (d[5:], hm(s)) for d, s in sl))
        eftp = None
        for d in reversed(days):
            si = w[d].get('sportInfo')
            r = [x for x in si if x.get('type') == 'Ride' and x.get('eftp')] if isinstance(si, list) else []
            if r:
                eftp = round(r[0]['eftp']); break
        if eftp:
            L.append('| eFTP | %s W | intervals.icu 反推的**估計值**，「最近有沒有全力過」也會推動它 |' % eftp)

    doms = J('data', 'fit', '_doms.json', default={}) or {}
    fwd = sorted(d for d in (doms.get('daily') or {}) if d >= today)[:4]
    if fwd:
        lv = lambda v: '—' if v < 10 else '低' if v < 25 else '中' if v < 45 else '高' if v < 65 else '很高'
        L.append('')
        L.append('**DOMS 預估**（估計值不是量測值，看 am ＝早上七點那個時刻；'
                 '≥65 不要排門檻或高扭力、25–45 目標下修 5 W、<10 沒事）')
        L.append('')
        L.append('| 日期 | 全天 | am | 判讀 | 主因 |')
        L.append('|---|---|---|---|---|')
        for d in fwd:
            v = doms['daily'][d]
            src = ((doms.get('activities') or {}).get(v.get('top')) or {}).get('name') or ''
            L.append('| %s%s | %.0f | %.0f | %s | %s |' % (
                d, '（今天）' if d == today else '', v['all'], v['am'], lv(v['all']), src))
    return '\n'.join(L)


def sec_volume(today):
    rides = (J('data', 'strava.json', default={}) or {}).get('recent_rides') or []
    if not rides:
        return '（沒有騎乘資料）'
    mth = today[:7]
    d0 = datetime.date.fromisoformat(today)
    eom = (d0.replace(day=28) + datetime.timedelta(days=4)).replace(day=1) - datetime.timedelta(days=1)
    got = vh = 0.0
    for r in rides:
        if (r.get('date') or '')[:7] != mth or (r.get('date') or '') > today:
            continue
        h = (r.get('moving_time_sec') or 0) / 3600.0
        got += h
        if r.get('sport_type') == 'VirtualRide' or r.get('trainer') is True:
            vh += h
    gap = BREAKEVEN - got
    pace = got / max(d0.day, 1) * eom.day
    L = ['**月騎乘時數是這半年最重要的單一指標。** 損益線 %.1f h／月：低於它 eFTP 就在掉'
         '（斜率 +%.2f W/h）。' % (BREAKEVEN, SLOPE), '']
    L.append('- %s 已騎 **%.1f h**（室內 %.1f ／ 戶外 %.1f），還剩 %d 天'
             % (mth, got, vh, got - vh, (eom - d0).days))
    L.append('- %s' % ('距損益線還差 **%.1f h**，平均每週要再補 %.1f h'
                       % (gap, gap / max((eom - d0).days / 7.0, 0.3)) if gap > 0
                       else '已過線 **+%.1f h**（約 %+.1f W）' % (-gap, -gap * SLOPE)))
    L.append('- 照目前節奏推估月底 %.1f h（%s）' % (pace, '過線' if pace >= BREAKEVEN else '不足'))
    L.append('')
    L.append('近 6 個月：')
    m = collections.defaultdict(float)
    for r in rides:
        m[(r.get('date') or '')[:7]] += (r.get('moving_time_sec') or 0) / 3600.0
    keys = sorted(k for k in m if k)[-6:]
    L.append('| 月 | %s |' % ' | '.join(keys))
    L.append('|---|%s' % ('---|' * len(keys)))
    L.append('| 時數 | %s |' % ' | '.join('%.1f%s' % (m[k], ' ▲' if m[k] >= BREAKEVEN else '') for k in keys))
    return '\n'.join(L)


def sec_recent(today, days_back=14):
    acts = J('data', 'fit', '_activities.json', default={}) or {}
    since = (datetime.date.fromisoformat(today) - datetime.timedelta(days=days_back)).isoformat()
    doms = J('data', 'fit', '_doms.json', default={}) or {}
    dacts = doms.get('activities') or {}
    ids = {v['start_date_local'] + (v.get('name') or ''): k for k, v in acts.items()}
    rows = sorted((v for v in acts.values() if str(v.get('start_date_local', ''))[:10] >= since),
                  key=lambda v: v['start_date_local'], reverse=True)
    if not rows:
        return '（近 %d 天沒有活動）' % days_back
    L = ['| 日期 | 項目 | 時長 | TL | 強度 | NP | VI | 心率漂移 | DOMS |', '|---|---|---|---|---|---|---|---|---|']
    for v in rows:
        secs = sum(v.get('icu_hr_zone_times') or []) or (v.get('moving_time') or 0)
        aid = ids.get(v['start_date_local'] + (v.get('name') or ''))
        dm = (dacts.get(aid) or {}).get('index')
        dec = v.get('decoupling')
        L.append('| %s | %s | %s 分 | %s | %s%% | %s | %s | %s | %s |' % (
            v['start_date_local'][:10], v.get('type') or '', num(secs / 60),
            num(v.get('icu_training_load')), num(v.get('icu_intensity')),
            num(v.get('icu_weighted_avg_watts')), num(v.get('icu_variability_index'), '{:.2f}'),
            num(dec, '{:+.1f}') + ('%' if dec is not None else ''), num(dm)))
    L.append('')
    L.append('> TL 是跨項目記帳的貨幣（有功率的騎乘走功率算，其餘走心率）。'
             '**同刻度不等於同刺激** —— 心率版看不見短而硬的東西，也不含離心損傷。')
    return '\n'.join(L)


def sec_block(today):
    b = J('data', 'training-block.json', default=None)
    if not b:
        return '（目前沒有進行中的訓練區塊）'
    S = sorted(b.get('sessions', []), key=lambda s: s['date'])
    key = [s for s in S if not s.get('support')]
    done = sum(1 for s in key if s.get('actual') and not s['actual'].get('substituted'))
    L = ['**%s** · %s → %s · FTP %s W · 主課表 %d/%d 完成（另有 %d 堂輔助）'
         % (b.get('title'), b.get('start'), b.get('end'), b.get('ftp'), done, len(key), len(S) - len(key)),
         '', '- **目標**：%s' % b.get('goal', '—'),
         '- **前後測**：%s（%s）' % (b.get('test', {}).get('metric', '—'), b.get('test', {}).get('unit', '')),
         '', b.get('note', ''), '', '### 接下來的課表', '',
         '| 日期 | 週 | 名稱 | 目標 | 處方 |', '|---|---|---|---|---|']
    for s in [x for x in S if x['date'] >= today][:8]:
        t = s.get('target') or {}
        tgt = ('IF %s · TSS %s · VI ≤%s' % (t.get('if', '—'), t.get('tss', '—'), t.get('vi', '—'))
               if t else ('輔助課表' if s.get('support') else '—'))
        plan = re.sub(r'\*\*(.+?)\*\*', r'\1', (s.get('plan') or s.get('metrics') or '')).replace('\n', ' ')
        L.append('| %s | %s | %s | %s | %s |' % (s['date'], s.get('wk', ''), s.get('name', ''), tgt, plan[:170]))
    return '\n'.join(L)


def sec_limits():
    b = J('data', 'training-block.json', default={}) or {}
    tw = b.get('time_windows') or {}
    L = ['### 時間與器材窗口（這是硬性的，排課表一定要先過這一關）', '']
    zh = {'tue': '週二', 'wed': '週三', 'thu': '週四', 'fri_sat': '週五／六',
          'fri_sat_sun_mon': '週五～週一', 'sun_mon': '週日／一',
          'trainer_days': '訓練台', 'run_placement': '跑步擺位', 'revised': '最後修訂'}
    for k, v in tw.items():
        L.append('- **%s**：%s' % (zh.get(k, k), re.sub(r'\*\*(.+?)\*\*', r'\1', str(v))))
    return '\n'.join(L)


def sec_power():
    d = J('data', 'strava.json', default={}) or {}
    prs = d.get('power_prs') or []
    if not prs:
        return '（沒有功率曲線資料）'
    L = ['| 時長 | %s |' % ' | '.join(p['duration_label'] for p in prs),
         '|---|%s' % ('---|' * len(prs)),
         '| 最佳 | %s |' % ' | '.join('%s W' % p['watts'] for p in prs),
         '| 日期 | %s |' % ' | '.join(p['date'][5:] for p in prs), '']
    L.append('> **20 分 → 60 分之間是斷崖**，那才是限制因子。5 分鐘 321 W 是強項，'
             '**不要排 VO2 課表**。')
    return '\n'.join(L)


def sec_climbs():
    pb = J('data', 'playbook.json', default=None)
    if not pb:
        return '（沒有 playbook.json）'
    L = []
    for c in pb.get('climbs', []):
        era = c.get('era') or {}
        pr, nw = era.get('pr'), era.get('now')
        L.append('### %s' % c['name'])
        L.append('')
        L.append('%s m · +%s m · 平均 %s%% ｜ PR **%s**（%s，%s W）→ 最近最好 **%s**（%s）→ 目標 **%s**'
                 % (c.get('dist_m'), c.get('gain_m'), c.get('grade'), c['pr']['t'], c['pr']['date'],
                    c['pr'].get('w'), (c.get('best_now') or {}).get('t', '—'),
                    (c.get('best_now') or {}).get('date', ''), c.get('target')))
        L.append('')
        if pr and nw:
            L.append('| | 時間 | 功率 | 心率 | 踏頻 | 平均齒比 | 最輕檔 | 換檔/分 |')
            L.append('|---|---|---|---|---|---|---|---|')
            for k, lab in (('pr', 'PR 期'), ('now', '最近')):
                v = era[k]
                L.append('| %s（n=%d） | %s | %s W | %s | %s rpm | %s | %s%% | %s |'
                         % (lab, v['n'], v['t'], v['w'], v['hr'], v['cad'], v['ratio'], v['bottom'], v['shift']))
            L.append('')
        L.append('**問題在哪**：%s' % re.sub(r'\s+', ' ', c.get('diag', '')))
        L.append('')
        L.append('**處方**：')
        for r in c.get('rules', []):
            L.append('- **%s** — %s' % (r['k'], r['v']))
        if c.get('abort'):
            L.append('- **中止條件** — %s' % c['abort'])
        L.append('')
    return '\n'.join(L)


def sec_segments():
    """常騎的路段一覽：長度、坡度、PR。AI 要在真實地形上開課表就需要這個。"""
    import math
    ss = J('data', 'segment-streams.json', default={}) or {}
    cfg = {s['id']: s for s in (J('data', 'itt-config.json', default={}) or {}).get('segments', [])}
    segs = J('data', 'itt-segments.json', default=[]) or []
    rows = []
    for s in segs:
        p = ss.get(str(s['id']), {}).get('pts')
        ef = s.get('efforts') or []
        if not p or len(p) < 2 or not ef:
            continue
        R = 6371000.0
        d = 0.0
        for a, b in zip(p, p[1:]):
            la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
            h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
            d += 2 * R * math.asin(math.sqrt(h))
        gain = p[-1][2] - p[0][2]
        if d < 400 or gain < 25:            # 平路引道與短段落不列，會把表洗掉
            continue
        best = min(ef, key=lambda e: e['elapsed_sec'])
        rows.append((-(gain / d), cfg.get(s['id'], {}).get('nameZh') or s['name'],
                     d, gain, gain / d * 100, best['elapsed_str'], best['date'], best.get('avg_watts'), len(ef)))
    rows.sort()
    L = ['| 路段 | 長度 | 爬升 | 平均坡度 | PR | 日期 | 瓦 | 挑戰次數 |', '|---|---|---|---|---|---|---|---|']
    for _, nm, d, g, gr, t, dt, w, n in rows:
        L.append('| %s | %.0f m | +%.0f m | %.1f%% | %s | %s | %s | %d |'
                 % (nm, d, g, gr, t, dt, w or '—', n))
    L.append('')
    L.append('> 坡度取自路段折線的高度，**距離偏短會把百分比灌高**；'
             '要精準請用 FIT 的氣壓高度重算（碧山折線說 9.3%，FIT 說 8.7%）。')
    return '\n'.join(L)


def sec_routes():
    """依**時間預算**分桶列出實際騎過的路線。

    「我今天有 3 小時要騎什麼」這個問題的形狀就是時間 → 路線，所以表按時間分桶，
    不按路線名分組。先前試過依名稱歸類，結果撈出來的是「練後騎」「騎車上班」這種
    通用字，真正的路線（劍中露、劍中中中中劍）因為各只騎過一次反而被濾掉。

    名稱取 Strava 上他自己打的 —— 那才是他腦子裡的路線單位，不是行政區。
    """
    rides = (J('data', 'strava.json', default={}) or {}).get('recent_rides') or []
    out = []
    for r in rides:
        h = (r.get('moving_time_sec') or 0) / 3600.0
        if h < 0.75 or (r.get('sport_type') == 'VirtualRide') or r.get('trainer') is True:
            continue
        nm = re.sub(r'^(Morning|Evening|Afternoon|Night)\s+Ride\s*[-–—]?\s*', '', r.get('name') or '').strip()
        nm = re.sub(r'^(晨間|傍晚|午後|夜間)騎乘\s*[-–—]?\s*', '', nm).strip()
        out.append({'h': h, 'nm': nm or '（未命名）', 'km': r.get('distance_km') or 0,
                    'el': r.get('elevation_m') or 0, 'd': r.get('date') or ''})
    if not out:
        return '（沒有可用的戶外騎乘紀錄）'
    BUCKETS = [(0.75, 1.25, '約 1 小時'), (1.25, 1.75, '約 1.5 小時'),
               (1.75, 2.25, '約 2 小時'), (2.25, 2.75, '約 2.5 小時'), (2.75, 99, '3 小時以上')]
    L = ['| 時間預算 | 實際騎過的（新→舊） | 距離 | 爬升 |', '|---|---|---|---|']
    for lo, hi, lab in BUCKETS:
        g = sorted([x for x in out if lo <= x['h'] < hi], key=lambda x: x['d'], reverse=True)[:3]
        if not g:
            L.append('| **%s** | — | | |' % lab); continue
        for i, x in enumerate(g):
            L.append('| %s | %s（%s · %.1f h） | %.0f km | +%.0f m |' % (
                '**%s**' % lab if i == 0 else '', x['nm'][:24], x['d'][5:], x['h'], x['km'], x['el']))
    L.append('')
    hard = sorted(out, key=lambda x: -(x['el'] / max(x['km'], 1)))[:3]
    L.append('最陡的幾趟（爬升 ÷ 距離）：%s' % '　'.join(
        '%s %.0f m/km' % (x['nm'][:16], x['el'] / max(x['km'], 1)) for x in hard))
    L.append('')
    L.append('> 時長是**移動時間**，不含停等。從公司出發的那種路線中間會有 20 分鐘以上的長休息 ——'
             '2026-08-06 那趟移動 2.4 h，實際佔用 3.3 h。排課表要用**佔用時間**對窗口。')
    return '\n'.join(L)


# ══ 骨架（手寫區塊的預設值，只有檔案不存在時才會用到）═════════════════
SKELETON = """# 教練脈絡 · Steve Chuang

> **這份檔案是給 AI 教練讀的。** 把它（或它的 raw 連結）連同你的問題一起貼給任何 AI，
> 例如「我今天有 3 小時，排什麼菜單？」，它就有足夠脈絡回答，不用再問二十個問題。
>
> 由 `scripts/build-coach-context.py` 產生。`<!-- auto:… -->` 標記中間的內容每次重跑都會
> 被整段換掉；標記以外的文字是手寫的判讀原則，腳本不會動。
>
<!-- auto:stamp -->
<!-- /auto:stamp -->

---

## 0. 先讀這段：怎麼用這份資料

- **強度基準用 FTP，不要用歷史峰值。** 現在的 FTP 寫在下面第 1 節。
- **eFTP 是估計值不是量測值。** intervals.icu 從既有騎乘反推，「最近有沒有全力過」也會推動它 ——
  一趟測試就可能讓它跳 18 W，那不是體能一個月長了 18 W。
- **DOMS 是模型不是量測。** 它會高估（實測主觀 6.5 對模型 12.9），而且看不見重量訓練的實際負重與下坡。
  拿它當「今天適不適合排高扭力」的門檻可以，拿它當事實不行。
- **有處方就用處方對帳，不要用通用啟發式。** 平路課表用 IF < 0.75 判「沒在練」是爬坡指標，
  套到平路會把處方裡寫死的熱身與恢復段判成偷懶。
- **每一堂都要有室內備案**，而且有全力段的日子不准用 ERG（會把全力鎖成固定瓦數，測驗值就沒了）。
- **排任何課表都要先把段落分鐘加總跟窗口對一次。** 2 小時的窗口不要排到 120 分，留 5–15 分。

### 絕不建議的事

- 不要因為某週漏掉就**把量補到下一週** —— 區塊的漸進是算過的，補課會讓後測失真。
- 不要動**後測的日期與協定**，那是整個區塊唯一的產出。
- 不要建議**週三騎車**（腿要留給週四），也不要把連三天改成隔天騎。
- 不要在目前這個區塊排 **VO2 課表** —— 5 分鐘 321 W 已經是強項，不是限制因子。
- 不要用體感或形容詞取代數字；沒有數據支持的建議就說「這需要先量」。

### 回答的形狀

1. **先把實況攤開**（要什麼 vs 現在是什麼），數字帶單位、帶對照組。
2. **再給判讀**，講清楚哪個數字支持哪個結論；不確定就說不確定，不要用語氣填補。
3. **然後給決策，附執行條件而不是固定值** ——
   「騎到第 60 分鐘還穩在 190 W 以上就延長到 85 分」勝過「做 85 分」。
   每一堂都要有**中止條件**。
4. **最後留一個明確要回答的問題**，不要一次丟三個開放題。

該說重話就說（他要的是教練不是啦啦隊），但**先承認做到的部分再講代價**，
而且代價要用數字講，不要用形容詞。

---

## 1. 現在的狀態

<!-- auto:state -->
<!-- /auto:state -->

---

## 2. 月騎乘時數 vs 損益線

<!-- auto:volume -->
<!-- /auto:volume -->

⚠️ **這條線本身有不確定性。** 15.3 h 來自 n=9 的迴歸；用現在的資料重跑，四種算法都落在
**斜率 +0.47～+0.53、損益線 16.4～17.4 h**（r 0.80–0.88）。真門檻可能比 15.3 再高 1～2 小時。
當量級參考用，不要當精確門檻。

---

## 3. 硬性限制

<!-- auto:limits -->
<!-- /auto:limits -->

---

## 4. 近 14 天做了什麼

<!-- auto:recent -->
<!-- /auto:recent -->

---

## 5. 當前訓練區塊

<!-- auto:block -->
<!-- /auto:block -->

---

## 6. 功率曲線

<!-- auto:power -->
<!-- /auto:power -->

### 心率與功率分區

- **單車閾值心率 163**、最大心率設定 188、**實測最大 178**（所以 175 就是 98% 最大，不是「有點喘」）
- 功率區間：Z2 155–180 ｜ Z3 Tempo 180–205 ｜ SST 205–225 ｜ Z4 門檻 225–250 ｜ Z5 265–300
- 心率分區（錶上設定）：132 / 147 / 154 / 164 / 168 / 173 / 182
- **跑步**閾值心率 167、閾值配速 5:03 /km（估算，信心低，只能趨勢判讀）
- **室內心率天生比戶外高 5–10 bpm**，那是熱不是體能，不要據此下修強度

---

## 7. 典型路線（回答「今天有 N 小時要騎什麼」用）

<!-- auto:routes -->
<!-- /auto:routes -->

---

## 8. 常騎的坡

<!-- auto:segments -->
<!-- /auto:segments -->

---

## 9. 破 PR 攻略（逐條坡的診斷與處方）

<!-- auto:climbs -->
<!-- /auto:climbs -->

---

## 10. 已知的限制與踩過的坑

### 20 分 → 60 分的斷崖

20 分 252 W、60 分 190 W。**這個落差才是限制因子**，不是最大攝氧、不是衝刺。
任何課表都應該往「同樣強度撐更久」走，不是往「更高的峰值」走。

### 拿心率配速是錯的（2026 年整年的主要失誤）

2026 年初起改成「抓心率 165 去衝、最後再全開」。結果：中社段內平均心率從 170.5 掉到 163.5，
而閾值心率是 163 —— **165 只比閾值高 2 下，等於把一場 17–20 分鐘的全力測驗降級成閾值課**。

起跑前 90 秒：PR 那趟 311 W、心率才 162；最近那趟 261 W、心率 157。
**心率在爬坡開頭有 60–90 秒延遲** —— 拿它當即時配速工具，開頭必然判斷成「還沒到」。
**有功率計就不要用心率配 20 分鐘以內的測驗。** 心率留給沒有功率計的場合（週末健身房飛輪）。

### 齒比見底

飛輪 11-34、前盤 50/34。最陡的路段已經有 60–90% 的時間掛在 34×34，退無可退。
風櫃嘴上踏頻掉到 67 rpm —— **那是器材結論不是體能結論**，想維持 72+ rpm 要換更大的飛輪。

### 體重跟功率一樣重要

中社慢掉的 13.1% 裡，體重（76.5 → 80 kg）佔 4.6 個百分點、功率佔 4.8 —— **一樣大**。
任何「怎麼變快」的建議都不能只談訓練。

---

## 11. 資料有哪些洞（下結論前先確認）

- **不戴錶的活動在資料裡是 0 筆。** 每週二晚籃球 1 小時、週三晚公司有氧課 ——
  它們不進 CTL、不進 DOMS、不進月時數。講任何負荷結論之前先問「這週有沒有做什麼沒戴錶的」。
- **週末沒有功率計**（社區健身房飛輪），那些課只能用心率控，只算量不算強度刺激。
- **飛輪螢幕的瓦數不要跟曲柄比** —— 有些機種是應變規、有些是查表估的，兩台並排可以差 40 W。
- **室內騎乘一定要用手錶錄。** Rouvy 走 Garmin 或 Strava 都進不了資料管線。
- **Strava 那邊可能有重複紀錄**（同一趟被手錶與 Rouvy 各推一次），月時數會被灌水，
  看到異常高的室內時數要先去對。
- 重量訓練檔案**只有次數沒有重量**（匯出的總重量都是 0），只能當訓練頻率訊號。

---

*本檔由 `python3 scripts/build-coach-context.py` 產生。資料源：`data/fit/_activities.json`、
`_wellness.json`、`_doms.json`、`data/strava.json`、`data/training-block.json`、`data/playbook.json`、
`data/itt-segments.json`、`athlete/基本資料.json`。*
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--date', default=None, help='把哪一天當成今天')
    a = ap.parse_args()
    today = a.date or datetime.datetime.now(TPE).strftime('%Y-%m-%d')

    md = open(OUT, encoding='utf-8').read() if os.path.exists(OUT) else SKELETON
    blocks = {
        'stamp': '> 資料截至 **%s**（台北時間）。過期就重跑產生器。' % today,
        'state': sec_state(today),
        'volume': sec_volume(today),
        'limits': sec_limits(),
        'recent': sec_recent(today),
        'block': sec_block(today),
        'power': sec_power(),
        'segments': sec_segments(),
        'routes': sec_routes(),
        'climbs': sec_climbs(),
    }
    missing = []
    for k, v in blocks.items():
        pat = re.compile(r'(<!-- auto:%s -->)(.*?)(<!-- /auto:%s -->)' % (k, k), re.S)
        if not pat.search(md):
            missing.append(k); continue
        md = pat.sub(lambda m: m.group(1) + '\n' + v + '\n' + m.group(3), md)
    if missing:
        print('⚠️ 找不到標記，這幾段沒更新：%s' % '、'.join(missing), file=sys.stderr)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, 'w', encoding='utf-8').write(md)
    print('寫出 %s（%d bytes、%d 行）' % (
        os.path.relpath(OUT, ROOT), len(md.encode('utf-8')), md.count('\n') + 1))


if __name__ == '__main__':
    main()
