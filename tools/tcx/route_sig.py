#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""route_sig.py — 一趟戶外騎乘的「路線簽章」與當趟的計時路段

報告的「同一條路線」章靠這裡認出以前騎過同一圈的日子：起點座標、距離、經過的
ITT 路段組合。簽章由 scripts/build-route-signatures.py 批次算好快取在
data/fit/_routes.json；render_dashboard.py 讀快取，沒有的話拿 FIT 現算。

當趟的計時路段也在這裡偵測（detect_ride_efforts）。為什麼不直接讀
data/itt-segments.json：管線裡「產報告」排在「ITT 回補」前面（CI 也是，回補刻意
放在 pull 之後另開 commit），新報告產出的當下當天的成績還沒進檔案，等回補完報告
也不會重生。所以當天的成績從 FIT 現算，歷史排名才從成績檔查。
"""
import json
import os
import sys
from datetime import timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
import analyze_tcx as A  # noqa: E402
from segments import detect_efforts, load_segments  # noqa: E402

ROUTES_FILE = os.path.join(ROOT, "data", "fit", "_routes.json")
ITT_FILE = os.path.join(ROOT, "data", "itt-segments.json")
TPE = timezone(timedelta(hours=8))

# 同路線的判定：起點差 ±0.012°（約 1.3 km，容許從公司或家門口出發的差別）、
# 經過的 ITT 路段組合完全相同、距離 ±5%；沒有任何路段的路線再加爬升 ±30%。
START_TOL_DEG = 0.012
KM_TOL = 0.05
ELEV_TOL = 0.30


def load_routes():
    try:
        with open(ROUTES_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}


def save_routes(routes):
    with open(ROUTES_FILE, "w", encoding="utf-8") as f:
        json.dump(routes, f, ensure_ascii=False, indent=1, sort_keys=True)
        f.write("\n")


def _fmt(sec):
    s = int(round(sec))
    h, rem = divmod(s, 3600)
    m, ss = divmod(rem, 60)
    return f"{h}:{m:02d}:{ss:02d}" if h else f"{m}:{ss:02d}"


def signature(fit_path, weight=80.0):
    """算一趟的簽章；室內／沒功率／沒 GPS／不是騎車 → None。"""
    try:
        meta, laps, raw = A.parse_ride(fit_path)
    except Exception:  # noqa: BLE001 — 壞檔不該讓整批停下來
        return None
    sport = str((meta or {}).get("sport") or "")
    if sport and sport.lower() not in ("cycling", "biking", "ride"):
        return None
    pts = A.resample_1hz(raw)
    if len(pts) < 1200:
        return None
    gps = [(p["lat"], p["lon"]) for p in pts if p.get("lat") is not None and p.get("lon") is not None]
    watts = [p["w"] for p in pts if p.get("w") is not None]
    if len(gps) < 600 or len(watts) < len(pts) * 0.5:
        return None
    spds = [p.get("spd") for p in pts]
    mask = [bool(s and s > 0.5) for s in spds]
    moving = sum(mask)
    if moving < 900:
        return None
    mw = [p["w"] or 0 for p, m in zip(pts, mask) if m]
    hs = [p["hr"] for p, m in zip(pts, mask) if m and p.get("hr")]
    aw = sum(mw) / len(mw)
    npw = A.normalized_power(mw)
    ahr = sum(hs) / len(hs) if hs else None
    dists = [p["dist"] for p in pts if p.get("dist") is not None]
    km = (max(dists) - min(dists)) / 1000 if len(dists) > 1 else 0.0
    up, _ = A.elevation_gain([p["alt"] for p in pts])
    cells, _, _ = A._ride_cells(pts, 250.0, weight)
    t0 = pts[0]["t"].astimezone(TPE)
    return {
        "date": t0.strftime("%Y-%m-%d"), "start_hm": t0.strftime("%H:%M"),
        "elapsed_sec": len(pts), "moving_sec": moving,
        "km": round(km, 2), "elev_m": round(up),
        "avg_w": round(aw), "np_w": round(npw) if npw else None,
        "avg_hr": round(ahr) if ahr else None,
        "ef": round(npw / ahr, 3) if (npw and ahr) else None,
        "vi": round(npw / aw, 2) if (npw and aw) else None,
        "start": [round(gps[0][0], 4), round(gps[0][1], 4)],
        "end": [round(gps[-1][0], 4), round(gps[-1][1], 4)],
        "draft": A.draft_summary(cells, weight + 8.0),
    }


def _hm_sec(hm):
    try:
        h, m = str(hm).split(":")[:2]
        return int(h) * 3600 + int(m) * 60
    except (ValueError, AttributeError):
        return None


def _in_window(e, date, a, b, tol=120):
    if e.get("date") != date:
        return False
    t = _hm_sec(e.get("start_time"))
    return t is not None and a - tol <= t <= b + tol


def detect_ride_efforts(fit_path):
    """當趟經過的 ITT 路段（自建偵測器），格式對齊 itt-segments.json 的 effort。"""
    segs = load_segments()
    try:
        found = detect_efforts(fit_path, segs)
    except Exception:  # noqa: BLE001
        return []
    if not found:
        return []
    _, _, raw = A.parse_ride(fit_path)
    pts = A.resample_1hz(raw)
    out = []
    from datetime import datetime
    for e in found:
        st = datetime.fromisoformat(e["start_time"])
        st_ts, end_ts = st.timestamp(), st.timestamp() + e["elapsed_sec"]
        win = [p for p in pts if st_ts <= p["t"].timestamp() <= end_ts]
        def mean(key):
            vals = [p.get(key) for p in win if p.get(key)]
            return round(sum(vals) / len(vals)) if vals else None
        out.append({"segment_id": e["segment_id"], "date": st.date().isoformat(),
                    "start_time": st.strftime("%H:%M"), "elapsed_sec": e["elapsed_sec"],
                    "elapsed_str": _fmt(e["elapsed_sec"]), "avg_watts": mean("w"),
                    "avg_heartrate": mean("hr"), "avg_cadence": mean("cad"), "source": "fit"})
    return out


def segment_ids_of(itt, date, start_hm, elapsed_sec):
    a = _hm_sec(start_hm)
    if a is None:
        return set()
    b = a + int(elapsed_sec or 0)
    return {seg["id"] for seg in itt
            for e in (seg.get("efforts") or []) if _in_window(e, date, a, b)}


def same_route(me, others, itt, my_segs=None):
    """從快取裡挑出同路線的其他趟。me 是本趟簽章；回傳依日期排序的列。"""
    if not me or not me.get("start"):
        return []
    if my_segs is None:
        my_segs = segment_ids_of(itt, me["date"], me["start_hm"], me["elapsed_sec"])
    rows = []
    for r in others:
        if not r or not r.get("start") or r.get("date") == me.get("date"):
            continue
        if (abs(r["start"][0] - me["start"][0]) > START_TOL_DEG
                or abs(r["start"][1] - me["start"][1]) > START_TOL_DEG):
            continue
        if abs((r.get("km") or 0) - (me.get("km") or 0)) > KM_TOL * max(me.get("km") or 1, 1):
            continue
        if segment_ids_of(itt, r["date"], r["start_hm"], r["elapsed_sec"]) != my_segs:
            continue
        if not my_segs and abs((r.get("elev_m") or 0) - (me.get("elev_m") or 0)) > ELEV_TOL * max(me.get("elev_m") or 1, 1):
            continue
        rows.append(r)
    rows.sort(key=lambda r: (r["date"], r["start_hm"]))
    return rows
