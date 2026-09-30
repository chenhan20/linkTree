#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""build-distance-prs.py —— 各距離的「最快連續 N 公里」→ data/distance-prs.json

Strava 的 Best Efforts 那一類功能：一趟騎乘裡，任何連續的 5／10／20／… 公里，最快的那一段
花了多久。跟 ITT 路段不同，它不綁地點，是「這一趟裡跑得最順的 N 公里」；跟功率 PR
（scan-power-prs.js）也不同，它比的是**速度**。

算法：對 1 Hz 的累計里程做雙指標滑窗，起點掃過每一秒，終點用線性內插落在剛好 +N 公里那一秒。
時間用**經過時間**（含窗內的停等），所以窗內遇紅燈就是被扣時間，最佳窗自然會避開停等。
一趟只留每個距離的最佳一窗（Strava 也是每筆活動一個），再跨趟排名。

只算戶外：要有 GPS，而且 intervals 的活動類型不是 VirtualRide。Rouvy 匯出的 FIT 帶的是
虛擬路線的座標，光看有沒有 GPS 擋不住（2026-08-19 那筆就混進來過，前端先發現的）；
室內訓練台的距離是虛擬或推估的，也不進榜。

**主榜只收「平路窗」**：窗頭窗尾的淨海拔差必須在 ±3 m／km 以內（20 km ≤ ±60 m）。
不濾的話 5 km、10 km 的榜首全是下坡（2026-09-30 實測：最快 5 km 是淨降 254 m 的 6:17，
均瓦 90），那是地形不是體能。Strava 不濾；這裡濾，但原始最快另外留在 raw_best，
頁面可以並排講「含下坡是 X」。窗內有爬有降但淨差在範圍內的照收——那是真的騎過的路。

每個最佳窗另外帶三個「誠實欄位」，因為速度榜最容易被便宜拿走：
  ‧ elev_net_m   窗頭窗尾的淨海拔差（負的＝整段在下坡）
  ‧ elev_gain_m  窗內累計爬升
  ‧ draft_pct    窗內平路時段「功率明顯低於單騎所需」的比例（跟報告的跟車指標同一把尺；
                 窗太短、平路格子不到 4 個就是 null）
他的河濱 PR 幾乎都是團騎堆出來的（docs／記憶：riverside-itt-prs-are-group-rides），
所以不帶這欄，一個 60% 跟車的 20 公里會跟單騎的並排，看起來一樣。

資料範圍：只有 data/fit/ 裡的手錶 FIT（2025-08-12 起）。更早的 Strava 活動沒有里程串流，
進不了榜——頁面上要明講起點日期，不要寫「歷年」。

快取：data/fit/_distance_efforts.json（增量，鍵是檔名＋大小；室內／非騎車也記成 skip，不重讀）。

用法：
  python3 scripts/build-distance-prs.py            # 增量
  python3 scripts/build-distance-prs.py --rebuild  # 全部重算（改了距離清單或算法之後）
