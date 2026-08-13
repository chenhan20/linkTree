#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
backfill-itt-efforts.py —— 用自建偵測器把 data/fit/*.fit 的 ITT 成績補進 itt-segments.json

為什麼需要這支：
  Strava 的 segment matching 會漏。實測 2026-08-13 那趟，自建偵測器抓到
  「關渡→美堤 1506.9 s」，Strava 全史 0 筆。新加的路段更慘 —— 加進來的那一刻，
  Strava 只會往後配對，過去的騎乘不會回頭補。
  FIT 是本機檔案，重跑偵測器不花任何 API 額度，所以歷史可以直接從 FIT 重建。

跟 fetch-strava.js 的關係：
  那支是「合併」不是「覆寫」（scripts/fetch-strava.js:693），會讀既有 efforts 再 push
  新的，所以這裡寫進去的 FIT 成績不會被下一班 strava-sync 洗掉。
  反過來，若 Strava 事後才配對到同一趟，這支重跑時會把被取代的 FIT 筆數刪掉
  （prune_superseded），不會留下兩列一樣的成績。

去重鍵沿用 repo 慣例：同路段 + 同日 + 起跑時刻相近（見 SAME_START_TOL_SEC）。
不要用 activity_id —— 同一趟刷四次中社是四筆，activity_id 全一樣。

用法：
  python3 scripts/backfill-itt-efforts.py            # 寫入
  python3 scripts/backfill-itt-efforts.py --dry-run  # 只印差異
  python3 scripts/backfill-itt-efforts.py --only 4063039 31161895 41498683
"""
import argparse
import json
import os
import sys
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools", "tcx"))

from analyze_tcx import parse_ride            # noqa: E402
from segments import detect_efforts, load_segments  # noqa: E402

FIT_DIR = os.path.join(ROOT, "data", "fit")
ITT_FILE = os.path.join(ROOT, "data", "itt-segments.json")

# 同一路段同一天可能刷好幾趟；起跑時刻差這麼多以內視為同一筆
SAME_START_TOL_SEC = 90
# 沒有起跑時刻的舊 Strava 紀錄，退回用經過秒數比對
SAME_ELAPSED_TOL_SEC = 8


def fmt_elapsed(sec: float) -> str:
    s = int(round(sec))
    h, rem = divmod(s, 3600)
    m, ss = divmod(rem, 60)
    return f"{h}:{m:02d}:{ss:02d}" if h else f"{m}:{ss:02d}"


def mean(vals):
    vals = [v for v in vals if v is not None]
    return round(sum(vals) / len(vals)) if vals else None


def window_stats(points, start_dt, elapsed):
    """取 [start, start+elapsed] 區間的平均功率／心率／迴轉。

    偵測器回傳的是插值後的穿越時刻（帶小數），這裡用閉區間取點即可；
    路段動輒數百秒，端點取捨一兩點不影響平均值。
    """
    end_ts = start_dt.timestamp() + elapsed
    st_ts = start_dt.timestamp()
    seg = [p for p in points if st_ts <= p["t"].timestamp() <= end_ts]
    if not seg:
        return {}
    return {
        "avg_watts": mean([p.get("w") for p in seg]),
        "avg_heartrate": mean([p.get("hr") for p in seg]),
        "avg_cadence": mean([p.get("cad") for p in seg]),
    }


def start_key(e):
    """把 effort 的起跑時刻轉成當日秒數；沒有就回 None。"""
    st = e.get("start_time")
    if not st or ":" not in st:
        return None
    parts = st.split(":")
    try:
        h, m = int(parts[0]), int(parts[1])
        s = int(float(parts[2])) if len(parts) > 2 else 0
    except ValueError:
        return None
    return h * 3600 + m * 60 + s


def same_effort(a, b):
    if (a.get("date") or "") != (b.get("date") or ""):
        return False
    ka, kb = start_key(a), start_key(b)
    if ka is not None and kb is not None:
        return abs(ka - kb) <= SAME_START_TOL_SEC
    # 舊紀錄沒有 start_time，只能靠秒數
    return abs((a.get("elapsed_sec") or 0) - (b.get("elapsed_sec") or 0)) <= SAME_ELAPSED_TOL_SEC


def build_fit_efforts(only_ids=None, verbose=True):
    """跑完 data/fit 下所有 .fit，回傳 {segment_id: [effort, ...]}。"""
    segments = load_segments()
    if only_ids:
        segments = {k: v for k, v in segments.items() if str(v["id"]) in only_ids}
        if not segments:
            raise SystemExit(f"--only 指定的路段都不在 segment-streams.json：{only_ids}")

    fits = sorted(
        os.path.join(FIT_DIR, f) for f in os.listdir(FIT_DIR) if f.lower().endswith(".fit")
    )
    out = {}
    for path in fits:
        try:
            efforts = detect_efforts(path, segments)
        except Exception as e:  # 壞掉的單一 FIT 不該讓整批補資料失敗
            print(f"  ⚠️  跳過 {os.path.basename(path)}：{str(e).splitlines()[-1][:100]}")
            continue
        if not efforts:
            continue
        _, _, points = parse_ride(path)
        for e in efforts:
            st = datetime.fromisoformat(e["start_time"])
            rec = {
                "activity_id": None,           # FIT 來源沒有 Strava 活動編號
                "date": st.date().isoformat(),
                "elapsed_sec": e["elapsed_sec"],
                "elapsed_str": fmt_elapsed(e["elapsed_sec"]),
                "avg_watts": None,
                "avg_heartrate": None,
                "pr_rank": None,
                "is_pr": False,
                "start_time": st.strftime("%H:%M"),
                "source": "fit",               # ← 這個欄位是 FIT 來源的唯一標記
                "fit": os.path.basename(path),
            }
            rec.update({k: v for k, v in window_stats(points, st, e["elapsed_sec"]).items()})
            out.setdefault(e["segment_id"], []).append(rec)
        if verbose:
            names = ", ".join(sorted({x["segment_name"] for x in efforts}))
            print(f"  {os.path.basename(path)} → {len(efforts)} 筆（{names}）")
    return out


def merge(seg, fit_efforts, dry_run=False):
    """把某路段的 FIT efforts 併進既有 efforts，回傳 (新增數, 刪除數)。"""
    existing = seg.get("efforts") or []
    strava = [e for e in existing if e.get("source") != "fit"]
    kept_fit = [e for e in existing if e.get("source") == "fit"]

    # ① 先清掉「Strava 後來自己配對到、FIT 版已多餘」的舊 FIT 筆
    pruned = [e for e in kept_fit if any(same_effort(e, s) for s in strava)]
    kept_fit = [e for e in kept_fit if e not in pruned]

    # ② 再併入這次偵測到的；Strava 已有的不重複加，FIT 已有的就地更新
    added = 0
    for fe in fit_efforts:
        if any(same_effort(fe, s) for s in strava):
            continue
        hit = next((e for e in kept_fit if same_effort(fe, e)), None)
        if hit:
            hit.update(fe)
            continue
        kept_fit.append(fe)
        added += 1

    merged = strava + kept_fit
    merged.sort(key=lambda e: f"{e.get('date','')} {e.get('start_time','')}", reverse=True)

    # ③ PR 重算。Strava 的 is_pr 只在 Strava 自己的集合裡成立，
    #    加進 FIT 成績後最快的那筆可能換人，整段一起重算才不會出現兩頂皇冠。
    if merged:
        pr_time = min(e["elapsed_sec"] for e in merged)
        holder = sorted(
            (e for e in merged if e["elapsed_sec"] == pr_time),
            key=lambda e: f"{e.get('date','')} {e.get('start_time','')}",
        )[0]
        for e in merged:
            e["is_pr"] = e is holder
        pr_str = fmt_elapsed(pr_time)
    else:
        pr_str = None

    if not dry_run:
        seg["efforts"] = merged
        seg["pr_time_str"] = pr_str
    return added, len(pruned)


def main(argv=None):
    ap = argparse.ArgumentParser(description="用 FIT 自建偵測器回補 ITT 成績")
    ap.add_argument("--dry-run", action="store_true", help="只印差異，不寫檔")
    ap.add_argument("--only", nargs="+", metavar="SEG_ID", help="只處理這些路段編號")
    ap.add_argument("-q", "--quiet", action="store_true")
    args = ap.parse_args(argv)

    print(f"掃描 {FIT_DIR} …")
    fit_efforts = build_fit_efforts(only_ids=set(args.only) if args.only else None,
                                    verbose=not args.quiet)

    data = json.load(open(ITT_FILE, encoding="utf-8"))
    total_add = total_prune = 0
    for seg in data:
        mine = fit_efforts.get(seg["id"], [])
        before = len(seg.get("efforts") or [])
        add, prune = merge(seg, mine, dry_run=args.dry_run)
        total_add += add
        total_prune += prune
        if add or prune:
            after = before + add - prune
            print(f"  {seg['id']} {seg['name']}：{before} → {after} 筆"
                  f"（新增 {add}{f'、清掉被 Strava 取代的 {prune}' if prune else ''}）")

    if args.dry_run:
        print(f"\n[dry-run] 會新增 {total_add} 筆、清掉 {total_prune} 筆，未寫檔。")
        return 0

    with open(ITT_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"\n✅ 寫入 {ITT_FILE}：新增 {total_add} 筆、清掉 {total_prune} 筆。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
