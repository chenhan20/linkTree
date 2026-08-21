#!/usr/bin/env python3
"""破 PR 攻略：把 data/playbook.json 裡「算得出來」的欄位重新算一次。

分工很清楚：
  手寫（這支腳本一個字都不會動）—— name / target / diag / rules / abort / articles 的文字
  計算（每次重跑都覆蓋）        —— pr / best_now / era / splits / trace

所以改完文字直接存檔，資料更新就重跑這支，兩邊不會互相踩。

    python3 scripts/build-playbook.py            # 就地更新 data/playbook.json
    python3 scripts/build-playbook.py --check    # 只印差異不寫檔

資料源全部在 repo 內，不打任何 API：
  data/itt-segments.json     每一段的所有 effort（FIT 自建偵測器 + Strava）
  data/segment-streams.json  每一段的折線與高度，用來把 FIT 切出段內視窗
  data/fit/*.fit             電子變速的換檔事件、逐點功率／心率／踏頻
"""
import argparse, collections, glob, json, math, os, statistics as st, sys
from bisect import bisect_right
from datetime import timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
J = lambda *p: json.load(open(os.path.join(ROOT, *p), encoding='utf-8'))
WHEEL = 2.105                      # m，700x25c
GPS_TOL_M = 25                     # 段頭尾的 GPS 容忍半徑
TIME_TOL = 0.35                    # 切出來的秒數與記錄成績的容許誤差


def hav(a, b, c, d):
    R = 6371000.0
    p1, p2 = math.radians(a), math.radians(c)
    dp, dl = math.radians(c - a), math.radians(d - b)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def read_fit(path):
    """只取需要的兩種 frame：record（逐點）與 gear_change 事件。"""
    import fitdecode
    pts, evs = [], []
    with fitdecode.FitReader(path) as fr:
        for f in fr:
            if f.frame_type != fitdecode.FIT_FRAME_DATA:
                continue
            if f.name == 'record':
                d = {x.name: x.value for x in f.fields}
                la, lo = d.get('position_lat'), d.get('position_long')
                if la is None or lo is None:
                    continue
                sc = 180.0 / 2 ** 31
                t = d.get('timestamp')
                if t is not None and t.tzinfo is None:
                    t = t.replace(tzinfo=timezone.utc)
                pts.append({'t': t, 'la': la * sc, 'lo': lo * sc,
                            'spd': d.get('enhanced_speed') or d.get('speed'),
                            'cad': d.get('cadence'), 'w': d.get('power'),
                            'hr': d.get('heart_rate'),
                            'alt': d.get('enhanced_altitude') or d.get('altitude')})
            elif f.name == 'event':
                d = {x.name: x.value for x in f.fields}
                if 'gear_change' not in str(d.get('event') or ''):
                    continue
                if not d.get('front_gear') or not d.get('rear_gear'):
                    continue
                t = d['timestamp']
                if t.tzinfo is None:
                    t = t.replace(tzinfo=timezone.utc)
                evs.append((t, int(d['front_gear']), int(d['rear_gear'])))
    evs.sort(key=lambda x: x[0])
    return pts, evs


def window(pts, s0, s1, want):
    """段內視窗：離段頭最近 → 離段尾最近，且秒數對得上記錄成績的那一段。

    只靠 GPS 會在來回經過同一點時抓錯（劍中劍那種來回路線），所以一定要用
    記錄成績當第二個條件。
    """
    best = None
    for i, p in enumerate(pts):
        if hav(p['la'], p['lo'], s0[0], s0[1]) > GPS_TOL_M:
            continue
        for j in range(i + 1, len(pts)):
            if hav(pts[j]['la'], pts[j]['lo'], s1[0], s1[1]) > GPS_TOL_M:
                continue
            sec = (pts[j]['t'] - p['t']).total_seconds()
            if sec <= 0:
                break
            err = abs(sec - want) / want
            if err <= TIME_TOL and (best is None or err < best[0]):
                best = (err, i, j)
            break
    return best


