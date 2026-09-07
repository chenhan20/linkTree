#!/usr/bin/env python3
"""Validate, render, select rain plans and activate monthly cycles by date.

data/plans/YYYY-MM.json is the only edited prescription. Generated views preserve
actual outcomes. `sync` uses today's date, never activates a future month early.
"""
import argparse
import copy
import datetime as dt
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools/tcx'))
import plan_store


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps(value, ensure_ascii=False, indent=2) + '\n'
    if path.exists() and path.read_text(encoding='utf-8') == body:
        return
    tmp = path.with_suffix('.tmp')
    tmp.write_text(body, encoding='utf-8')
    tmp.replace(path)


def validate(plan):
    cycle = plan['cycle']
    start, end = map(dt.date.fromisoformat, (cycle['start'], cycle['end']))
    expected = {(start + dt.timedelta(days=i)).isoformat() for i in range((end-start).days+1)}
    if set(plan['days']) != expected:
        raise ValueError('Calendar must cover every date in the cycle, including rest days')
    if not 0 < plan['baseline']['ftp_w'] < 600:
        raise ValueError('Invalid working FTP')
    pairs = plan.get('test_pairs', [{'test_date': cycle.get('test_date'),
                                    'reserve_date': cycle.get('rain_test_date')}])
    for pair in pairs:
        original = plan['days'].get(pair['test_date'], {})
        reserve = plan['days'].get(pair['reserve_date'], {})
        if reserve.get('selected_variant') == 'reserve_test' and original.get('selected_variant') != 'rain':
            raise ValueError('Do not schedule both the original and reserve test')
    for date, day in plan['days'].items():
        weekday = dt.date.fromisoformat(date).weekday()
        if weekday == 2 and day['segments']:
            raise ValueError(f'{date}: Wednesday is not a cycling day')
        if weekday == 5 and plan.get('constraints', {}).get('saturday_available') is False and day['segments']:
            raise ValueError(f'{date}: Saturday is unavailable')
        for key in day.get('variants') or [None]:
            chosen = plan_store.resolve_day(plan, date, key)
            total = sum(s['minutes'] for s in chosen['segments'])
            cap = day['time_budget']['window_min']
            if total > cap or (weekday >= 5 and total > 60):
                raise ValueError(f'{date}/{key}: {total} exceeds time window {cap}')
            for seg in chosen['segments']:
                if seg['minutes'] <= 0:
                    raise ValueError(f'{date}: non-positive segment duration')
                t = seg.get('target_w', {})
                if t.get('lo') is not None and t.get('hi') is not None and t['lo'] > t['hi']:
                    raise ValueError(f'{date}: reversed power band')
            if key == 'rain' and weekday in (1, 3) and chosen.get('venue') != 'indoor':
                raise ValueError(f'{date}: rain plan must be indoor')
        plan_store.resolve_day(plan, date)  # selected variant must exist
    return True


def segment_text(seg):
    t = seg.get('target_w') or {}
    watts = ('自主配速，以路段終點結束' if t.get('allout') else
             f"{t['lo']}–{t['hi']}W" if t.get('lo') is not None and t.get('hi') is not None else
             f"約{t['about']}W" if t.get('about') is not None else 'RPE2–3、可完整說話')
    return f"{seg['name']} {seg['minutes']:g}分 · {watts}"


def block_view(plan, previous=None):
    c = plan['cycle']
    actuals = {s['date']: s['actual'] for s in (previous or {}).get('sessions', []) if s.get('actual')}
    sessions = []
    for date, raw in sorted(plan['days'].items()):
        day = plan_store.resolve_day(plan, date)
        if not day['segments']:
            continue
        sessions.append({'date': date, 'wk': day['week'], 'code': day['type'],
                         'name': day['label'], 'plan': day['summary'],
                         'metrics': '以主課段功率、時間、RPE與路段結果檢討；無整趟TSS達標線。',
                         'why': raw.get('route', '') + ' 雨備：' + raw.get('rain_summary', ''),
                         'minutes': sum(s['minutes'] for s in day['segments']),
                         'support': day.get('score_policy') == 'record_only',
                         'target': None, 'actual': actuals.get(date),
                         'selected_variant': day.get('selected_variant')})
    return {'id': c['id'], 'title': c['title'], 'title_en': c['title_en'],
            'start': c['start'], 'end': c['end'], 'ftp': plan['baseline']['ftp_w'],
            'goal': c['goal'], 'source': f"data/plans/{plan['month']}.json",
            'note': '戶外優先、雨備保留主課；週三不騎車。進階需完成與恢復條件。測驗與無功率輔助只記錄，不評總分。',
            'test': {'metric': '中社全段時間（室內不可替代）', 'unit': '秒'},
            'time_windows': {'tue': '早150分；晚籃球計入負荷', 'wed': '重訓／公司有氧，不騎車',
                             'thu': '早120分；特定日期以每日窗口為準', 'fri_sat_sun_mon': '每次≤60分',
                             'trainer_days': plan['constraints']['trainer']},
            'sessions': sessions,
            'guide': [{'title': '晴雨與調整', 'blocks': [{'p': v} for v in plan['rules'].values()]}]}


