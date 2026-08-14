#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
backfill-itt-efforts.py —— 用自建偵測器把 data/fit/*.fit 的 ITT 成績補進 itt-segments.json

為什麼需要這支：
  Strava 的路段成績配對是**付費功能**，訂閱斷了就沒了；而 FIT 是本機檔案，
  重跑偵測器不花任何 API 額度，所以歷史可以無限次從 FIT 重建。
  改了演算法就重掃一次，整批歷史自動跟著修正 —— 這是靠 API 拿數字做不到的。

  ⚠️ 一個曾經寫在這裡的錯誤結論：本檔先前宣稱「Strava 會漏配對，實測關渡→美堤
  Strava 全史 0 筆」。那是錯的。真正的原因是 scripts/fetch-strava.js 打 activity
  detail 時沒帶 include_all_efforts=true（預設 false），Strava 只回「重點」efforts。
  補上參數重抓後，那些成績 Strava 全都有，而且跟自建計時逐筆吻合（--compare 可驗）。
  Strava 也**會**回頭把新路段配對到舊活動，不是只往後配。

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


def merge(seg, fit_efforts, scanned=True, dry_run=False):
    """把某路段的 FIT efforts 併進既有 efforts，回傳 (新增數, 刪除數)。

    scanned=True 時，這條路段的 FIT 成績是「整批重算」而不是「累加」——
    偵測結果是 FIT 檔加演算法的純函數，演算法改了就該以新結果為準。
    累加會留下幽靈：實測 2025-10-29 河濱10K，偵測器修正起跑點判定之後
    起跑時刻從 20:01 變成 20:03，超過 90 秒的同一筆容忍度，
    舊寫法會把它當成新的一筆而把錯的那筆留著，同一趟就變成兩列。

    scanned=False（--only 沒掃到這條）則完全不動它的 FIT 成績。
    """
    existing = seg.get("efforts") or []
    strava = [e for e in existing if e.get("source") != "fit"]
    old_fit = [e for e in existing if e.get("source") == "fit"]

    if not scanned:
        return 0, 0

    # ① 這次偵測到的就是 FIT 端的全部事實；Strava 已有的同一筆不重複列
    kept_fit, added = [], 0
    for fe in fit_efforts:
        if any(same_effort(fe, s) for s in strava):
            continue
        kept_fit.append(fe)
        if not any(same_effort(fe, e) for e in old_fit):
            added += 1

    # ② 被丟掉的舊 FIT 筆：可能是 Strava 事後補配對到，也可能是演算法修正後不再成立
    pruned = [e for e in old_fit if not any(same_effort(e, f) for f in kept_fit)]

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


HARVEST_CATALOG = os.path.join(ROOT, "data", "strava-archive", "segment-catalog.json")
ITT_CONFIG = os.path.join(ROOT, "data", "itt-config.json")
ARCHIVE_SEGS = os.path.join(ROOT, "data", "strava-archive", "segments")


def seed_missing(data):
    """itt-config.json 有、itt-segments.json 還沒有的路段，就地建檔。

    沒有這步的話「加一條 ITT」要動兩個檔：config 加一筆、還要手動在成績檔補一個空殼，
    否則回補迴圈跑的是 itt-segments.json 的既有項目，新路段永遠不會被掃到。
    路段的靜態 metadata（距離、爬升、均坡、KOM）直接從 harvest 封存檔讀 ——
    純本機、不打 API，所以 Strava 訂閱到期之後照樣能加新路段。
    """
    have = {s["id"] for s in data}
    cfg = json.load(open(ITT_CONFIG, encoding="utf-8"))
    added = []
    for c in cfg.get("segments", []):
        if c["id"] in have:
            continue
        seg = {"id": c["id"], "name": c.get("nameApi") or c.get("nameZh") or str(c["id"]),
               "distance_km": None, "pr_time_str": None, "athlete_count": None,
               "effort_count": None, "leaderboard_total": None, "pr_rank": None,
               "kom_time_str": None, "kom_elapsed_sec": None, "efforts": []}
        meta_path = os.path.join(ARCHIVE_SEGS, f"{c['id']}.json")
        if os.path.exists(meta_path):
            m = (json.load(open(meta_path, encoding="utf-8")) or {}).get("meta") or {}
            if m.get("distance"):
                seg["distance_km"] = round(m["distance"] / 1000, 2)
            seg["athlete_count"] = m.get("athlete_count")
            seg["effort_count"] = m.get("effort_count")
            if m.get("total_elevation_gain") is not None:
                seg["elevation_gain_m"] = round(m["total_elevation_gain"])
            if m.get("average_grade") is not None:
                seg["average_grade"] = round(m["average_grade"], 1)
            xoms = m.get("xoms") or {}
            kom = xoms.get("kom") or xoms.get("overall")
            if kom and kom[:1].isdigit():
                seg["kom_time_str"] = kom
                parts = [int(x) for x in kom.split(":")]
                seg["kom_elapsed_sec"] = (parts[0] * 3600 + parts[1] * 60 + parts[2]
                                          if len(parts) == 3 else parts[0] * 60 + parts[1])
        data.append(seg)
        added.append(seg)
    if added:
        print(f"  依 itt-config.json 建檔 {len(added)} 條新路段："
              + "、".join(s["name"] for s in added[:6])
              + (f" …等 {len(added)} 條" if len(added) > 6 else ""))
    return added


def strava_side(data):
    """對帳基準：優先用 harvest 封存的完整 Strava 資料。

    itt-segments.json 裡的 Strava 成績是歷來同步累積的，而那些同步一直沒帶
    include_all_efforts=true，所以少了一大截（Strava 只回「重點」efforts）。
    scripts/harvest-strava.js 補齊之後，那份 catalog 才是 Strava 端的完整事實。
    沒有 catalog 就退回舊來源，只是比對筆數會比較少。
    """
    if os.path.exists(HARVEST_CATALOG):
        cat = json.load(open(HARVEST_CATALOG, encoding="utf-8"))
        by_id = {s["id"]: s for s in cat.get("segments", [])}
        if by_id:
            print(f"（對帳基準：{os.path.relpath(HARVEST_CATALOG, ROOT)}，"
                  f"封存 {cat.get('scanned_activities')} 趟／{len(by_id)} 條路段）")
            return {seg["id"]: [
                {"date": e["date"], "start_time": e["start_time"],
                 "elapsed_sec": e["elapsed_sec"],
                 "elapsed_str": fmt_elapsed(e["elapsed_sec"] or 0)}
                for e in (by_id.get(seg["id"], {}).get("efforts") or [])
            ] for seg in data}
    print("（對帳基準：itt-segments.json 裡既有的 Strava 紀錄；"
          "跑過 scripts/harvest-strava.js 之後會自動改用更完整的封存檔）")
    return {seg["id"]: [e for e in (seg.get("efforts") or []) if e.get("source") != "fit"]
            for seg in data}


def compare(data, fit_efforts):
    """對帳：同一趟兩邊都有時，自建偵測器與 Strava 官方差幾秒。

    這是偵測器的驗收方式 —— 不是「有沒有抓到」，是「抓到的準不準」。
    寫入模式會把重複的 FIT 筆數 prune 掉（以官方為準），對帳要在 prune 之前做，
    所以獨立成一個 read-only 模式。
    """
    strava_by_seg = strava_side(data)
    rows, only_strava, only_fit = [], [], []
    for seg in data:
        strava = strava_by_seg.get(seg["id"]) or []
        mine = fit_efforts.get(seg["id"], [])
        matched_fit = set()
        for s in strava:
            hit = next((f for f in mine if same_effort(s, f)), None)
            if hit is None:
                only_strava.append((seg["name"], s))
                continue
            matched_fit.add(id(hit))
            rows.append((seg["name"], s.get("date"), s.get("start_time"),
                         s.get("elapsed_sec") or 0, hit["elapsed_sec"]))
        only_fit.extend((seg["name"], f) for f in mine if id(f) not in matched_fit)

    print("\n" + "=" * 74)
    print("對帳：自建 FIT 計時 vs Strava 官方（只列兩邊都有的那幾筆）")
    print("=" * 74)
    if not rows:
        print("  沒有可比對的重疊筆數。")
    else:
        print(f"  {'路段':<20} {'日期':<11} {'起跑':<6} {'Strava':>8} {'自建':>8} {'差':>7}")
        worst = 0.0
        for name, date, st, s_sec, f_sec in sorted(rows, key=lambda r: -abs(r[3] - r[4])):
            d = f_sec - s_sec
            worst = max(worst, abs(d))
            print(f"  {name[:18]:<20} {date:<11} {st or '—':<6} "
                  f"{s_sec:>8.1f} {f_sec:>8.1f} {d:>+7.1f}s")
        # 平均會被少數離群值主導（一筆差 400 秒就能把 400 筆的平均拉高一秒），
        # 中位數與「落在 ±2 秒內的比例」才看得出偵測器平常準不準。
        diffs = sorted(abs(r[4] - r[3]) for r in rows)
        mean_abs = sum(diffs) / len(diffs)
        med = diffs[len(diffs) // 2] if len(diffs) % 2 else (diffs[len(diffs)//2 - 1] + diffs[len(diffs)//2]) / 2
        within2 = sum(1 for d in diffs if d <= 2.0)
        within10 = sum(1 for d in diffs if d <= 10.0)
        print(f"\n  可比對 {len(rows)} 筆")
        print(f"    中位差 {med:.1f}s　·　平均差 {mean_abs:.2f}s　·　最大差 {worst:.1f}s")
        print(f"    ±2 秒內 {within2} 筆（{within2/len(diffs)*100:.1f}%）　·　"
              f"±10 秒內 {within10} 筆（{within10/len(diffs)*100:.1f}%）")

    # 「自建沒抓到」要先扣掉根本沒有 FIT 檔的年代，否則會把「檔案不存在」誤讀成「偵測失敗」。
    fits = sorted(f for f in os.listdir(FIT_DIR) if f.lower().endswith(".fit"))
    fit_from = fits[0][:10] if fits else "9999-99-99"
    pre_archive = [x for x in only_strava if (x[1].get("date") or "") < fit_from]
    in_archive = [x for x in only_strava if (x[1].get("date") or "") >= fit_from]
    print(f"\n  只有 Strava 有、自建沒抓到：{len(only_strava)} 筆")
    print(f"    其中 {len(pre_archive)} 筆早於 FIT 檔起始日 {fit_from}（本機沒有原始檔，不是偵測失敗）")
    print(f"    落在 FIT 檔涵蓋範圍內的真正漏抓：{len(in_archive)} 筆")
    for name, e in in_archive[:15]:
        print(f"    ⚠️  {name[:18]:<20} {e.get('date')} {e.get('start_time') or '—'} {e.get('elapsed_str')}")
    if len(in_archive) > 15:
        print(f"    …另外 {len(in_archive) - 15} 筆")

    print(f"\n  只有自建抓到、Strava 沒配對：{len(only_fit)} 筆")
    for name, e in only_fit[:15]:
        print(f"    {name[:18]:<20} {e.get('date')} {e.get('start_time') or '—'} {e.get('elapsed_str')}")
    if len(only_fit) > 15:
        print(f"    …另外 {len(only_fit) - 15} 筆")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="用 FIT 自建偵測器回補 ITT 成績")
    ap.add_argument("--dry-run", action="store_true", help="只印差異，不寫檔")
    ap.add_argument("--compare", action="store_true",
                    help="只對帳不寫檔：列出自建計時與 Strava 官方在同一筆上差幾秒")
    ap.add_argument("--only", nargs="+", metavar="SEG_ID", help="只處理這些路段編號")
    ap.add_argument("-q", "--quiet", action="store_true")
    args = ap.parse_args(argv)

    print(f"掃描 {FIT_DIR} …")
    fit_efforts = build_fit_efforts(only_ids=set(args.only) if args.only else None,
                                    verbose=not args.quiet)

    data = json.load(open(ITT_FILE, encoding="utf-8"))
    seed_missing(data)

    if args.compare:
        return compare(data, fit_efforts)

    # --only 沒指定就是全掃；有指定時，沒被掃到的路段不能動它既有的 FIT 成績
    scanned_ids = set(args.only) if args.only else None

    total_add = total_prune = 0
    for seg in data:
        mine = fit_efforts.get(seg["id"], [])
        before = len(seg.get("efforts") or [])
        scanned = scanned_ids is None or str(seg["id"]) in scanned_ids
        add, prune = merge(seg, mine, scanned=scanned, dry_run=args.dry_run)
        total_add += add
        total_prune += prune
        if add or prune:
            after = before + add - prune
            print(f"  {seg['id']} {seg['name']}：{before} → {after} 筆"
                  f"（新增 {add}{f'、清掉不再成立的舊 FIT 筆 {prune}' if prune else ''}）")

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