def gears_in(pts, evs, i, j):
    """段內的齒比分布。

    FIT 只在換檔那一瞬間寫事件，中間是沉默的 —— 狀態要往後填到下一次換檔，
    再用逐點時間累積。直接數事件次數只會告訴你哪一檔最常被切進去，
    不是哪一檔騎最久（爬坡檔切進去就待很久，兩者差很多）。
    """
    stimes = [e[0] for e in evs]
    acc = collections.defaultdict(float)
    cads, ws, hrs = [], [], []
    nsh, last = 0, None
    for k in range(i, j):
        p, nx = pts[k], pts[k + 1]
        dt = min((nx['t'] - p['t']).total_seconds(), 10.0)
        if dt <= 0:
            continue
        if p.get('cad') and p['cad'] > 30:
            cads.append(p['cad'])
        if p.get('w'):
            ws.append(p['w'])
        if p.get('hr'):
            hrs.append(p['hr'])
        g = bisect_right(stimes, p['t']) - 1
        if g < 0:
            continue
        acc[(evs[g][1], evs[g][2])] += dt
        if last is not None and g != last:
            nsh += 1
        last = g
    tot = sum(acc.values())
    if not tot:
        return None
    rmax = max(e[2] for e in evs)                     # 整趟看到的最大片＝最輕
    mins = (pts[j]['t'] - pts[i]['t']).total_seconds() / 60
    return {
        'ratio': round(sum(f / r * s for (f, r), s in acc.items()) / tot, 3),
        'bottom': round(sum(s for (f, r), s in acc.items() if r == rmax) / tot * 100),
        'cad': round(st.mean(cads)) if cads else None,
        'w': round(st.mean(ws)) if ws else None,
        'hr': round(st.mean(hrs)) if hrs else None,
        'shift': round(nsh / mins, 1) if mins else None,
    }