def render(plan):
    validate(plan)
    month, c = plan['month'], plan['cycle']
    path = ROOT / f'data/training-blocks/{month}.json'
    previous = read(path) if path.exists() else None
    active = read(ROOT / 'data/training-block.json')
    if active.get('id') == c['id']:
        previous = active
    write(path, block_view(plan, previous))
    lines = [f"# {month}｜{c['title']}", '', f"期間：{c['start']} → {c['end']}；版本{plan['revision']}，建立／修訂{plan['updated_at']}。",
             '', f"**目標：{c['goal']}**", '',
             f"功率：曲柄口徑，暫用FTP {plan['baseline']['ftp_w']}W；{plan['baseline']['ftp_source']}", '',
             f"開始前複核：{c['review_before']}。主測驗：{c['test_date']}；雨延候選：{c['rain_test_date']}。",
             '', plan.get('planning_note', '這是依目前資料排定的計畫，開始前複核後才決定是否升瓦。') + ' 下雨縮短通勤／額外騎乘，主課保留；不要求室內外TSS完全相同。',
             '', '## 每週安排', '', '| 日期 | 日 | 課程 | 戶外（分鐘） | 雨備（分鐘） | 目前選擇 |', '|---|---|---|---:|---:|---|']
    for date, day in sorted(plan['days'].items()):
        variants = day.get('variants', {})
        total = lambda k: sum(s['minutes'] for s in (plan_store.resolve_day(plan, date, k) if variants else day)['segments'])
        wd = '一二三四五六日'[dt.date.fromisoformat(date).weekday()]
        selected = {'outdoor': '戶外', 'rain': '雨備', 'reserve_test': '雨延測驗'}.get(day.get('selected_variant'), '—') if variants else '—'
        lines.append(f"| {date} | {wd} | {day['label']} | {total('outdoor'):g} | {total('rain'):g} | {selected} |")
    lines += ['', '週三0分不代表沒有重訓／公司課負荷。戶外總時間為含往返／暖身／收操的行程預算，停等會占用預算；先刪額外續騎，不為趕秒數冒險下坡。第一週腿疲勞或前期週量偏低時，少做一堂週末輕鬆踩。',
              '', '## 執行與雨備', '']
    for date, raw in sorted(plan['days'].items()):
        if not raw['segments']:
            continue
        lines += [f"### {date}｜{raw['label']}", '', raw.get('route', ''), '', raw['intent'], '']
        for key in raw['variants']:
            variant = plan_store.resolve_day(plan, date, key)
            name = {'outdoor': '戶外', 'rain': '雨備', 'reserve_test': '雨延測驗'}[key]
            lines += [f"**{name}**：{variant['summary']}", '', ' → '.join(segment_text(s) for s in variant['segments']), '']
    lines += ['## 共同規則', ''] + [f"- {v}" for v in plan['rules'].values()]
    lines += ['', '## 每週回報', ''] + [f"- {v}" for v in plan['weekly_reviews']]
    lines += ['', '## 下個月如何延續', '',
              '先讀 athlete/TRAINING_WORKFLOW.md；每月排一次方向、每週依完成與恢復微調。FIT不能告訴AI未錄的籃球、主觀疲勞與漏課原因，請補這幾項。',
              '', '本檔由 scripts/training-cycle.py render 產生，請修改 data/plans 的主資料再重生，不直接改本檔。',
              '', '## 依據', ''] + [f"- [{s['title']}]({s['url']})" for s in plan['sources']]
    out = ROOT / f'athlete/plans/{month}.md'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    return path


def sync(today):
    dt.date.fromisoformat(today)
    cycles = [read(p) for p in plan_store.monthly_files()]
    matches = [p for p in cycles if p['cycle']['start'] <= today <= p['cycle']['end']]
    if len(matches) > 1:
        raise ValueError('Overlapping monthly cycles; resolve dates before activation')
    if not matches:
        print(f'{today}: no monthly cycle applies; current legacy block retained')
        return
    plan = matches[0]
    path = render(plan)
    active_path = ROOT / 'data/training-block.json'
    active = read(active_path)
    if active.get('id') != plan['cycle']['id']:
        archive = ROOT / 'data/training-history' / (active['id'] + '.json')
        write(archive, active)
    write(active_path, read(path))
    print(f"Active: {plan['cycle']['title']}")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('command', choices=['validate', 'render', 'choose', 'sync'])
    ap.add_argument('--month', help='YYYY-MM, required except for sync')
    ap.add_argument('--date')
    ap.add_argument('--variant', choices=['outdoor', 'rain', 'reserve_test'])
    args = ap.parse_args()
    if args.command == 'sync':
        return sync(args.date or dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).date().isoformat())
    if not args.month:
        ap.error('--month is required')
    file = ROOT / f'data/plans/{args.month}.json'
    plan = read(file)
    if args.command == 'choose':
        if not args.date or not args.variant:
            ap.error('choose needs --date and --variant')
        plan_store.resolve_day(plan, args.date, args.variant)
        plan['days'][args.date]['selected_variant'] = args.variant
        plan['revision'] += 1
        plan['updated_at'] = dt.date.today().isoformat()
        validate(plan)
        write(file, plan)
    validate(plan)
    if args.command in ('render', 'choose'):
        print(render(plan).relative_to(ROOT))
    else:
        print(f"{args.month}: validated {len(plan['days'])} calendar days and all variants")


if __name__ == '__main__':
    main()
