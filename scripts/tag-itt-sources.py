#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""tag-itt-sources.py —— 補齊 ITT 成績的來源標記，並把 itt-segments.json 併回 strava.json

為什麼需要這支：

  ① 來源標記
     2026-08-14 以前寫入的 effort 沒有 `source` 欄位，因為那時候只有一個來源。
     現在有兩個：Strava 官方配對（付費功能）與自建 FIT 偵測器（`source: "fit"`）。
     沒有標記的舊資料一律是 Strava 來的 —— 自建偵測器從第一天就會寫 "fit"。
     標記補上去之後，前端才分得出哪一筆是官方計時、哪一筆是我自己算的。

  ② 兩份檔案的漂移
     儀表板讀的是 data/strava.json，FIT 回補寫的是 data/itt-segments.json。
     scripts/fetch-strava.js 每次跑都會把後者併回前者，但那支要 Strava token，
     而且 Strava 這條路已經棄用。結果就是：FIT 回補的成績躺在 itt-segments.json，
     畫面卻是空的 —— 三條新路段實測就是這樣（itt 有 10 筆、strava.json 只有 1 筆）。
     這支把 union merge 做完，不需要任何 API。

  effort 身分用自然鍵（date + start_time），不是 activity_id：
  同一趟刷四次中社是四筆，activity_id 全一樣。FIT 來源的 activity_id 更是 null。

用法：
  python3 scripts/tag-itt-sources.py            # 寫入
  python3 scripts/tag-itt-sources.py --dry-run  # 只印差異
"""
import argparse
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ITT_FILE = os.path.join(ROOT, "data", "itt-segments.json")
STRAVA_FILE = os.path.join(ROOT, "data", "strava.json")

# 起跑時刻差這麼多以內視為同一筆（跟 backfill-itt-efforts.py 同一個容忍度）
SAME_START_TOL_SEC = 90


def start_sec(e):
    st = e.get("start_time")
    if not st or ":" not in st:
        return None
    parts = st.split(":")
    try:
        return int(parts[0]) * 3600 + int(parts[1]) * 60 + (int(float(parts[2])) if len(parts) > 2 else 0)
    except ValueError:
        return None


def same_effort(a, b):
    if (a.get("date") or "") != (b.get("date") or ""):
        return False
    ka, kb = start_sec(a), start_sec(b)
    if ka is not None and kb is not None:
        return abs(ka - kb) <= SAME_START_TOL_SEC
    return abs((a.get("elapsed_sec") or 0) - (b.get("elapsed_sec") or 0)) <= 8


def tag(efforts):
    """回傳補了幾筆 source。沒有 source 的一律是 Strava 時代的紀錄。"""
    n = 0
    for e in efforts:
        if not e.get("source"):
            e["source"] = "strava"
            n += 1
    return n


def sort_efforts(efforts):
    efforts.sort(key=lambda e: f"{e.get('date','')} {e.get('start_time') or '00:00'}", reverse=True)


def main(argv=None):
    ap = argparse.ArgumentParser(description="補 ITT 成績來源標記 + 併回 strava.json")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)

    itt = json.load(open(ITT_FILE, encoding="utf-8"))
    tagged = sum(tag(s.get("efforts") or []) for s in itt)
    print(f"itt-segments.json：補上 source='strava' 共 {tagged} 筆")

    if not os.path.exists(STRAVA_FILE):
        print("⚠️  找不到 data/strava.json，只處理 itt-segments.json")
        strava = None
    else:
        strava = json.load(open(STRAVA_FILE, encoding="utf-8"))
        main_segs = strava.get("segments") or []
        by_id = {s.get("id"): s for s in main_segs}
        tag(sum((s.get("efforts") or [] for s in main_segs), []))

        merged_total = 0
        for itt_seg in itt:
            dst = by_id.get(itt_seg["id"])
            if dst is None:
                main_segs.append(json.loads(json.dumps(itt_seg, ensure_ascii=False)))
                merged_total += len(itt_seg.get("efforts") or [])
                print(f"  + {itt_seg['id']} {itt_seg['name']}：strava.json 沒有這條，整段補上"
                      f"（{len(itt_seg.get('efforts') or [])} 筆）")
                continue
            # 路段 metadata 以 itt-segments.json 為準（它是 fetch-strava.js 的完整副本，
            # 且之後又被 FIT 回補加過料）。
            #
            # efforts 分兩種來源處理，不能一律 union：
            #   ‧ source='fit' —— itt-segments.json 是唯一權威，整批取代。
            #     union 會留下幽靈：偵測器修正後某筆的起跑時刻變了，舊的那筆在
            #     strava.json 裡永遠刪不掉，同一趟就變成兩列（實測 2025-10-29 河濱10K）。
            #   ‧ Strava 來源 —— 走 union，因為 strava.json 可能有 itt 還沒收到的。
            existing = [e for e in (dst.get("efforts") or []) if e.get("source") != "fit"]
            before = len(dst.get("efforts") or [])
            for e in itt_seg.get("efforts") or []:
                if not any(same_effort(e, x) for x in existing):
                    existing.append(json.loads(json.dumps(e, ensure_ascii=False)))
            sort_efforts(existing)
            for k, v in itt_seg.items():
                if k != "efforts":
                    dst[k] = v
            dst["efforts"] = existing
            if len(existing) != before:
                merged_total += len(existing) - before
                print(f"  ~ {itt_seg['id']} {itt_seg['name']}：{before} → {len(existing)} 筆")
        strava["segments"] = main_segs
        print(f"strava.json：淨變動 {merged_total:+d} 筆"
              f"（負數 = 清掉偵測器修正後不再成立的舊筆）")

    for seg in itt:
        sort_efforts(seg.get("efforts") or [])

    if args.dry_run:
        print("\n[dry-run] 未寫檔。")
        return 0

    with open(ITT_FILE, "w", encoding="utf-8") as f:
        json.dump(itt, f, ensure_ascii=False, indent=2)
        f.write("\n")
    if strava is not None:
        # 不補結尾換行 —— fetch-strava.js 的 JSON.stringify 沒有，補了每次同步都多一行 diff
        with open(STRAVA_FILE, "w", encoding="utf-8") as f:
            json.dump(strava, f, ensure_ascii=False, indent=2)
    print("\n✅ 寫入完成。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
