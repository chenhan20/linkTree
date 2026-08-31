#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build-segment-grades.py —— 從 data/fit/*.fit 算每條 ITT 路段的坡度剖面，寫出 data/segment-grades.json

輸出每條路段每 25 m 一格的「100 m 窗坡度」，前端（strava.html 的 tsvApplyFitGrades、
demo/itt-route-3d.html 的 applyFitGrades）用它同時餵三個地方：
燈絲上色、重播的坡度儀表、「最陡 100m」浮標——所以三者永遠是同一個數字。

為什麼不用 Strava 的高程：
  Strava 路段的 altitude stream **均坡是對的、局部坡度是錯的**。拿同一條路段的
  100 m 窗最陡去對帳（左＝Strava stream，右＝他自己的 FIT 氣壓高度）：

      碧山 全段          31.9%  →  15.4%
      碧山巖→停車廣場     31.6%  →  15.3%
      劍南路 至善側       24.5%  →   9.5%
      劍南路 北安路上     26.9%  →  10.5%
      中社路 4/4         23.7%  →   8.8%
      風櫃嘴 全段（對照）  12.9%  →  13.2%   ← 只有這條吻合

  風櫃嘴吻合、其餘全部高估 2–3 倍。差別不是點距（風櫃嘴 8.4 m/點一樣密），是路型：
  山壁上的窄路加髮夾彎，建立路段那位車友的軌跡一偏，Strava 的高程模型就抓到旁邊的坡面。
  同一份 stream 的 average_grade 跟 FIT 都吻合（碧山 9.1 vs 8.8），
  **所以不要因為均坡對就相信局部值**。

  meta.maximum_grade（Strava 自己的最陡）更不能用：碧山寫 43.6%，
  成功橋→大直橋那條河濱平路寫 34.1%。itt-config 的 maxGrade 也是同一份東西。

窗為什麼開 100 m：
  折線是每 ~25 m 一點、FIT 是每秒一點（爬坡約 2 m），窗開太短就是在量高度計的雜訊；
  100 m 是「騎起來感覺得到」的尺度，也是爬坡資料庫慣用的引用長度。

跟 backfill-itt-efforts.py 的關係：
  共用 tools/tcx 的同一套 effort 偵測器，所以「哪幾趟算數」兩邊一致。
  這支不打任何 API，改了演算法就重跑一次，整批歷史自動跟著修正。

用法：
  python3 scripts/build-segment-grades.py --dry-run     # 只印，不寫
  python3 scripts/build-segment-grades.py               # 寫出 data/segment-grades.json
  python3 scripts/build-segment-grades.py --only 7506566 641218
