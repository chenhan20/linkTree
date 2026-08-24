#!/usr/bin/env python3
"""ITT 路段的齒比分析 —— 「這段爬坡我是沒檔可下，還是踩得好好的？」

    python3 scripts/itt-gears.py                      # 最近一趟有齒比資料的中社
    python3 scripts/itt-gears.py --date 2026-08-06    # 指定那天的中社
    python3 scripts/itt-gears.py --seg fongguizui     # 換一個路段（群組代號）
    python3 scripts/itt-gears.py --seg all --history  # 全部路段的歷史對照表
    python3 scripts/itt-gears.py --list               # 有哪些路段/哪些日子可以看

為什麼要有這支：`tools/tcx/analyze_tcx.py` 的 _gear_report() 算的是**整趟**，
一趟裡混了平路、下坡、四段不同坡度的爬坡，平均起來看不出任何東西。
真正要問的是「在這一段特定的坡上，我待在哪一檔」。

資料來源（都在 repo 裡，不打 API）：
  data/fit/*.fit           換檔事件（event.front_gear/rear_gear）＋ 逐秒 record
  data/itt-segments.json   每個 effort 的 start_time 與 elapsed_sec（框出路段的時間視窗）
  data/itt-config.json     路段的群組、名稱、平均坡度

⚠️ 齒比資料唯一來源是「電子變速 → 私有 ANT → 手錶」。沒配對的那幾趟 FIT 裡一個字都沒有
   （2026-08-11 起就是這樣）。這支腳本會明講「沒資料」跟原因，不會靜默給你一張空表。
"""
import json, os, sys, argparse, datetime
from datetime import timezone, timedelta
from bisect import bisect_left, bisect_right

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TZ = timezone(timedelta(hours=8))          # 台北
WHEEL_CIRC_M = 2.105                       # 700x25c，跟 analyze_tcx.py 同一個常數
J = lambda *p: json.load(open(os.path.join(ROOT, *p), encoding='utf-8'))

# 踏頻判讀門檻。低踏頻＝高扭力＝走肌肉端，不是有氧端。
CAD_LOW = 70
CAD_VERY_LOW = 60


def load_fit(path):
    """回傳 (逐秒點, 換檔狀態, 有沒有看到電變副電池)。

    換檔事件每一筆都帶齊前後齒數，所以單一事件就是完整狀態，不必累積推算。
    """
    import fitdecode
    pts, gears, aux = [], [], 0
    with fitdecode.FitReader(path) as fr:
        for m in fr:
            if not isinstance(m, fitdecode.FitDataMessage):
                continue
            if m.name == 'record':
                d = {f.name: f.value for f in m.fields}
                if d.get('timestamp') is None:
                    continue
                pts.append(dict(t=d['timestamp'], dist=d.get('distance'),
                                alt=d.get('enhanced_altitude'), spd=d.get('enhanced_speed'),
                                cad=d.get('cadence'), w=d.get('power'), hr=d.get('heart_rate')))
            elif m.name == 'event':
                d = {f.name: f.value for f in m.fields}
                if 'gear' not in str(d.get('event')):
                    continue
                f_, r_ = d.get('front_gear'), d.get('rear_gear')
                if f_ and r_:                       # front_gear=0 是無效值，丟掉
                    ts = d['timestamp']
                    if ts.tzinfo is None:
                        ts = ts.replace(tzinfo=timezone.utc)
                    gears.append((ts, int(f_), int(r_)))
            elif m.name == 'device_aux_battery_info':
                aux += 1
    pts.sort(key=lambda p: p['t'])
    gears.sort()
    # 整趟看到的齒數 ＝ 這台車實際可用的範圍。判斷「沒檔可下」一定要跟這個比，
    # 不能只看某一段裡用到的最大飛輪 —— 掛在大盤沒下小盤，也會讓那段的「最輕檔」看起來很輕。
    bike = dict(fronts=sorted({f for _, f, _ in gears}), rears=sorted({r for _, _, r in gears}))
    return pts, gears, aux, bike


