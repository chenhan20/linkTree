#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build-tasks.py —— 產生 data/tasks.json（現況頁那張「代辦」卡，也是給 AI 開場讀的清單）

為什麼要有這支：
  同步管線每天都會產出一些「該做但沒人記得做」的事——最典型的是報告產出來了、
  教練評語卻沒寫（實測 70 份報告只有 2 份有）。這支把那些事變成一份清單，
  現況頁看得到，AI 開場也讀同一份，就會主動問「要不要順手把 09-01 的評語寫一寫」。

代辦是**推導出來的**，不是手動維護的狀態：
  每次重跑都整份重算，所以事情做完了（評語檔出現了、重複的活動刪掉了）
  對應的代辦會自己消失，不需要去「打勾」。不想做的用 --dismiss 壓下去。
  純手動的事情用 --add。兩者都存在 data/tasks.json 裡，重跑不會被洗掉。

五條自動規則（都可以在 tasks.json 的 config 裡調）：
  note     rides/<date>.html 存在但 rides/notes/<date>.json 不存在
  score    data/fit/_scores/<date>.json 的 total.score 低於 scoreBelow
  data     同一天 Strava 與手錶各有一筆室內（Rouvy 那份沒刪）／ITT 兩份檔筆數漂移
  missing  最近 missingWindowDays 天內完全沒有紀錄的日子（籃球、有氧課不戴錶就是 0 筆）
  gear     最近一趟騎乘 FIT 裡的器材狀態（data/fit-extras.json，scripts/build-fit-extras.py 產的）：
           功率計電池 low／critical、Di2 電量 ≤ gearDi2Below、左右平衡超出 gearLrbRange、
           功率掉線 ≥ gearGapSec 秒。2026-08-27 平衡壞掉、09-22 電池 low 都是事後用眼睛看到的，這條就是補那個洞

  note / score 只看 config.noteSince 之後的日期 —— 不然一開就會並上 68 筆舊報告。

用法：
  python3 scripts/build-tasks.py                      # 重算並寫檔
  python3 scripts/build-tasks.py --dry-run            # 只印
  python3 scripts/build-tasks.py --add "去 Strava 刪掉 Rouvy 那筆" --detail "9/1 79.64 km 虛擬距離"
  python3 scripts/build-tasks.py --dismiss score-2026-08-20 --reason "已經討論過"
  python3 scripts/build-tasks.py --undismiss score-2026-08-20
  python3 scripts/build-tasks.py --drop m-20260901-1  # 刪掉手動加的那筆