"""
import argparse
import bisect
import io
import json
import os
import sys
from datetime import datetime, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools", "tcx"))

from analyze_tcx import parse_ride                    # noqa: E402
import segments as segmod                             # noqa: E402

FIT_DIR = os.path.join(ROOT, "data", "fit")
CONFIG = os.path.join(ROOT, "data", "itt-config.json")
OUT = os.path.join(ROOT, "data", "segment-grades.json")

WINDOW_M = 100.0          # 總窗長；半窗 = WINDOW_M / 2
GRID_M = 25.0             # 逐趟先在這個間距上取樣，之後才跨趟對齊取中位數
MIN_ALT_POINTS = 20       # 一趟至少要這麼多個有高度的點才算數


def _median(xs):
    s = sorted(xs)
    n = len(s)
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2


def _cumdist(pts):
    """優先用 FIT 自己的 distance（輪徑／GPS 融合，比折線弦長準）；沒有才退回 haversine。"""
    if all(p.get("dist") is not None for p in pts):
        base = pts[0]["dist"]
        return [p["dist"] - base for p in pts]
    cum, last = [0.0], None
    for p in pts:
        if last is not None:
            cum.append(cum[-1] + segmod._haversine_m((last["lat"], last["lon"]), (p["lat"], p["lon"])))
        last = p
    return cum[: len(pts)]


# 氣壓高度計偶爾會跳一階（實測 2026-07-14 碧山 2913 m 處：3 m 的距離內高度 +18.2 m，
# 車速 0.5 m/s）。單一階就足以讓整條路段的最陡從 15% 變成 31%，
# 而 n 小的路段（南深路 2 趟、河濱10K 2 趟）中位數擋不住，所以先把階梯壓掉。
DESPIKE_GRADE = 0.50      # 逐點坡度超過 50% 一律當感測器跳階：沒有柏油路是這個坡度
DESPIKE_MAX_RUN_M = 20.0  # 而且只在很短的距離內發生才算跳階


def _despike(d, a):
    """把逐點的高度變化夾在 DESPIKE_GRADE 以內，回傳新的高度序列與被夾的次數。

    只夾「相鄰兩點」的落差，不動整體趨勢；因為最陡只看 100 m 窗內的高度差，
    夾完之後跨過那一階的窗就回到真實的坡度，其餘的窗完全不受影響。
    """
    out = [a[0]]
    fixed = 0
    for i in range(1, len(a)):
        run = d[i] - d[i - 1]
        step = a[i] - a[i - 1]
        cap = DESPIKE_GRADE * run
        if run < DESPIKE_MAX_RUN_M and abs(step) > cap:
            step = cap if step > 0 else -cap
            fixed += 1
        out.append(out[-1] + step)
    return out, fixed


def grade_profile(pts):
    """回傳 (每 GRID_M 公尺一格的 100 m 窗坡度%, 這趟的路段長度, 夾掉幾階)。

    取樣一律用**離起點的絕對距離**，不是「佔全段比例」。
    同一條路段每趟量到的長度會差幾個百分點（GPS、閘門插值、偶爾的漏點），
    照比例對齊等於把各趟的地形前後拉扯 —— 碧山最短 3553 m、最長 3774 m，
    差 6%，在 3.7 km 上就是 220 m 的錯位，一個 100 m 的陡點會被抹平掉。

    窗一律「rise 與 run 量同一段」；靠近頭尾時把窗整個推進路段內側，
    而不是讓它變成半邊窗——半邊窗量的是比較短的距離，兩者不能放在一起比大小。
    """
    d = _cumdist(pts)
    a = [p["alt"] for p in pts]
    if len(d) < 3 or d[-1] <= 0:
        return None
    a, fixed = _despike(d, a)
    L = d[-1]
    win = min(WINDOW_M, L)              # 比窗還短的路段就整條當一個窗
    out = []
    c = 0.0
    while c <= L + 1e-6:
        lo_m = min(max(c - win / 2, 0.0), L - win)
        lo = min(bisect.bisect_left(d, lo_m), len(d) - 1)
        hi = min(max(bisect.bisect_left(d, lo_m + win), lo + 1), len(d) - 1)
        run = d[hi] - d[lo]
        out.append((a[hi] - a[lo]) / run * 100 if run > 0 else 0.0)
        c += GRID_M
    return out, L, fixed


def main(argv=None):
    ap = argparse.ArgumentParser(description="從 FIT 算 ITT 路段的 100 m 窗最陡坡度")
    ap.add_argument("--dry-run", action="store_true", help="只印差異，不寫檔")
    ap.add_argument("--only", nargs="+", metavar="ID", help="只算這幾條路段")
    args = ap.parse_args(argv)
    only = set(args.only or [])

    segs = segmod.load_segments()
    if only:
        segs = {k: v for k, v in segs.items() if k in only}
        if not segs:
            raise SystemExit(f"--only 指定的路段都不在 segment-streams.json：{sorted(only)}")

    fits = sorted(f for f in os.listdir(FIT_DIR) if f.lower().endswith(".fit"))
    found = {}         # sid -> [每趟的坡度剖面（等長 list）, ...]
    despiked = 0       # 被夾掉的高度跳階總數（只是報給人看）
    print(f"掃 {len(fits)} 支 FIT × {len(segs)} 條路段……")
    for i, fname in enumerate(fits, 1):
        path = os.path.join(FIT_DIR, fname)
        try:
            _, _, points = parse_ride(path)
        except Exception as e:
            print(f"  ⚠️  跳過 {fname}：{str(e).splitlines()[-1][:90]}")
            continue
        gps = [p for p in points if p.get("lat") is not None and p.get("lon") is not None]
        if len(gps) < 2:
            continue
        # detect_efforts() 會自己再 parse 一次；這裡點已經在手上，直接借它的比對器省一半時間
        times = [p["t"] for p in gps]
        for seg in segs.values():
            for e in segmod._match_efforts(seg, gps, path):
                st = datetime.fromisoformat(e["start_time"])
                # 用時間切窗，不要用「點數 ≈ 秒數」——FIT 的 smart recording 不保證 1 Hz
                en = st + timedelta(seconds=e["elapsed_sec"])
                i0 = bisect.bisect_left(times, st)
                i1 = bisect.bisect_right(times, en)
                win = [p for p in gps[i0:i1] if p.get("alt") is not None]
                if len(win) < MIN_ALT_POINTS:
                    continue
                got = grade_profile(win)
                if got:
                    found.setdefault(str(seg["id"]), []).append((got[0], got[1]))
                    despiked += got[2]
        if i % 25 == 0:
            print(f"  … {i}/{len(fits)}")

    cfg = json.loads(io.open(CONFIG, encoding="utf-8").read())
    old_out = json.loads(io.open(OUT, encoding="utf-8").read()) if os.path.exists(OUT) else {}
    out = dict(old_out)          # --only 時保留沒點到的那些
    changed, missing = [], []
    for s in cfg["segments"]:
        if only and str(s["id"]) not in only:
            continue                      # --only 沒點到的路段連「找不到」都不用報
        runs = found.get(str(s["id"]))
        if not runs:
            missing.append(s["nameZh"])
            continue
        # 取「表現最接近中位數的那一趟」的剖面原封不動用，不做跨趟平均。
        # 試過逐點取中位數，結果把陡點抹平了：每趟量到的長度差幾個百分點，
        # 離起點越遠錯位越大，於是碧山全段 13.9% 反而低於它的子路段碧山巖→停車廣場 14.8%
        # ——父段不可能比子段平。改用中位數那一趟就沒有這個問題，
        # 而且輸出的是他真的騎過的一條剖面，不是合成出來的曲線。
        maxes = [max(g) for g, _ in runs]
        med = _median(maxes)
        grid, L = runs[min(range(len(runs)), key=lambda i: abs(maxes[i] - med))]
        prof = [round(g, 1) for g in grid]             # 直接輸出 GRID_M 格點，不再降取樣：
        peak = max(range(len(prof)), key=lambda j: prof[j])   # 降取樣會跳過峰值那一格，
        before = (old_out.get(str(s["id"])) or {}).get("max")  # 讓浮標讀到的數字低於實際
        out[str(s["id"])] = {
            "name": s["nameZh"],
            "step": GRID_M,                            # 格點間距（公尺），第 j 格 = 離起點 j*step
            "max": prof[peak],                         # 浮標的數字＝剖面的最大值，兩者保證一致
            "maxAt": round(peak / (len(prof) - 1), 3),  # 位置佔全段比例
            "n": len(runs),                            # 這條剖面背後有幾趟可以互相對帳
            "grade": prof,
        }
        spread = sorted(round(m, 1) for m in maxes)
        changed.append((s["nameZh"], before, prof[peak], len(runs), spread[0], spread[-1]))

    print(f"\n{'路段':<22}{'舊':>7}{'新':>7}{'趟數':>5}   各趟範圍")
    for name, before, now, n, lo, hi in changed:
        print(f"{name:<22}{('%.1f' % before) if before is not None else '—':>7}{now:>7.1f}{n:>5}   {lo}–{hi}%")
    if despiked:
        print(f"\n（過程中夾掉 {despiked} 個高度跳階：逐點坡度 > {DESPIKE_GRADE:.0%} 一律當感測器跳階）")
    if missing:
        print(f"\n⚠️  這 {len(missing)} 條在 FIT 裡找不到任何一趟，沒有寫入：")
        for m in missing:
            print("   ", m)

    if args.dry_run:
        print("\n[dry-run] 未寫檔。")
        return
    # 不縮排：這個檔是給程式讀的，而且會進 git（跟 segment-streams.json 同慣例）
    io.open(OUT, "w", encoding="utf-8").write(json.dumps(out, ensure_ascii=False))
    kb = os.path.getsize(OUT) / 1024
    print(f"\n✅ 寫入 {os.path.relpath(OUT, ROOT)}（{len(changed)} 條、{kb:.0f} KB）")


if __name__ == "__main__":
    main()
