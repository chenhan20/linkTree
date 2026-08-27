#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""室內騎乘的等效平路里程估算 → data/fit/_est_distance.json。

訓練台沒有速度感測（曲柄功率計只廣播功率與迴轉），FIT 裡的 distance 逐秒都是 0，
intervals 的 distance 也是 null。結果是室內的量在月里程、年里程上整個消失 ——
2026-08 到 8/27 為止有 5.5 小時室內，貢獻 0 公里。

做法：逐秒把功率反推成平路速度再積分（tools/tcx/analyze_tcx.py 的
speed_from_watts / flat_distance_m）。**全部當平路算** —— 室內本來就沒有地形，
Rouvy 的虛擬爬升不屬於他。

校準：參數用 solo_watts 的預設（CdA 0.36 / Crr 0.005 / rho 1.18），拿他自己的
戶外平路趟對過 —— 2026-07-15 / 08-05 / 08-13（3.4-5.1 m/km、27-51 km），
估算 ÷ 實際 = 1.05 / 0.96 / 1.00，平均 1.003。單趟誤差約 ±5%，總量幾乎無偏。

刻意**不用 Rouvy 回報的里程**：那是虛擬路線的距離，模型跟他的戶外不同口徑
（8/25 Rouvy 說 56.69 km、這裡估 51.15），而且 Strava 訂閱 2026-08-30 到期之後
就拿不到了。用自己的估算，室內外的公里數才是同一把尺，而且不會斷。

    python3 scripts/estimate-indoor-distance.py          # 只算還沒算過的
    python3 scripts/estimate-indoor-distance.py --all    # 全部重算
"""
import argparse
import glob
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools", "tcx"))
import analyze_tcx as A  # noqa: E402

FIT_DIR = os.path.join(ROOT, "data", "fit")
OUT = os.path.join(FIT_DIR, "_est_distance.json")
RIDE_TYPES = ("Ride", "VirtualRide", "GravelRide", "MountainBikeRide")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true", help="全部重算（改過模型參數才需要）")
    ap.add_argument("--weight", type=float, default=float(os.getenv("ATHLETE_WEIGHT", "80")))
    a = ap.parse_args()

    try:
        acts = json.load(open(os.path.join(FIT_DIR, "_activities.json"), encoding="utf-8"))
    except (OSError, ValueError):
        sys.exit("讀不到 data/fit/_activities.json，先跑 scripts/sync-intervals.py")
    try:
        out = {} if a.all else json.load(open(OUT, encoding="utf-8"))
    except (OSError, ValueError):
        out = {}
    out.pop("_note", None)

    done = new = 0
    for path in sorted(glob.glob(os.path.join(FIT_DIR, "*.fit"))):
        aid = os.path.basename(path).split("_")[1]
        meta = acts.get(aid) or {}
        if meta.get("type") not in RIDE_TYPES:
            continue
        if meta.get("distance"):          # intervals 已經有真實距離就不估
            continue
        done += 1
        if aid in out:
            continue
        try:
            r = A.analyze(path, ftp=238, weight=a.weight, height=173)
        except Exception as e:            # noqa: BLE001  單一壞檔不該拖垮整批
            print("  ⚠️ %s 估算失敗：%s" % (os.path.basename(path), e))
            continue
        t = r["totals"]
        if not t.get("distance_estimated"):
            continue
        out[aid] = {
            "date": str(meta.get("start_date_local", ""))[:10],
            "km": t["distance_km"],
            "avg_w": r["power"].get("avg_w"),
            "elapsed_sec": t["elapsed_sec"],
            "method": "flat_distance_m(cda=0.36,crr=0.005,rho=1.18)",
        }
        new += 1
        print("  %s  %6.2f km（估算）" % (out[aid]["date"], out[aid]["km"]))

    out["_note"] = ("估算值不是量測值。逐秒功率 → 平路速度 → 積分。"
                    "參數拿 2026-07-15/08-05/08-13 三趟戶外平路校準，平均比值 1.003、單趟 ±5%。")
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    open(OUT, "a", encoding="utf-8").write("\n")
    print("需要估算 %d 趟，本次新增 %d 趟 → %s" % (done, new, os.path.relpath(OUT, ROOT)))


if __name__ == "__main__":
    main()
