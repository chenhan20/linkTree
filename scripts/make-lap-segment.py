#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
make-lap-segment.py —— 把某趟 FIT 的第 N 圈（LAP）切成一條自訂 ITT 路段

Strava 已經不用了，路段也不再靠 Strava 建。這支從你自己按的 LAP 切出參考折線，
寫進 data/segment-streams.json（偵測器的參考折線，端點即計時閘門）與 data/itt-config.json
（路段設定與群組），之後 backfill-itt-efforts.py 會把歷史每一趟走過同一條路的 FIT
都配進來，ITT 頁就有排行榜；往後新的騎乘也會自動計時。

自訂路段的 id 從 9_000_000_001 起算，避開 Strava 的 segment id（目前都在 10 億以下）。
設定裡會標 "custom": true 與來源 FIT／圈號，方便日後辨認、重建。

閘門就是那一圈的起點與終點。LAP 是手按的，所以起終點會落在你按鍵的位置：
一條想長期比較的路段，建好後請看一下兩端是不是你想要的位置，不是就改用別趟、別圈重建
（--replace 會覆蓋同 id）。

用法：
  python3 scripts/make-lap-segment.py --fit data/fit/2026-10-20_i199277427_內湖區-公路車.fit --lap 2 \\
      --name 露營場 --label 全段 --dry-run
  python3 scripts/make-lap-segment.py --fit … --lap 2 --name 露營場 --label 全段      # 寫入
接著（三步都不打 Strava，CI 的 fit-sync 只會自動做第一步，後兩步要手動補一次）：
  python3 scripts/backfill-itt-efforts.py --only <新 id>     # 歷史成績；之後每趟新騎乘 CI 自動配
  python3 scripts/build-segment-grades.py --only <新 id>     # 坡度剖面
  node scripts/fetch-segment-terrain.js                      # 3D 測量檯的地形（AWS 公開圖磚；沒補畫面是空的）