def fmt(sec):
    sec = round(sec)
    return '%d:%02d' % (sec // 60, sec % 60)


def load_geo(streams, sid):
    pts = streams[str(sid)]['pts']
    d = [0.0]
    for a, b in zip(pts, pts[1:]):
        d.append(d[-1] + hav(a[0], a[1], b[0], b[1]))
    return pts, d


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true', help='只印差異，不寫檔')
    a = ap.parse_args()

    pb = J('data', 'playbook.json')
    streams = J('data', 'segment-streams.json')
    segs = {s['id']: s for s in J('data', 'itt-segments.json')}

    for climb in pb['climbs']:
        sid = climb['id']
        ef = segs[sid]['efforts']
        per_day = collections.Counter(e['date'] for e in ef)
        wmin = climb.get('_min_watts', 220)
        since = climb.get('_since', '2025-08-20')
        # 只取單日單趟：同一天刷四次會把「當天最好那趟」跟熱身趟混在一起
        pool = [e for e in ef if per_day[e['date']] == 1 and e['date'] >= since
                and (e.get('avg_watts') or 0) >= wmin]

        best = min(ef, key=lambda e: e['elapsed_sec'])
        climb['pr'] = {'t': best['elapsed_str'], 'date': best['date'],
                       'w': best.get('avg_watts'), 'hr': best.get('avg_heartrate')}
        recent = [e for e in pool if e['date'] >= climb['_now_from']]
        if recent:
            bn = min(recent, key=lambda e: e['elapsed_sec'])
            climb['best_now'] = {'t': bn['elapsed_str'], 'date': bn['date'],
                                 'w': bn.get('avg_watts'), 'hr': bn.get('avg_heartrate')}

        geo, dist = load_geo(streams, sid)
        climb['dist_m'] = round(dist[-1])
        climb['gain_m'] = round(geo[-1][2] - geo[0][2])
        climb['grade'] = round((geo[-1][2] - geo[0][2]) / dist[-1] * 100, 1)

        # ── 兩個時期的段內彙總 ──
        era = {'pr': [], 'now': []}
        for e in pool:
            k = 'pr' if e['date'] < climb['_now_from'] else 'now'
            for fp in sorted(glob.glob(os.path.join(ROOT, 'data', 'fit', e['date'] + '_*.fit'))):
                try:
                    pts, evs = read_fit(fp)
                except Exception:
                    continue
                if not pts or not evs:
                    continue
                w = window(pts, (geo[0][0], geo[0][1]), (geo[-1][0], geo[-1][1]), e['elapsed_sec'])
                if not w:
                    continue
                g = gears_in(pts, evs, w[1], w[2])
                if g:
                    era[k].append({**g, 'sec': e['elapsed_sec']})
                break
        out = {}
        for k, v in era.items():
            if not v:
                continue
            avg = lambda f: round(st.mean([x[f] for x in v if x[f] is not None]), 2)
            out[k] = {'n': len(v), 't': fmt(st.mean([x['sec'] for x in v])),
                      'w': round(avg('w')), 'hr': round(avg('hr'), 1), 'cad': round(avg('cad')),
                      'ratio': round(avg('ratio'), 2), 'bottom': round(avg('bottom')),
                      'shift': round(avg('shift'), 1)}
        climb['era'] = out

        # ── 逐段（子路段）對帳：只在子路段互不重疊時才有意義 ──
        subs = climb.get('_subs') or []
        if subs:
            rows = []
            for q in subs:
                qe = {e['date']: e for e in segs[q]['efforts']}
                pr_t = [qe[e['date']]['elapsed_sec'] for e in pool
                        if e['date'] < climb['_now_from'] and e['date'] in qe]
                nw_t = [qe[e['date']]['elapsed_sec'] for e in pool
                        if e['date'] >= climb['_now_from'] and e['date'] in qe]
                if not pr_t or not nw_t:
                    continue
                sgeo, sd = load_geo(streams, q)
                rows.append({'id': q, 'l': climb['_sub_labels'].get(str(q), str(q)),
                             'd': round(sd[-1]),
                             'grade': round((sgeo[-1][2] - sgeo[0][2]) / sd[-1] * 100, 1),
                             'prT': fmt(st.mean(pr_t)), 'nowT': fmt(st.mean(nw_t)),
                             'gap': round(st.mean(nw_t) - st.mean(pr_t))})
            climb['splits'] = rows

        # ── 兩趟參考騎乘的換檔軌跡 ──
        tr = {'total': climb['dist_m'],
              'prof': [[round(x), round(p[2], 1)] for i, (x, p) in enumerate(zip(dist, geo))
                       if i % max(1, len(geo) // 80) == 0 or i == len(geo) - 1],
              'bounds': [], 'rides': []}
        for q in subs:
            sgeo, _ = load_geo(streams, q)
            b = min(range(len(geo)), key=lambda i: hav(geo[i][0], geo[i][1], sgeo[-1][0], sgeo[-1][1]))
            tr['bounds'].append(round(dist[b]))
        # 子路段可能互相重疊（風櫃嘴的萬溪陡段涵蓋整個上半段），去重排序後
        # 才是可以畫在同一根軸上的界線；等於總長的那一條是段尾，不用畫
        tr['bounds'] = sorted({b for b in tr['bounds'] if 0 < b < tr['total'] - 30})
        for ref in climb['_refs']:
            e = next((x for x in ef if x['date'] == ref['date']), None)
            if not e:
                continue
            for fp in sorted(glob.glob(os.path.join(ROOT, 'data', 'fit', ref['date'] + '_*.fit'))):
                try:
                    pts, evs = read_fit(fp)
                except Exception:
                    continue
                if not pts or not evs:
                    continue
                w = window(pts, (geo[0][0], geo[0][1]), (geo[-1][0], geo[-1][1]), e['elapsed_sec'])
                if not w:
                    continue
                i, j = w[1], w[2]
                stimes = [x[0] for x in evs]
                run, prev, steps, last = 0.0, None, [], None
                for k in range(i, j + 1):
                    p = pts[k]
                    if prev is not None:
                        run += hav(prev['la'], prev['lo'], p['la'], p['lo'])
                    prev = p
                    g = bisect_right(stimes, p['t']) - 1
                    if g < 0:
                        continue
                    cur = (evs[g][1], evs[g][2])
                    if cur != last:
                        if steps and steps[-1][0] == round(run):
                            steps[-1] = [round(run), cur[0], cur[1]]
                        else:
                            steps.append([round(run), cur[0], cur[1]])
                        last = cur
                tr['rides'].append({'era': ref['era'], 'date': ref['date'],
                                    't': e['elapsed_str'], 'w': e.get('avg_watts'),
                                    'hr': e.get('avg_heartrate'), 'steps': steps,
                                    'nshift': len(steps) - 1,
                                    'cogs': sorted({s[2] for s in steps})})
                break
        climb['trace'] = tr
        print('%-12s PR %s · 最近 %s · era %s · 軌跡 %d 趟 · 界線 %s' % (
            climb['name'], climb['pr']['t'],
            climb.get('best_now', {}).get('t', '—'),
            '/'.join('%s n=%d' % (k, v['n']) for k, v in out.items()),
            len(tr['rides']), tr['bounds']))

    # 「這頁的資料算到哪一天」＝最新的一筆成績，不是 PR 的日期（PR 可能是一年前）
    latest = max((e['date'] for c in pb['climbs'] for e in segs[c['id']]['efforts']), default='')
    pb['updated_at'] = latest
    if a.check:
        print('\n--check：沒有寫檔')
        return
    with open(os.path.join(ROOT, 'data', 'playbook.json'), 'w', encoding='utf-8') as f:
        json.dump(pb, f, ensure_ascii=False, indent=2)
    print('\n寫出 data/playbook.json（%d bytes）' % os.path.getsize(os.path.join(ROOT, 'data', 'playbook.json')))


if __name__ == '__main__':
    main()