def locate(pts, start_hhmm, date_str, elapsed):
    """用 effort 的 start_time（只到分鐘）框出視窗，再用爬升自我校正。

    start_time 只有 HH:MM，±60 秒的不確定性對一段 20 分鐘的爬坡會歪掉，
    所以在 ±180 秒裡找「爬升最多」的那個對齊 —— 爬坡段的爬升是單調的，
    對錯位置一定會少算。回傳的 dist/grade 要拿去跟設定檔對帳確認框對了。
    """
    h, m = (int(x) for x in start_hhmm.split(':'))
    y, mo, d = (int(x) for x in date_str.split('-'))
    t0 = datetime.datetime(y, mo, d, h, m, tzinfo=TZ).astimezone(timezone.utc)
    ts = [p['t'] for p in pts]
    best = None
    for off in range(-180, 181, 5):
        a = t0 + timedelta(seconds=off)
        W = pts[bisect_left(ts, a):bisect_left(ts, a + timedelta(seconds=elapsed))]
        if len(W) < 30:
            continue
        gain = sum(max(0.0, W[k + 1]['alt'] - W[k]['alt']) for k in range(len(W) - 1)
                   if W[k]['alt'] is not None and W[k + 1]['alt'] is not None)
        if best is None or gain > best[1]:
            best = (off, gain, W)
    if best is None:
        return None
    off, gain, W = best
    dist = (W[-1]['dist'] - W[0]['dist']) if W[0]['dist'] and W[-1]['dist'] else 0.0
    return dict(win=W, offset=off, gain=gain, dist=dist,
                grade=(gain / dist * 100) if dist else 0.0)


def gear_mix(W, gears):
    """路段視窗內的「待在各檔的時間」。

    FIT 只在換檔瞬間寫事件，中間沉默 —— 必須把狀態往後填到下一次換檔，
    再用逐點時間累積。數事件次數會嚴重低估爬坡檔（切一次就待很久）。
    只累積移動中的點：停紅燈掛在哪一檔不是踩踏行為。
    """
    if not gears:
        return None
    gts = [g[0] for g in gears]
    acc, covered, moving = {}, 0.0, 0.0
    for i, p in enumerate(W):
        if p['spd'] is None or p['spd'] < 0.5:
            continue
        dt = min((W[i + 1]['t'] - p['t']).total_seconds(), 10.0) if i + 1 < len(W) else 1.0
        if dt <= 0:
            continue
        moving += dt
        j = bisect_right(gts, p['t']) - 1
        if j < 0:                                   # 第一次換檔之前無從得知掛哪一檔
            continue
        covered += dt
        _, f_, r_ = gears[j]
        a = acc.setdefault((f_, r_), [0.0, 0.0, 0.0, 0.0, 0.0, []])
        a[0] += dt
        if p['cad']:
            a[1] += p['cad'] * dt; a[3] += dt; a[5].append(p['cad'])
        if p['w']:
            a[2] += p['w'] * dt;  a[4] += dt
    if not acc or covered <= 0:
        return None
    return dict(acc=acc, covered=covered, moving=moving)


