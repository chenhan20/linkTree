#!/usr/bin/env python3
"""教練簡報 —— 一個指令把「判讀這個人現在的狀態」需要的東西全部印出來。

    python3 scripts/coach-brief.py                    # 近 21 天活動 + 8 天 wellness + 週期 + 下一堂處方
    python3 scripts/coach-brief.py --days 60          # 拉長活動視窗
    python3 scripts/coach-brief.py --date 2026-08-18  # 把那一天當成今天（回顧用）

資料全部來自 repo 內既有的檔案，不打任何 API：
  data/fit/_activities.json  intervals.icu 每筆活動摘要（TL / TRIMP / NP / VI / decoupling）
  data/fit/_wellness.json    每日 CTL/ATL/HRV/靜息/睡眠（未來日是推算值，這裡切掉）
  data/training-block.json   手寫週期計畫與實際值（含替代執行與教練評）
  data/plan.json             逐段處方，tools/tcx/score.py 用它對帳
"""
import json, argparse, datetime, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
J = lambda *p: json.load(open(os.path.join(ROOT, *p), encoding='utf-8'))
DASH = '—'


def num(v, fmt='{:.0f}'):
    return fmt.format(v) if isinstance(v, (int, float)) else DASH


def hhmm(secs):
    return '{}:{:02d}'.format(secs // 3600, secs % 3600 // 60) if secs else DASH


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--days', type=int, default=21, help='活動視窗天數（預設 21）')
    ap.add_argument('--date', default=None, help='把哪一天當成今天（預設：台北時間今天）')
    a = ap.parse_args()

    today = a.date or datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).strftime('%Y-%m-%d')
    since = (datetime.date.fromisoformat(today) - datetime.timedelta(days=a.days)).isoformat()
    print('=== 教練簡報 · 以 {} 為今天 ==='.format(today))

    # ── 活動 ──────────────────────────────────────────────────────────
    acts = J('data', 'fit', '_activities.json')
    rows = sorted((v for v in acts.values() if str(v.get('start_date_local', ''))[:10] >= since),
                  key=lambda v: v['start_date_local'], reverse=True)
    print('\n── 活動（近 {} 天，{} 筆）　※ TL：有功率的騎乘走功率算，其餘走心率'.format(a.days, len(rows)))
    print('{:11}{:14}{:>6}{:>5}{:>7}{:>6}{:>6}{:>6}{:>9}'.format(
        '日期', '項目', '時長', 'TL', 'TRIMP', '強度', 'NP', 'VI', '心率漂移'))
    for v in rows:
        secs = sum(v.get('icu_hr_zone_times') or []) or (v.get('moving_time') or 0)
        dec = v.get('decoupling')
        print('{:11}{:14}{:>5}m{:>5}{:>7}{:>5}%{:>6}{:>6}{:>9}'.format(
            v['start_date_local'][:10], v.get('type') or '',
            num(secs / 60), num(v.get('icu_training_load')), num(v.get('trimp')),
            num(v.get('icu_intensity')), num(v.get('icu_weighted_avg_watts')),
            num(v.get('icu_variability_index'), '{:.2f}'),
            num(dec, '{:.1f}') + ('%' if dec is not None else '')))
    if not rows:
        print('  （視窗內沒有活動）')

    # ── 身體狀態 ──────────────────────────────────────────────────────
    w = J('data', 'fit', '_wellness.json')
    days = w.get('days', w)
    keys = [k for k in sorted(days) if k <= today][-8:]   # 未來日照樣有推算值，切掉
    print('\n── 身體狀態（未來日的推算值已切除，最後一天＝{}）'.format(keys[-1] if keys else DASH))
    print('{:11}{:>7}{:>7}{:>7}{:>6}{:>6}{:>8}{:>6}'.format(
        '日期', 'CTL', 'ATL', 'TSB', 'HRV', '靜息', '睡眠', '睡分'))
    for k in keys:
        d = days[k]
        ctl, atl = d.get('ctl'), d.get('atl')
        tsb = ctl - atl if isinstance(ctl, (int, float)) and isinstance(atl, (int, float)) else None
        print('{:11}{:>7}{:>7}{:>7}{:>6}{:>6}{:>8}{:>6}'.format(
            k, num(ctl, '{:.1f}'), num(atl, '{:.1f}'), num(tsb, '{:+.1f}'),
            num(d.get('hrv')), num(d.get('restingHR')), hhmm(d.get('sleepSecs')),
            num(d.get('sleepScore'))))
    hrvs = [days[k]['hrv'] for k in sorted(days) if k <= today and days[k].get('hrv')][-7:]
    if hrvs:
        print('  HRV 7 日均 {:.1f}（基線 52–71，下緣 52 ← 連兩天低於它就踩恢復煞車）'.format(sum(hrvs) / len(hrvs)))

    # ── 週期 ──────────────────────────────────────────────────────────
    try:
        b = J('data', 'training-block.json')
    except FileNotFoundError:
        print('\n（沒有 data/training-block.json，跳過週期）')
        return
    S = sorted(b.get('sessions', []), key=lambda s: s['date'])
    doneN = sum(1 for s in S if s.get('actual') and not s['actual'].get('substituted'))
    print('\n── 週期：{} {} → {} · FTP {}W · {}/{} 完成'.format(
        b.get('title'), b.get('start'), b.get('end'), b.get('ftp'), doneN, len(S)))
    print('  目標：{}'.format(b.get('goal')))
    for s in S:
        act = s.get('actual') or None
        if act and act.get('substituted'):
            st = '替代：' + (act.get('sub_name') or '')
        elif act:
            st = '做了 IF {} / TSS {} / VI {}'.format(act.get('if'), act.get('tss'), act.get('vi'))
        elif s['date'] < today:
            st = '未執行'
        elif s['date'] == today:
            st = '← 今天'
        else:
            st = '{} 天後'.format((datetime.date.fromisoformat(s['date'])
                                   - datetime.date.fromisoformat(today)).days)
        t = s.get('target') or {}
        print('  {} {:4}{:18}目標 IF {} TSS {} VI ≤{}  {}'.format(
            s['date'], s.get('wk') or '', s.get('name') or '',
            t.get('if'), t.get('tss'), t.get('vi'), st))
        if act and act.get('note'):
            print('{:15}└ {}'.format('', act['note']))

    # ── 下一堂的逐段處方 ──────────────────────────────────────────────
    plan = J('data', 'plan.json')
    nxt = next((s['date'] for s in S if s['date'] >= today and not s.get('actual')), None)
    day = (plan.get('days') or {}).get(nxt)
    if day:
        tb = day.get('time_budget') or {}
        print('\n── 下一堂逐段處方 {}（{}）　窗口 {} 分／騎乘 {} 分，餘裕 {} 分'.format(
            nxt, day.get('label'), tb.get('window_min'), tb.get('ride_min'),
            (tb.get('window_min') or 0) - (tb.get('ride_min') or 0)))
        for sg in day.get('segments', []):
            tw = sg.get('target_w') or {}
            if tw.get('allout'):
                band = '全力'
            elif tw.get('lo') or tw.get('hi'):
                band = '{}–{}W'.format(tw.get('lo') or '', tw.get('hi') or '')
            elif tw.get('about'):
                band = '~{}W'.format(tw['about'])
            else:
                band = DASH
            cad = sg.get('target_cadence') or {}
            print('  {:>4} 分  {:16}{:14}{}'.format(
                sg['minutes'], sg['name'], band,
                '迴轉 {}–{}'.format(cad.get('lo'), cad.get('hi')) if cad else ''))
        for r in day.get('rules', []):
            print('  規則 · {}'.format(r.get('label')))
    print()


if __name__ == '__main__':
    sys.exit(main())