"""
import argparse
import io
import json
import os
import re
from datetime import date, datetime, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "tasks.json")
RIDES = os.path.join(ROOT, "rides")
NOTES = os.path.join(RIDES, "notes")
SCORES = os.path.join(ROOT, "data", "fit", "_scores")
ACTIVITIES = os.path.join(ROOT, "data", "fit", "_activities.json")
STRAVA = os.path.join(ROOT, "data", "strava.json")
ITT = os.path.join(ROOT, "data", "itt-segments.json")
EXTRAS = os.path.join(ROOT, "data", "fit-extras.json")

DEFAULT_CONFIG = {
    "noteSince": None,          # None = 第一次跑的那天；只看這天之後的報告
    "scoreBelow": 80,           # 課表分數低於這個就列入
    "missingWindowDays": 7,     # 往回看幾天
    "missingMinDays": 2,        # 空白天數達到這個才報（一天空白很正常）
    "gearDi2Below": 25,         # Di2 電量 ≤ 這個 % 就提醒
    "gearLrbRange": [35, 65],   # 右腳 % 在這個範圍外＝感測器讀值不合理（他正常在 48–58）
    "gearGapSec": 60,           # 一趟裡功率掉線累計超過這麼多秒
}
DATE_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})$")


def load(path, default=None):
    try:
        return json.loads(io.open(path, encoding="utf-8").read())
    except Exception:
        return default


def report_dates():
    if not os.path.isdir(RIDES):
        return []
    out = []
    for f in os.listdir(RIDES):
        m = re.match(r"^(\d{4}-\d{2}-\d{2})\.html$", f)
        if m:
            out.append(m.group(1))
    return sorted(out)


def score_of(d):
    s = load(os.path.join(SCORES, d + ".json"))
    if not s:
        return None
    t = (s.get("total") or {})
    if t.get("score") is None:
        return None
    plan = s.get("plan") or {}
    # 課表名在 plan.label，長成「【訓練台】 W3 · 課表 A 門檻續航 3×15 分（含大盤扭力）」
    label = re.sub(r"^【[^】]*】\s*", "", str(plan.get("label") or "")).strip()
    return {"score": t["score"], "grade": t.get("grade"), "workout": label,
            "notes": s.get("notes") or [], "dims": s.get("dimensions") or {}}


def weakest_dimension(dims):
    """挑分數最低的面向，講一句話用。"""
    named = [(k, (v or {}).get("score")) for k, v in dims.items()]
    named = [(k, v) for k, v in named if isinstance(v, (int, float))]
    if not named:
        return None
    k, v = min(named, key=lambda kv: kv[1])
    zh = {"compliance": "處方達成", "discipline": "執行紀律",
          "durability": "續航", "cadence": "迴轉"}
    return f"最弱的是{zh.get(k, k)} {v:.0f} 分"


def rule_note(cfg, seen_scores):
    out = []
    for d in report_dates():
        if d < cfg["noteSince"]:
            continue
        if os.path.exists(os.path.join(NOTES, d + ".json")):
            continue
        sc = seen_scores.get(d)
        detail = (f"{sc['workout']}　{sc['score']:.1f} 分（{sc['grade']}）".strip()
                  if sc else "報告已產出，評語還沒寫")
        out.append({"id": f"note-{d}", "kind": "note", "priority": 1,
                    "title": f"{d} 的報告還沒有教練評語",
                    "detail": detail, "date": d, "link": f"rides/{d}.html"})
    return out


def rule_score(cfg, seen_scores):
    out = []
    for d, sc in sorted(seen_scores.items()):
        if d < cfg["noteSince"] or sc["score"] >= cfg["scoreBelow"]:
            continue
        why = weakest_dimension(sc["dims"]) or "逐段對帳有落差"
        out.append({"id": f"score-{d}", "kind": "score", "priority": 2,
                    "title": f"{d} 課表 {sc['score']:.1f} 分（{sc['grade']}）—— 要不要拆開看",
                    "detail": "；".join(x for x in (sc["workout"], why) if x), "date": d,
                    "link": f"rides/{d}.html"})
    return out


def rule_data(cfg):
    """兩種對不起來：同一天 Strava 與手錶各存一筆室內；ITT 兩份檔的筆數漂移。"""
    out = []
    acts = load(ACTIVITIES, {}) or {}
    # 手錶錄到的室內日（intervals 那邊的 type 是 VirtualRide 或名稱含「室內」）
    indoor_watch = set()
    for a in acts.values():
        sd = str(a.get("start_date_local") or "")[:10]
        if not DATE_RE.match(sd):
            continue
        if a.get("type") == "VirtualRide" or "室內" in str(a.get("name") or ""):
            indoor_watch.add(sd)
    sv = load(STRAVA, {}) or {}
    for r in (sv.get("recent_rides") or []):
        d = str(r.get("date") or "")[:10]
        # 跟 note/score 一樣只看 noteSince 之後：這條是要抓「新犯的」，舊的早就處理過了
        if d >= cfg["noteSince"] and d in indoor_watch and str(r.get("sport_type") or "").startswith("Virtual"):
            km = r.get("distance_km")
            out.append({"id": f"dup-{d}", "kind": "data", "priority": 2,
                        "title": f"{d} Strava 與手錶各有一筆室內",
                        "detail": f"Strava 那筆是「{r.get('name') or '?'}」"
                                  f"{('，' + str(km) + ' km 虛擬距離會灌進年度里程') if km else ''}",
                        "date": d, "link": None})
    # ITT 兩份檔漂移（見 memory: itt-two-files-drift）
    itt = {s["id"]: s for s in (load(ITT, []) or [])}
    seg = {s["id"]: s for s in (sv.get("segments") or [])}
    drift = [(itt[k]["name"], len(itt[k].get("efforts") or []), len((seg.get(k) or {}).get("efforts") or []))
             for k in itt if k in seg
             and len(itt[k].get("efforts") or []) != len((seg.get(k) or {}).get("efforts") or [])]
    if drift:
        head = "、".join(f"{n} {a}≠{b}" for n, a, b in drift[:3])
        out.append({"id": "itt-drift", "kind": "data", "priority": 2,
                    "title": f"ITT 兩份檔筆數對不起來（{len(drift)} 條）",
                    "detail": f"{head}。畫面吃 itt-segments.json，先比對再判斷是不是偵測器的問題",
                    "date": None, "link": None})
    return out


def rule_missing(cfg, today):
    acts = load(ACTIVITIES, {}) or {}
    have = {str(a.get("start_date_local") or "")[:10] for a in acts.values()}
    blank = []
    for i in range(1, cfg["missingWindowDays"] + 1):
        d = (today - timedelta(days=i)).isoformat()
        if d not in have:
            blank.append(d)
    if len(blank) < cfg["missingMinDays"]:
        return []
    wd = "一二三四五六日"
    label = "、".join(f"{d[5:]}（{wd[date.fromisoformat(d).weekday()]}）" for d in sorted(blank))
    return [{"id": f"missing-{today.isoformat()}", "kind": "missing", "priority": 3,
             "title": f"最近 {cfg['missingWindowDays']} 天有 {len(blank)} 天完全沒有紀錄",
             "detail": f"{label} —— 籃球／有氧課不戴錶就是 0 筆，有漏的跟我說，我補進佔位表",
             "date": None, "link": None}]


def _tail_streak(rides, bad):
    """從最後一趟往回數，連續符合 bad 的那幾趟（由舊到新）。"""
    out = []
    for x in reversed(rides):
        if not bad(x):
            break
        out.append(x)
    return list(reversed(out))


def rule_gear(cfg):
    """器材：只看最近一趟騎乘（事情修好了，下一趟 FIT 一正常，這筆代辦就自己消失）。"""
    doc = load(EXTRAS, {}) or {}
    rides = sorted((doc.get("rides") or {}).values(), key=lambda x: (x.get("date") or "", x.get("start") or ""))
    rides = [x for x in rides if x.get("pm") or x.get("di2") is not None or x.get("lrb") is not None]
    if not rides:
        return []
    last, out = rides[-1], []

    def since(streak):
        d = streak[0]["date"]
        return d, (f"{d[5:]} 起連 {len(streak)} 趟" if len(streak) > 1 else f"{d[5:]} 那趟")
    pm_bad = lambda x: ((x.get("pm") or {}).get("worst") in ("low", "critical"))
    if pm_bad(last):
        d, when = since(_tail_streak(rides, pm_bad))
        out.append({"id": f"gear-pm-{d}", "kind": "gear", "priority": 1,
                    "title": f"功率計電池 {last['pm']['worst']}（{when}）",
                    "detail": "功率計自己回報的電量狀態。騎到一半沒電，那趟的功率、計時段、課表評分會一起斷掉 —— 測驗前先充",
                    "date": d, "link": None})
    if last.get("di2") is not None and last["di2"] <= cfg["gearDi2Below"]:
        out.append({"id": f"gear-di2-{last['date']}", "kind": "gear", "priority": 2,
                    "title": f"Di2 電量 {last['di2']}%（{last['date'][5:]} 那趟）",
                    "detail": "電變沒電會卡在最後一個檔位；FIT 的換檔紀錄也會跟著消失",
                    "date": last["date"], "link": None})
    lo, hi = cfg["gearLrbRange"]
    lrb_bad = lambda x: x.get("lrb") is not None and (x.get("lrb_cov") or 0) >= 0.5 and not (lo <= x["lrb"] <= hi)
    if lrb_bad(last):
        d, when = since(_tail_streak(rides, lrb_bad))
        out.append({"id": f"gear-lrb-{d}", "kind": "gear", "priority": 2,
                    "title": f"左右平衡讀值不合理：右腳 {last['lrb']:.0f}%（{when}）",
                    "detail": "總功率多半沒事（看 EF 有沒有跟著掉），但平衡數字先不要拿來下結論。第一步是歸零校正",
                    "date": d, "link": None})
    if (last.get("pw_gap_s") or 0) >= cfg["gearGapSec"]:
        out.append({"id": f"gear-gap-{last['date']}", "kind": "gear", "priority": 2,
                    "title": f"{last['date']} 功率掉線 {last['pw_gap_s']} 秒（{last['pw_gaps']} 段）",
                    "detail": "有踏頻、有速度，功率欄位卻是空的：電量或 ANT+ 連線。那幾段的計時與評分不可信",
                    "date": last["date"], "link": None})
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description="產生 data/tasks.json")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--add", metavar="TITLE", help="手動加一筆代辦")
    ap.add_argument("--detail", metavar="TEXT", default="", help="配合 --add")
    ap.add_argument("--drop", metavar="ID", help="刪掉手動加的那筆")
    ap.add_argument("--dismiss", metavar="ID", help="把某筆自動代辦壓下去（重跑不會再出現）")
    ap.add_argument("--reason", metavar="TEXT", default="", help="配合 --dismiss")
    ap.add_argument("--undismiss", metavar="ID")
    ap.add_argument("--today", metavar="YYYY-MM-DD", help="覆寫今天（測試用）")
    args = ap.parse_args(argv)

    today = date.fromisoformat(args.today) if args.today else date.today()

    doc = load(OUT) or {}
    cfg = dict(DEFAULT_CONFIG)
    cfg.update(doc.get("config") or {})
    if not cfg.get("noteSince"):
        cfg["noteSince"] = today.isoformat()   # 第一次跑：從今天開始，不追溯 68 份舊報告
    dismissed = dict(doc.get("dismissed") or {})
    manual = list(doc.get("manual") or [])

    if args.add:
        n = 1 + sum(1 for m in manual if m["id"].startswith(f"m-{today:%Y%m%d}"))
        manual.append({"id": f"m-{today:%Y%m%d}-{n}", "kind": "manual", "priority": 2,
                       "title": args.add, "detail": args.detail,
                       "date": today.isoformat(), "link": None})
        print(f"＋ 手動代辦 {manual[-1]['id']}：{args.add}")
    if args.drop:
        before = len(manual)
        manual = [m for m in manual if m["id"] != args.drop]
        print(("－ 刪掉 " + args.drop) if len(manual) < before else f"找不到 {args.drop}")
    if args.dismiss:
        dismissed[args.dismiss] = args.reason or today.isoformat()
        print(f"－ 壓下 {args.dismiss}")
    if args.undismiss:
        dismissed.pop(args.undismiss, None)
        print(f"＋ 放回 {args.undismiss}")

    scores = {}
    if os.path.isdir(SCORES):
        for f in os.listdir(SCORES):
            m = re.match(r"^(\d{4}-\d{2}-\d{2})\.json$", f)
            if m:
                sc = score_of(m.group(1))
                if sc:
                    scores[m.group(1)] = sc

    tasks = rule_note(cfg, scores) + rule_score(cfg, scores) + rule_data(cfg) + rule_missing(cfg, today) + rule_gear(cfg)
    tasks = [t for t in tasks if t["id"] not in dismissed] + manual
    tasks.sort(key=lambda t: (t["priority"], t.get("date") or "9999", t["id"]))

    out = {
        "_comment": "現況頁的代辦清單。由 scripts/build-tasks.py 重新推導，不要手改 tasks[]；"
                    "要壓下某筆用 --dismiss，要自己加一筆用 --add。",
        "generated": today.isoformat(),
        "config": cfg,
        "dismissed": dismissed,
        "manual": manual,
        "tasks": tasks,
    }
    kinds = {}
    for t in tasks:
        kinds[t["kind"]] = kinds.get(t["kind"], 0) + 1
    print(f"\n代辦 {len(tasks)} 筆" + (f"（{'、'.join(f'{k} {v}' for k, v in kinds.items())}）" if kinds else "（清空了）"))
    for t in tasks:
        print(f"  [{t['kind']}] {t['title']}")
        if t.get("detail"):
            print(f"          {t['detail']}")
    if args.dry_run:
        print("\n[dry-run] 未寫檔。")
        return
    io.open(OUT, "w", encoding="utf-8").write(json.dumps(out, ensure_ascii=False, indent=2) + "\n")
    print(f"\n✅ 寫入 {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()
