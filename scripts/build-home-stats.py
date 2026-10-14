#!/usr/bin/env python3
"""首頁按鈕的即時副標資料 → data/home-stats.json

首頁（linkTreeIndex.html）的 Strava／訓練報告／GitHub／RIDE CINEMA 四個按鈕，副標會換成這份檔案裡的數字；
抓不到就維持寫死的靜態副標。前端只 fetch 這一個小檔，不碰任何 API、沒有金鑰。

數字的來源（全部是本機現算，不打 API）：
  ride    本月騎乘小時、距損益線 — scripts/ride_hours.py（跟 coach-brief 同一份，室內已去重）
  last    最近一趟戶外／室內騎乘的日期、公里、爬升 — data/fit/_activities.json
  report  最新一份單日報告的日期與評分、報告總數 — rides/index.json
  github  近 30 天的 commit 數（不含排程機器人）— git log

公開頁面的底線：只放日期、公里、小時、分數、次數。不放座標、地名以外的任何位置資訊、體重、身體狀態。

CI 裡 checkout 是淺層的（fetch-depth 1），git log 只看得到一筆：workflow 會先 `git fetch --shallow-since`
把近 35 天補回來；萬一仍是淺層而且看不到歷史，就沿用上一次檔案裡的 github 數字，不寫成 0。

    python3 scripts/build-home-stats.py
"""
import datetime as dt
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import ride_hours  # noqa: E402

OUT = os.path.join(ROOT, 'data', 'home-stats.json')
BREAKEVEN_H = 15.3        # 月騎乘損益線，見 scripts/coach-brief.py
BOT = 'github-actions'


def load(*p, default=None):
    try:
        with open(os.path.join(ROOT, *p), encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def git(*args):
    r = subprocess.run(['git', *args], cwd=ROOT, capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else None


def ride_block(today):
    month = today.strftime('%Y-%m')
    cur = ride_hours.month_of(month)
    return {
        'month': month,
        'hours': round(cur.get('hours', 0.0), 1),
        'breakeven_h': BREAKEVEN_H,
        'day': today.day,
        'days_in_month': ((today.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
                          - dt.timedelta(days=1)).day,
    }


def last_ride():
    acts = load('data', 'fit', '_activities.json', default={}) or {}
    rides = [v for v in acts.values()
             if v.get('type') in ('Ride', 'VirtualRide') and v.get('start_date_local')]
    if not rides:
        return None
    # 同一天有室內重複時取比較長的，跟月時數的去重精神一致；只要日期與公里就夠了
    rides.sort(key=lambda v: v['start_date_local'], reverse=True)
    day = rides[0]['start_date_local'][:10]
    same = [v for v in rides if v['start_date_local'][:10] == day]
    best = max(same, key=lambda v: v.get('moving_time') or 0)
    km = (best.get('distance') or 0) / 1000.0
    return {
        'date': day,
        'km': round(km, 1) if km else None,
        'elev_m': int(best.get('total_elevation_gain') or 0) or None,
        'indoor': best.get('type') == 'VirtualRide',
    }


def report_block():
    idx = load('rides', 'index.json', default=None)
    rows = (idx if isinstance(idx, list) else (idx or {}).get('rides')) or []
    if isinstance(idx, dict) and not rows:
        rows = [v for v in idx.values() if isinstance(v, dict) and v.get('date')]
    if not rows:
        return None
    rows = sorted(rows, key=lambda r: r.get('date', ''), reverse=True)
    top = rows[0]
    sc = top.get('score') or {}
    return {
        'date': top.get('date'),
        'score': sc.get('total'),
        'grade': sc.get('grade'),
        'count': len(rows),
    }


def github_block(prev):
    shallow = git('rev-parse', '--is-shallow-repository') == 'true'
    since = (dt.date.today() - dt.timedelta(days=30)).isoformat()
    out = git('log', f'--since={since}', '--pretty=%an|%ad', '--date=short')
    if out is None or (shallow and not out):
        return prev
    rows = [l.split('|', 1) for l in out.splitlines() if '|' in l]
    human = [r for r in rows if BOT not in r[0].lower()]
    if shallow and len(rows) <= 1 and prev:
        return prev          # 淺層 checkout 看不到歷史，別把真實數字洗成 1
    return {
        'commits_30d': len(human),
        'last_commit': max((r[1] for r in human), default=None),
    }


def main():
    today = dt.date.today()
    prev = (load('data', 'home-stats.json', default={}) or {}).get('github')
    stats = {
        'updated_at': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'ride': ride_block(today),
        'last': last_ride(),
        'report': report_block(),
        'github': github_block(prev),
    }
    body = json.dumps(stats, ensure_ascii=False, indent=2) + '\n'
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write(body)
    print(f"✅ 寫入 data/home-stats.json：本月 {stats['ride']['hours']} h／{BREAKEVEN_H} h，"
          f"最近 {(stats['last'] or {}).get('date')}，報告 {(stats['report'] or {}).get('count')} 份，"
          f"commits {(stats['github'] or {}).get('commits_30d')}")


if __name__ == '__main__':
    main()