def cad_stats(W):
    c = sorted(p['cad'] for p in W if p['cad'] and p['spd'] and p['spd'] >= 0.5)
    if not c:
        return None
    return dict(med=c[len(c) // 2], avg=sum(c) / len(c),
                lo=sum(1 for x in c if x < CAD_LOW) / len(c) * 100,
                vlo=sum(1 for x in c if x < CAD_VERY_LOW) / len(c) * 100)


def report(name, date, loc, mix, cfg_grade, cfg_dist_km, tgt_w, bike):
    W = loc['win']
    print('\n' + '=' * 74)
    print('{} · {}'.format(name, date))
    print('=' * 74)
    ok_d = abs(loc['dist'] / 1000 - cfg_dist_km) < 0.25 if cfg_dist_km else None
    print(' 視窗  {} → {}  ({:.0f} 秒, 對齊偏移 {:+d}s)'.format(
        W[0]['t'].astimezone(TZ).strftime('%H:%M:%S'),
        W[-1]['t'].astimezone(TZ).strftime('%H:%M:%S'),
        (W[-1]['t'] - W[0]['t']).total_seconds(), loc['offset']))
    print(' 對帳  距離 {:.2f} km（設定 {}）· 爬升 {:.0f} m · 坡度 {:.1f}%（設定 {}%）{}'.format(
        loc['dist'] / 1000, cfg_dist_km if cfg_dist_km else '—',
        loc['gain'], loc['grade'], cfg_grade if cfg_grade else '—',
        '' if ok_d is None else ('  [框對了]' if ok_d else '  [!! 距離對不上,視窗可能歪了]')))
    cs = cad_stats(W)
    ws = [p['w'] for p in W if p['w']]
    if ws:
        print(' 功率  平均 {:.0f} W{}'.format(
            sum(ws) / len(ws), '（Strava {} W）'.format(tgt_w) if tgt_w else ''))
    if cs:
        print(' 踏頻  中位 {} · 平均 {:.0f} · <{} rpm 佔 {:.0f}% · <{} rpm 佔 {:.0f}%'.format(
            cs['med'], cs['avg'], CAD_LOW, cs['lo'], CAD_VERY_LOW, cs['vlo']))

    if mix is None:
        print('\n ⚠️ 這一趟沒有齒比資料。')
        print('    換檔事件與 device_aux_battery_info 一起消失 ＝ 手錶根本沒看到電子變速，')
        print('    不是看到了但沒記，也不是沒電。Di2 走的是私有 ANT 通道、只在撥動變速時廣播，')
        print('    要重新配對得先撥一下變速把它叫醒。')
        return None

    acc, covered = mix['acc'], mix['covered']
    print('\n 齒比分布（移動中 {:.0f} 秒，其中 {:.0f} 秒有檔位狀態）'.format(mix['moving'], covered))
    print(' {:<8} {:>6} {:>7} {:>6} {:>6} {:>7}'.format('齒比', '秒', '佔比', '踏頻', '瓦', '展開m'))
    for (f_, r_), v in sorted(acc.items(), key=lambda kv: -kv[1][0]):
        print(' {:<8} {:>6.0f} {:>6.1f}% {:>6} {:>6} {:>7.2f}'.format(
            '{}x{}'.format(f_, r_), v[0], v[0] / covered * 100,
            round(v[1] / v[3]) if v[3] else '—', round(v[2] / v[4]) if v[4] else '—',
            f_ / r_ * WHEEL_CIRC_M))

    dev = lambda f, r: f / r * WHEEL_CIRC_M
    # 這台車最輕的檔（整趟看到的最小前盤配最大飛輪）。沒檔可下要跟它比，不是跟本段用到的最大飛輪比。
    bike_min = dev(min(bike['fronts']), max(bike['rears'])) if bike['fronts'] and bike['rears'] else None
    seg_min = min(dev(f, r) for f, r in acc)
    # 「掛在最輕檔」＝展開落在車上最輕檔的 2% 以內（同展開的不同組合算同一檔）
    at_min = [(k, v) for k, v in acc.items() if bike_min and dev(*k) <= bike_min * 1.02]
    minsec = sum(v[0] for _, v in at_min)
    lowpct = minsec / covered * 100
    cadn = sum(v[3] for _, v in at_min)
    lowcad = (sum(v[1] for _, v in at_min) / cadn) if cadn else None
    # 交叉鏈：大盤配最大的兩片飛輪。傳動效率差、鏈條磨損快，而且通常代表「該下小盤沒下」。
    big = max(bike['fronts']) if bike['fronts'] else None
    xsec = sum(v[0] for (f, r), v in acc.items()
               if big and f == big and r in sorted(bike['rears'])[-2:])
    xpct = xsec / covered * 100

    print('\n 判讀')
    print('  車上最輕檔 {}x{}（展開 {:.2f} m）· 本段用到最輕 {:.2f} m'.format(
        min(bike['fronts']), max(bike['rears']), bike_min, seg_min))
    if bike_min and seg_min > bike_min * 1.02:
        print('  ⚠️ **整段沒下到最輕檔** —— 還有更輕的檔沒用到（差 {:.0f}%）。'.format(
            (seg_min / bike_min - 1) * 100))
        verdict = '沒下小盤' if len(bike['fronts']) > 1 else '沒用到最輕檔'
    else:
        print('  掛在最輕檔 {:.1f}%{}'.format(
            lowpct, '  踏頻 {:.0f} rpm'.format(lowcad) if lowcad else ''))
        # 第二輕的檔踏頻反而更高 ＝ 低踏頻只出現在沒檔可下的時候 ＝ 齒比問題不是踩踏習慣
        # 次輕 ＝ 排除最輕檔之後展開最小的那一檔（不是最重的那一檔）
        others = sorted(((dev(f, r), v) for (f, r), v in acc.items()
                         if not (bike_min and dev(f, r) <= bike_min * 1.02)), key=lambda x: x[0])
        seccad = next((v[1] / v[3] for _, v in others if v[3]), None)
        # 這個判讀只在最輕檔本身踏頻就偏低時才成立。踏頻 84 的時候比高低沒有意義 ——
        # 「沒檔可下」講的是被迫用高扭力低轉，不是單純哪一檔轉速快一點。
        if seccad and lowcad and lowcad < CAD_LOW:
            print('  次輕的檔踏頻 {:.0f} rpm'.format(seccad))
            if seccad > lowcad + 2:
                print('  → 次輕的檔踏頻反而**更高** ＝ 低踏頻只在沒檔可下時出現。**齒比問題，不是踩踏習慣**。')
            else:
                print('  → 次輕的檔踏頻沒有更高 ＝ 這段的低踏頻不是被齒比逼出來的。')
        elif lowcad:
            print('  最輕檔踏頻 {:.0f} rpm ≥ {} ＝ 雖然常掛最輕檔，但還轉得動，不是被扭力卡住。'.format(
                lowcad, CAD_LOW))
        verdict = ('沒檔可下' if (lowpct > 45 and lowcad and lowcad < CAD_LOW)
                   else ('接近見底' if lowpct > 45 else '齒比還有餘裕'))
    if xpct > 5:
        print('  交叉鏈（大盤配最大兩片）佔 {:.1f}%'.format(xpct))
    print('  結論：{}（最輕檔 {:.0f}%、踏頻 {}）'.format(
        verdict, lowpct, '{:.0f}'.format(lowcad) if lowcad else '—'))
    if verdict == '沒檔可下':
        spd = loc['dist'] / (W[-1]['t'] - W[0]['t']).total_seconds() * 3.6
        for rpm in (75, 80, 85):
            need = min(bike['fronts']) * (rpm * WHEEL_CIRC_M * 60 / 1000) / spd
            print('    要在 {:.1f} km/h 踩到 {} rpm，需要 {:.0f}T 飛輪'.format(spd, rpm, need))
    return dict(lowpct=lowpct, lowcad=lowcad, verdict=verdict, xpct=xpct,
                cad_med=cs['med'] if cs else None)


def build_index():
    """(群組, 日期) -> effort。只取『全段』，避免母子路段重複計算。"""
    cfg = {v['id']: v for v in J('data', 'itt-config.json')['segments'] if v.get('id')}
    idx = {}
    for s in J('data', 'itt-segments.json'):
        c = cfg.get(s.get('id'))
        if not c or c.get('label') != '全段':
            continue
        for e in s.get('efforts', []):
            if not e.get('start_time'):
                continue
            idx.setdefault(c['group'], []).append(dict(
                date=e['date'], start=e['start_time'], elapsed=e['elapsed_sec'],
                w=e.get('avg_watts'), name=c.get('nameZh'), grade=c.get('avgGrade'),
                dist_km=s.get('distance_km'), group=c['group']))
    for g in idx:
        idx[g].sort(key=lambda x: (x['date'], x['start']))
    return idx


def fit_for(date):
    import glob
    c = [p for p in glob.glob(os.path.join(ROOT, 'data', 'fit', date + '_*.fit'))
         if not any(k in p for k in ('跑步', '肌力', '游泳', '室內', 'ROUVY'))]
    return c[0] if c else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--seg', default='zhongshe',
                    help='路段群組代號，可用逗號分隔多個，或 all（預設 zhongshe＝中社路）')
    ap.add_argument('--date', default=None, help='只看這一天（預設：最近一趟有齒比資料的）')
    ap.add_argument('--history', action='store_true', help='印歷史對照表')
    ap.add_argument('--list', action='store_true', help='列出可分析的路段與日期')
    a = ap.parse_args()

    idx = build_index()
    if a.list:
        print('可分析的路段（有 start_time 的 effort，且該日有戶外 FIT）：\n')
        print(' {:<16} {:<18} {:>5}  {}'.format('群組代號', '名稱', '坡度', '日期'))
        for g, E in sorted(idx.items()):
            ds = [e['date'] for e in E if fit_for(e['date'])]
            if not ds:
                continue
            print(' {:<16} {:<18} {:>5}  {}'.format(
                g, E[0]['name'], E[0]['grade'] or '—', ' '.join(sorted(set(ds)))))
        return

    groups = sorted(idx) if a.seg == 'all' else [g.strip() for g in a.seg.split(',') if g.strip()]
    bad = [g for g in groups if g not in idx]
    if bad:
        print('沒有這些群組：{}\n用 --list 看有哪些。'.format(', '.join(bad))); sys.exit(1)

    rows = []
    for g in groups:
        E = [e for e in idx[g] if fit_for(e['date'])]
        if a.date:
            E = [e for e in E if e['date'] == a.date]
        if not a.history and not a.date:
            E = E[-1:]                                    # 每個路段各取最近一趟
        if not E:
            continue
        cache = {}
        for e in E:
            path = fit_for(e['date'])
            if path not in cache:
                cache[path] = load_fit(path)
            pts, gears, aux, bike = cache[path]
            loc = locate(pts, e['start'], e['date'], e['elapsed'])
            if loc is None:
                print('{} {} 找不到對應的視窗（FIT 太短？）'.format(e['date'], e['name'])); continue
            mix = gear_mix(loc['win'], gears)
            r = report(e['name'], e['date'], loc, mix, e['grade'], e['dist_km'], e['w'], bike)
            if r:
                rows.append(dict(g=g, name=e['name'], date=e['date'], grade=e['grade'], **r))

    if len(rows) > 1:
        print('\n' + '=' * 74)
        print('對照表 —— 坡度越陡，最輕檔佔比越高、踏頻越低，就是齒比在限制你')
        print('=' * 74)
        print(' {:<15} {:<11} {:>5} {:>7} {:>7} {:>6} {:>6}  {}'.format(
            '路段', '日期', '坡度', '最輕檔%', '該檔踏頻', '段中位', '交叉鏈', '結論'))
        for r in sorted(rows, key=lambda x: (x['grade'] or 0, x['date'])):
            print(' {:<15} {:<11} {:>4}% {:>6.0f}% {:>7} {:>6} {:>5.0f}%  {}'.format(
                r['name'][:15], r['date'], r['grade'] or '—', r['lowpct'],
                '{:.0f}'.format(r['lowcad']) if r['lowcad'] else '—',
                r['cad_med'] or '—', r['xpct'], r['verdict']))


if __name__ == '__main__':
    main()