"""
import argparse
import io
import json
import math
import os
import sys
from datetime import timedelta

import fitdecode

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools", "tcx"))
from analyze_tcx import parse_ride  # noqa: E402
import segments as segmod           # noqa: E402

STREAMS = os.path.join(ROOT, "data", "segment-streams.json")
CONFIG = os.path.join(ROOT, "data", "itt-config.json")
CUSTOM_ID_BASE = 9_000_000_001
TARGET_PTS = 140          # 跟 fetch-segment-streams.js 一致：瀏覽器每次開頁都要下載這個檔


def read_laps(fit):
    laps = []
    with fitdecode.FitReader(fit) as r:
        for fr in r:
            if isinstance(fr, fitdecode.FitDataMessage) and fr.name == "lap":
                laps.append({f.name: f.value for f in fr.fields})
    return laps


def cum_dist(pts):
    kx, ky = segmod._local_scale(pts[0]["lat"])
    out = [0.0]
    for a, b in zip(pts, pts[1:]):
        out.append(out[-1] + math.hypot((b["lon"] - a["lon"]) * kx, (b["lat"] - a["lat"]) * ky))
    return out


def resample(pts, n):
    """沿路徑等距取 n 點（含頭尾）。高度用相鄰兩點內插，座標 5 位小數、高度 1 位小數。"""
    d = cum_dist(pts)
    L = d[-1]
    out, j = [], 0
    for i in range(n):
        target = L * i / (n - 1)
        while j < len(d) - 2 and d[j + 1] < target:
            j += 1
        span = d[j + 1] - d[j] or 1.0
        f = min(max((target - d[j]) / span, 0.0), 1.0)
        a, b = pts[j], pts[j + 1]
        out.append([round(a["lat"] + (b["lat"] - a["lat"]) * f, 5),
                    round(a["lon"] + (b["lon"] - a["lon"]) * f, 5),
                    round(a["alt"] + (b["alt"] - a["alt"]) * f, 1)])
    return out, L


def steepest_100m(pts, d):
    """100 m 窗最陡坡度%，跟 build-segment-grades.py 同一個定義（拿它的 despike 後的高度）。"""
    best, j = -99.0, 0
    for i in range(len(d)):
        while j < len(d) - 1 and d[j] - d[i] < 100.0:
            j += 1
        run = d[j] - d[i]
        if run >= 90.0:
            best = max(best, (pts[j]["alt"] - pts[i]["alt"]) / run * 100)
    return best


def profile_points(alts, n=11):
    """坡度示意點：x = 距離 %，y = 0（最高）到 40（最低），跟既有四條的畫法一致。"""
    lo, hi = min(alts), max(alts)
    out = []
    for i in range(n):
        k = round(i * (len(alts) - 1) / (n - 1))
        y = 40 - (alts[k] - lo) / ((hi - lo) or 1) * 37
        out.append([round(i * 100 / (n - 1), 1), round(y, 1)])
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--fit", required=True)
    ap.add_argument("--lap", type=int, required=True, help="第幾圈（從 1 算）")
    ap.add_argument("--name", required=True, help="路段母名，例如 露營場")
    ap.add_argument("--label", default="全段", help="在群組卡裡顯示的短名")
    ap.add_argument("--id", type=int, help=f"預設取下一個自訂 id（從 {CUSTOM_ID_BASE} 起）")
    ap.add_argument("--group", help="群組 id；預設用 custom-<id>，會自動建群組")
    ap.add_argument("--type", default="CLIMB", choices=["CLIMB", "SPRINT", "ENDURANCE"])
    ap.add_argument("--accent", default="#8fd694")
    ap.add_argument("--note", default="")
    ap.add_argument("--replace", action="store_true", help="同 id 已存在時覆蓋")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    fit = os.path.abspath(a.fit)
    laps = read_laps(fit)
    if not 1 <= a.lap <= len(laps):
        sys.exit(f"這支 FIT 只有 {len(laps)} 圈，沒有第 {a.lap} 圈")
    lap = laps[a.lap - 1]
    st = lap["start_time"]
    en = st + timedelta(seconds=lap["total_elapsed_time"])

    _, _, points = parse_ride(fit)
    raw = [p for p in points if st <= p["t"] <= en
           and p.get("lat") is not None and p.get("lon") is not None and p.get("alt") is not None]
    if len(raw) < 50:
        sys.exit(f"第 {a.lap} 圈只有 {len(raw)} 個帶高度的定位點，不夠切路段")

    # 先壓掉氣壓計跳階（沿用 build-segment-grades.py 的做法），再取折線
    import importlib.util
    spec = importlib.util.spec_from_file_location("bsg", os.path.join(ROOT, "scripts", "build-segment-grades.py"))
    bsg = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bsg)
    d = cum_dist(raw)
    alts, fixed = bsg._despike(d, [p["alt"] for p in raw])
    pts = [dict(p, alt=alt) for p, alt in zip(raw, alts)]

    poly, L = resample(pts, TARGET_PTS)
    rise = pts[-1]["alt"] - pts[0]["alt"]
    avg = rise / L * 100
    mx = steepest_100m(pts, d)
    gross_up = sum(max(0, b - a_) for a_, b in zip(alts, alts[1:]))

    streams = json.load(io.open(STREAMS, encoding="utf-8"))
    cfg = json.load(io.open(CONFIG, encoding="utf-8"))
    sid = a.id
    if sid is None:
        used = [int(k) for k in streams if int(k) >= CUSTOM_ID_BASE] + \
               [s["id"] for s in cfg["segments"] if s["id"] >= CUSTOM_ID_BASE]
        sid = max(used, default=CUSTOM_ID_BASE - 1) + 1
    exists = str(sid) in streams or any(s["id"] == sid for s in cfg["segments"])
    if exists and not a.replace:
        sys.exit(f"id {sid} 已存在；要覆蓋請加 --replace")

    full_name = f"{a.name} {a.label}"
    group = a.group or f"custom-{sid}"
    source = f"{os.path.basename(fit)}#lap{a.lap}"
    seg = {
        "id": sid, "group": group, "nameZh": full_name, "label": a.label, "nameApi": full_name,
        "type": a.type, "accent": a.accent, "note": a.note or f"自訂路段，由 {source} 切出。",
        "avgGrade": round(avg, 1), "maxGrade": round(mx, 1), "profile": profile_points([p[2] for p in poly]),
        "custom": True, "source": source,
    }

    print(f"{full_name}  id {sid}  group {group}")
    print(f"  來源 {source}  本地 {(st + timedelta(hours=8)):%H:%M:%S}–{(en + timedelta(hours=8)):%H:%M:%S}")
    print(f"  長度 {L:.0f} m | 淨爬升 {rise:+.1f} m（累積 {gross_up:.0f} m）| 均坡 {avg:.1f}% | 最陡 100 m {mx:.1f}% | 壓掉跳階 {fixed}")
    print(f"  起點 {poly[0][0]},{poly[0][1]} 海拔 {poly[0][2]} m  終點 {poly[-1][0]},{poly[-1][1]} 海拔 {poly[-1][2]} m")
    if a.dry_run:
        print("（dry-run，沒寫檔）")
        return

    streams[str(sid)] = {"name": full_name, "pts": poly}
    cfg["segments"] = [s for s in cfg["segments"] if s["id"] != sid] + [seg]
    if not any(g["id"] == group for g in cfg["groups"]):
        cfg["groups"].append({"id": group, "nameZh": a.name, "type": a.type, "accent": a.accent,
                              "note": a.note or f"自訂路段，由 {source} 切出。"})
    with io.open(STREAMS, "w", encoding="utf-8") as f:
        json.dump(streams, f, separators=(",", ":"), ensure_ascii=False)
    with io.open(CONFIG, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)
    print(f"已寫入 {os.path.relpath(STREAMS, ROOT)} 與 {os.path.relpath(CONFIG, ROOT)}")
    print(f"下一步：backfill-itt-efforts.py --only {sid}、build-segment-grades.py --only {sid}、node scripts/fetch-segment-terrain.js")


if __name__ == "__main__":
    main()