"""
import argparse
import json
import os
import re
import sys
from datetime import timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools", "tcx"))
import analyze_tcx as A  # noqa: E402

FIT_DIR = os.path.join(ROOT, "data", "fit")
CACHE = os.path.join(FIT_DIR, "_distance_efforts.json")
OUT = os.path.join(ROOT, "data", "distance-prs.json")
RIDES_DIR = os.path.join(ROOT, "rides")
TPE = timezone(timedelta(hours=8))

DISTANCES_KM = [5, 10, 20, 30, 40, 50, 100]
MIN_RIDES = 3          # 少於這麼多趟符合的距離不排榜（一趟自己贏自己沒有意義）
TOP_N = 10
LEVEL_M_PER_KM = 3.0   # 平路窗：頭尾淨海拔差不超過 ±3 m／km（0.3% 平均坡度）
MAX_KMH = 65.0         # 窗內平均時速超過這個一定是 GPS／里程跳點，丟掉那一窗
CACHE_VERSION = 2


def virtual_ids():
    """intervals 標成 VirtualRide 的活動 id（Rouvy 等）。_activities.json 讀不到就回空集合，
    改靠檔名裡的 ROUVY 字樣兜底。"""
    try:
        acts = json.load(open(os.path.join(FIT_DIR, "_activities.json"), encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return set()
    return {k for k, v in acts.items() if str((v or {}).get("type") or "").startswith("Virtual")}


def is_virtual(fname, vids):
    m = re.search(r"_(i\d+)_", fname)
    return bool((m and m.group(1) in vids) or "rouvy" in fname.lower())


def fmt(sec):
    s = int(round(sec))
    h, rem = divmod(s, 3600)
    m, ss = divmod(rem, 60)
    return f"{h}:{m:02d}:{ss:02d}" if h else f"{m}:{ss:02d}"


def best_window(d, target_m, alt=None, tol_m=None):
    """d：每秒的累計里程（公尺，單調不減）。回傳 (經過秒數, 起點索引, 終點索引)；不夠長回 None。
    alt／tol_m 都給時，只考慮頭尾淨海拔差 ≤ tol_m 的窗。"""
    n = len(d)
    best = None
    j = 0
    for i in range(n):
        goal = d[i] + target_m
        if j < i:
            j = i
        while j < n and d[j] < goal:
            j += 1
        if j >= n:
            break
        if alt is not None and tol_m is not None and abs(alt[j] - alt[i]) > tol_m:
            continue
        prev = d[j - 1] if j > 0 else d[j]
        te = j if d[j] == prev else (j - 1) + (goal - prev) / (d[j] - prev)
        el = te - i
        if best is None or el < best[0]:
            best = (el, i, j)
    return best


def smooth_alt(pts, half=5):
    """海拔往前填、取 ±half 秒的移動平均，讓頭尾淨差不被單點雜訊左右。"""
    a, cur = [], None
    for p in pts:
        v = p.get("alt")
        if v is not None:
            cur = v
        a.append(cur)
    first = next((v for v in a if v is not None), 0.0)
    a = [first if v is None else v for v in a]
    cs = [0.0]
    for v in a:
        cs.append(cs[-1] + v)
    n = len(a)
    return [(cs[min(n, k + half + 1)] - cs[max(0, k - half)]) / (min(n, k + half + 1) - max(0, k - half)) for k in range(n)]


def monotone(dist):
    """里程偶爾會倒退或缺值：往前填、取累計最大值。"""
    out, cur = [], 0.0
    for v in dist:
        if v is not None and v > cur:
            cur = v
        out.append(cur)
    return out


def analyse(fit_path, weight=80.0):
    """回傳 None（室內／非騎車／壞檔）或 dict。"""
    try:
        meta, _laps, raw = A.parse_ride(fit_path)
    except Exception:  # noqa: BLE001 — 壞檔不該讓整批停下來
        return None
    sport = str((meta or {}).get("sport") or "")
    if sport and sport.lower() not in ("cycling", "biking", "ride"):
        return None
    pts = A.resample_1hz(raw)
    if len(pts) < 600:
        return None
    gps = sum(1 for p in pts if p.get("lat") is not None and p.get("lon") is not None)
    if gps < len(pts) * 0.8:
        return None
    d = monotone([p.get("dist") for p in pts])
    total_m = d[-1] - d[0]
    if total_m < 5000:
        return None
    t0 = pts[0]["t"].astimezone(TPE)
    alt = smooth_alt(pts)
    out = {
        "date": t0.strftime("%Y-%m-%d"),
        "start_hm": t0.strftime("%H:%M"),
        "ride_km": round(total_m / 1000, 2),
        "efforts": {},       # 平路窗（主榜）
        "raw": {},           # 不濾地形的最快窗；跟平路窗同一窗時省略
    }

    def stats(w, km):
        el, i, j = w
        kmh = km * 3600.0 / el
        if kmh > MAX_KMH:
            return None
        seg = pts[i:j + 1]
        watts = [p["w"] for p in seg if p.get("w") is not None]
        hrs = [p["hr"] for p in seg if p.get("hr")]
        up, _dn = A.elevation_gain([p["alt"] for p in seg])
        draft = None
        try:
            cells, _, _ = A._ride_cells(seg, 250.0, weight)
            ds = A.draft_summary(cells, weight + 8.0)
            if ds and ds.get("cells", 0) >= 4:
                draft = {"pct": ds["draft_pct"], "median_ratio": ds["median_ratio"]}
        except Exception:  # noqa: BLE001 — 跟車指標算不出來不該擋掉成績本身
            draft = None
        return {
            "elapsed_sec": round(el, 1),
            "start_km": round((d[i] - d[0]) / 1000, 2),
            "start_hm": (pts[i]["t"].astimezone(TPE)).strftime("%H:%M"),
            "avg_kmh": round(kmh, 2),
            "avg_w": round(sum(watts) / len(watts)) if watts else None,
            "avg_hr": round(sum(hrs) / len(hrs)) if hrs else None,
            "elev_gain_m": round(up),
            "elev_net_m": round(alt[j] - alt[i]),
            "draft_pct": draft["pct"] if draft else None,
            "draft_ratio": draft["median_ratio"] if draft else None,
        }

    for km in DISTANCES_KM:
        if total_m < km * 1000:
            continue
        lv = best_window(d, km * 1000.0, alt, LEVEL_M_PER_KM * km)
        raw = best_window(d, km * 1000.0)
        if lv:
            st = stats(lv, km)
            if st:
                out["efforts"][str(km)] = st
        if raw and (not lv or (raw[1], raw[2]) != (lv[1], lv[2])):
            st = stats(raw, km)
            if st:
                out["raw"][str(km)] = st
    return out


def load_cache(rebuild):
    if rebuild or not os.path.exists(CACHE):
        return {"version": CACHE_VERSION, "distances_km": DISTANCES_KM, "rides": {}}
    try:
        c = json.load(open(CACHE, encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"version": CACHE_VERSION, "distances_km": DISTANCES_KM, "rides": {}}
    if c.get("version") != CACHE_VERSION or c.get("distances_km") != DISTANCES_KM:
        return {"version": CACHE_VERSION, "distances_km": DISTANCES_KM, "rides": {}}
    return c


def compile_output(cache):
    rides = []
    for name, r in cache["rides"].items():
        if r and r.get("efforts"):
            rides.append((name, r))
    rides.sort(key=lambda x: (x[1]["date"], x[1]["start_hm"]))
    latest_name, latest = rides[-1] if rides else (None, None)

    distances = []
    for km in DISTANCES_KM:
        rows = []
        for name, r in rides:
            e = r["efforts"].get(str(km))
            if e:
                rows.append({"fit": name, "date": r["date"], "ride_km": r["ride_km"], "ride_start_hm": r["start_hm"], **e})
        if len(rows) < MIN_RIDES:
            continue
        ranked = sorted(rows, key=lambda x: x["elapsed_sec"])
        for k, row in enumerate(ranked, 1):
            row["rank"] = k
            row["elapsed_str"] = fmt(row["elapsed_sec"])
            row["report"] = f"rides/{row['date']}.html" if os.path.exists(os.path.join(RIDES_DIR, f"{row['date']}.html")) else None
        # 紀錄簿：依時間順序，每次刷新最快紀錄的那一筆
        history, best = [], None
        for row in rows:
            if best is None or row["elapsed_sec"] < best:
                best = row["elapsed_sec"]
                history.append({"date": row["date"], "elapsed_sec": row["elapsed_sec"], "elapsed_str": fmt(row["elapsed_sec"]),
                                "avg_kmh": row["avg_kmh"], "draft_pct": row["draft_pct"]})
        me = next((x for x in ranked if x["fit"] == latest_name), None)
        raws = []
        for name, r in rides:
            e = r.get("raw", {}).get(str(km))
            if e:
                raws.append({"fit": name, "date": r["date"], "ride_km": r["ride_km"], **e, "elapsed_str": fmt(e["elapsed_sec"])})
        raw_best = min(raws, key=lambda x: x["elapsed_sec"]) if raws else None
        # 只有原始最快真的比平路榜首快、而且是靠地形（淨降）時才留，否則不用多講
        if raw_best and not (raw_best["elapsed_sec"] < ranked[0]["elapsed_sec"] * 0.99):
            raw_best = None
        distances.append({
            "km": km,
            "label": f"{km} km",
            "n": len(rows),
            "best": ranked[0],
            "top": ranked[:TOP_N],
            "raw_best": raw_best,
            "history": history,
            "latest": ({"date": me["date"], "rank": me["rank"], "of": len(rows), "elapsed_str": me["elapsed_str"],
                        "is_pr": me["rank"] == 1} if me else None),
        })

    dates = [r["date"] for _n, r in rides]
    latest_prs = []
    if latest:
        for d in distances:
            lt = d["latest"]
            if lt and lt["rank"] <= 3:
                latest_prs.append({"km": d["km"], "rank": lt["rank"], "of": lt["of"], "elapsed_str": lt["elapsed_str"]})
    return {
        "updated_at": __import__("datetime").datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "method": "連續 N 公里的最快經過時間（含窗內停等）；每趟每個距離只留最佳一窗；只算有 GPS 的戶外騎乘；主榜只收頭尾淨海拔差在 ±3 m/km 內的平路窗",
        "coverage": {
            "from": dates[0] if dates else None,
            "to": dates[-1] if dates else None,
            "rides": len(rides),
            "level_rule_m_per_km": LEVEL_M_PER_KM,
            "note": "只有手錶 FIT（2025-08-12 起）；更早的 Strava 活動沒有里程串流，不在榜內",
        },
        "latest_ride": ({"date": latest["date"], "ride_km": latest["ride_km"], "podium": latest_prs} if latest else None),
        "distances": distances,
    }


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--rebuild", action="store_true")
    ap.add_argument("--weight", type=float, default=float(os.environ.get("ATHLETE_WEIGHT") or 80.0))
    ap.add_argument("-q", "--quiet", action="store_true")
    a = ap.parse_args(argv)

    cache = load_cache(a.rebuild)
    fits = sorted(f for f in os.listdir(FIT_DIR) if f.lower().endswith(".fit") and not f.startswith("_"))
    stale = [n for n in cache["rides"] if n not in fits]
    for n in stale:
        del cache["rides"][n]
    vids = virtual_ids()
    todo = []
    for f in fits:
        size = os.path.getsize(os.path.join(FIT_DIR, f))
        c = cache["rides"].get(f)
        if is_virtual(f, vids):
            # 已經算進去過的也要撤掉（快取是按檔案大小判斷新舊，不會自己發現類型變了）
            if c is None or not c.get("skip"):
                cache["rides"][f] = {"size": size, "skip": True, "why": "virtual"}
            continue
        if c is not None and c.get("size") == size:
            continue
        todo.append((f, size))
    added = skipped = 0
    for f, size in todo:
        res = analyse(os.path.join(FIT_DIR, f), a.weight)
        if res is None:
            cache["rides"][f] = {"size": size, "skip": True}
            skipped += 1
            continue
        res["size"] = size
        cache["rides"][f] = res
        added += 1
        if not a.quiet:
            e20 = res["efforts"].get("20")
            print(f"  {res['date']} {res['ride_km']:6.1f} km" + (f"  20 km {fmt(e20['elapsed_sec'])} ({e20['avg_kmh']:.1f} km/h)" if e20 else ""), flush=True)

    with open(CACHE, "w", encoding="utf-8") as fh:
        json.dump(cache, fh, ensure_ascii=False, separators=(",", ":"))
    out = compile_output(cache)
    # 內容沒變就不重寫（updated_at 每次都不同，照寫的話 CI 每班都會多一個 commit）
    try:
        old = json.load(open(OUT, encoding="utf-8"))
        if {k: v for k, v in old.items() if k != "updated_at"} == {k: v for k, v in out.items() if k != "updated_at"}:
            out["updated_at"] = old.get("updated_at", out["updated_at"])
    except (OSError, json.JSONDecodeError):
        pass
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
    print(f"✅ 寫入 data/distance-prs.json：{out['coverage']['rides']} 趟戶外騎乘、"
          f"{len(out['distances'])} 個距離（新算 {added}、略過 {skipped}、清掉 {len(stale)}）")


if __name__ == "__main__":
    main()
