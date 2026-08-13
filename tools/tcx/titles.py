#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen_titles.py — 從一個 .fit 騎乘檔產生「路線簡稱」標題（提案原型，尚未進 repo）

命名法（由 2026-08-06「劍 中 露」與 2026-08-11「劍 中中中中 劍」兩個黃金樣本反推）：

  1. 把整趟騎乘拆成「路線元素」的時間序列。元素 = 通過某條有名字的路
     （Strava ITT 路段的折線，正向或反向都算通過），外加一個非 Strava 路段的
     虛擬元素「自強隧道」（靠隧道中線的閘門偵測，GPS 在隧道內會斷訊）。
  2. 折返收斂：某元素的通過，若「方向與前一個被保留的同名元素相反」，
     視為同一趟來回的回程，不另外計一次。
     例：中社路 爬上去(正) + 滑下來(反) = 一次「中」。
  3. 重疊收斂：兩筆通過在時間上重疊時只留較長的那條（河濱那幾條路段彼此包含）。
  4. 把元素換成單字簡稱，連續相同的字黏在一起、不同字之間插一個半形空格。
     例：劍 中中中中 劍
  5. 一個元素都沒偵測到 → 回傳 None，呼叫端沿用原本的標題（Strava 活動名），
     並在報告裡寫 NP / AP（使用者的規則：「沒 ITT 路段就預設先抓原本的，寫個 NP AP 就好」）。

CLI:
    python3 gen_titles.py <ride.fit> [more.fit ...] [--verbose]

可 import:
    from gen_titles import suggest_title, detect_elements
"""
import argparse
import json
import math
import os
import sys
from datetime import datetime, timedelta, timezone

TPE = timezone(timedelta(hours=8))   # Asia/Taipei，跟 repo 慣例一致

REPO_ROOT = os.environ.get(
    "LINKTREE_ROOT", "/Users/stevechuangmbp2024/Desktop/github/linkTree")
sys.path.insert(0, os.path.join(REPO_ROOT, "tools", "tcx"))

import segments as S                      # noqa: E402  已驗證的閘門偵測器
from analyze_tcx import parse_ride        # noqa: E402

SEGMENT_STREAMS = os.path.join(REPO_ROOT, "data", "segment-streams.json")

# ---------------------------------------------------------------- 簡稱表
# key = segment-streams.json 裡的 name；value = (簡稱, 是否已被使用者確認)
ABBREV = {
    "劍南路回程":        ("劍", True),
    "中社路":            ("中", True),
    "風櫃嘴":            ("風", True),
    "碧山露營場":        ("露", True),
    "南深路":            ("南", True),
    "社子島砍鴨頭":      ("社", True),
    # --- 以下三條是河濱耐力段，使用者還沒給過簡稱，先暫定，等拍板 ---
    "河濱10K 木柵–永福": ("河", False),
    "關渡→美堤":         ("關", False),
    "黃港河執行":        ("黃", False),
    # --- 非 Strava 路段的虛擬元素 ---
    "自強隧道":          ("自", True),
}

# 自強隧道：不是 Strava 路段，用「隧道中線閘門」偵測。
# 座標由 2026-05-21 那趟的 GPS 斷訊點推得（南口 25.08725,121.54960 alt 25m，
# 北口 25.09460,121.54879 alt 20m，斷訊 106 s / 821 m）。
TUNNEL = {
    "name": "自強隧道",
    "south": (25.08725, 121.54960),
    "north": (25.09460, 121.54879),
    "half_width_m": 120.0,   # 閘門線半寬，要夠寬才吃得下跨隧道的直線內插
    "max_leg_m": 2000.0,     # 跨閘門那一段軌跡不得長於此（防長距離內插誤判）
}


# ---------------------------------------------------------------- 幾何小工具
def _haversine_m(a, b):
    R = 6371000.0
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp = p2 - p1
    dl = math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(min(1.0, math.sqrt(h)))


# ---------------------------------------------------------------- 路段定義
def _build(raw, reverse):
    """把 segment-streams.json 轉成 segments.py 吃得下的定義；reverse=True 產生反向版。"""
    out = {}
    for sid, s in raw.items():
        pts = [(p[0], p[1]) for p in s["pts"]]
        if reverse:
            pts = pts[::-1]
        cum = S._polyline_cumdist(pts)
        dist = cum[-1]
        out[sid] = {
            "id": int(sid),
            "name": s["name"],
            "dist_m": dist,
            "start_gate": S.Gate(pts[0], S._bearing_vec(pts, cum, at_start=True)),
            "end_gate": S.Gate(pts[-1], S._bearing_vec(pts, cum, at_start=False)),
            "mid": S._point_at_frac(pts, cum, 0.5),
            "max_sec": max(1800.0, dist / S.MIN_SPEED_MPS),
            "min_sec": dist / S.MAX_SPEED_MPS,
        }
    return out


_RAW = None
_FWD = None
_REV = None


def _segments():
    global _RAW, _FWD, _REV
    if _FWD is None:
        with open(SEGMENT_STREAMS, encoding="utf-8") as f:
            _RAW = json.load(f)
        _FWD = _build(_RAW, False)
        _REV = _build(_RAW, True)
    return _FWD, _REV


# ---------------------------------------------------------------- 自強隧道
def _tunnel_crossings(gps):
    """隧道中線閘門：任一方向穿越都算一次「自」。回傳 [(時刻, 秒數估計)]。"""
    s, n = TUNNEL["south"], TUNNEL["north"]
    mid = ((s[0] + n[0]) / 2.0, (s[1] + n[1]) / 2.0)
    kx, ky = S._local_scale(mid[0])
    dx = (n[1] - s[1]) * kx
    dy = (n[0] - s[0]) * ky
    norm = math.hypot(dx, dy) or 1.0
    direction = (dx / norm, dy / norm)
    gate = S.Gate(mid, direction)
    gate.ax, gate.ay = -(-direction[1]) * TUNNEL["half_width_m"], -direction[0] * TUNNEL["half_width_m"]
    gate.bx, gate.by = (-direction[1]) * TUNNEL["half_width_m"], direction[0] * TUNNEL["half_width_m"]

    out = []
    for p, q in zip(gps, gps[1:]):
        if _haversine_m((p["lat"], p["lon"]), mid) > TUNNEL["max_leg_m"] and \
           _haversine_m((q["lat"], q["lon"]), mid) > TUNNEL["max_leg_m"]:
            continue
        leg = _haversine_m((p["lat"], p["lon"]), (q["lat"], q["lon"]))
        if leg > TUNNEL["max_leg_m"]:
            continue
        px, py = gate._xy(p["lat"], p["lon"])
        qx, qy = gate._xy(q["lat"], q["lon"])
        rx, ry = qx - px, qy - py
        sx, sy = gate.bx - gate.ax, gate.by - gate.ay
        denom = rx * sy - ry * sx
        if abs(denom) < 1e-12:
            continue
        wx, wy = gate.ax - px, gate.ay - py
        t = (wx * sy - wy * sx) / denom
        u = (wx * ry - wy * rx) / denom
        if not (0.0 <= t <= 1.0 and 0.0 <= u <= 1.0):
            continue
        dt = (q["t"] - p["t"]).total_seconds()
        dot = (rx * direction[0] + ry * direction[1]) / (math.hypot(rx, ry) or 1.0)
        out.append({
            "name": "自強隧道",
            "dir": "fwd" if dot > 0 else "rev",
            "t0": p["t"],
            "t1": q["t"],
            "elapsed_sec": round(dt, 1),
            "dist_m": _haversine_m(s, n),
        })
    # 同一次通過可能被相鄰兩段各記一次；60 秒內視為同一次
    merged = []
    for c in sorted(out, key=lambda c: c["t0"]):
        if merged and (c["t0"] - merged[-1]["t0"]).total_seconds() < 60:
            continue
        merged.append(c)
    return merged


# ---------------------------------------------------------------- 元素偵測
def detect_elements(ride_path):
    """回傳這趟的原始「路線元素通過」清單（已排序、未收斂）。"""
    fwd, rev = _segments()
    _, _, points = parse_ride(ride_path)
    gps = [p for p in points if p.get("lat") is not None and p.get("lon") is not None]
    if len(gps) < 2:
        return []

    raw = []
    for coll, tag in ((fwd, "fwd"), (rev, "rev")):
        for seg in coll.values():
            for e in S._match_efforts(seg, gps, ride_path):
                t0 = datetime.fromisoformat(e["start_time"])
                raw.append({
                    "name": seg["name"],
                    "dir": tag,
                    "t0": t0,
                    "t1": t0 + timedelta(seconds=e["elapsed_sec"]),
                    "elapsed_sec": e["elapsed_sec"],
                    "dist_m": seg["dist_m"],
                })
    raw.extend(_tunnel_crossings(gps))
    raw.sort(key=lambda e: e["t0"])
    return raw


def _dedupe_overlaps(elems):
    """時間重疊的兩筆只留較長的路段（河濱那幾條彼此包含）。"""
    kept = []
    for e in elems:
        clash = None
        for k in kept:
            if e["t0"] < k["t1"] and k["t0"] < e["t1"] and e["name"] != k["name"]:
                clash = k
                break
        if clash is None:
            kept.append(e)
        elif e["dist_m"] > clash["dist_m"]:
            kept[kept.index(clash)] = e
    kept.sort(key=lambda e: e["t0"])
    return kept


def _collapse_out_and_back(elems):
    """折返收斂：方向與前一個被保留的同名元素相反 → 視為回程，不計。"""
    kept = []
    for e in elems:
        if kept and kept[-1]["name"] == e["name"] and kept[-1]["dir"] != e["dir"]:
            continue
        kept.append(e)
    return kept


def compose(elems):
    """元素序列 → 標題字串。連續相同字黏一起，不同字之間插半形空格。"""
    chars = []
    for e in elems:
        ab = ABBREV.get(e["name"])
        if ab is None:
            return None, []          # 出現沒定簡稱的路段，交回呼叫端決定
        chars.append(ab[0])
    if not chars:
        return None, []
    groups = []
    for c in chars:
        if groups and groups[-1][0] == c:
            groups[-1] += c
        else:
            groups.append(c)
    return " ".join(groups), chars


def suggest_title(ride_path):
    """吃一個 FIT，吐 (建議標題 or None, 被保留的元素清單, 原始元素清單)。"""
    raw = detect_elements(ride_path)
    kept = _collapse_out_and_back(_dedupe_overlaps(raw))
    title, _ = compose(kept)
    return title, kept, raw


# ---------------------------------------------------------------- CLI
def main(argv=None):
    ap = argparse.ArgumentParser(description="從 FIT 產生路線簡稱標題（提案原型）")
    ap.add_argument("rides", nargs="+")
    ap.add_argument("--verbose", action="store_true", help="連原始元素一起印")
    args = ap.parse_args(argv)
    for f in args.rides:
        title, kept, raw = suggest_title(f)
        print("=== %s" % os.path.basename(f))
        if args.verbose:
            for e in raw:
                mark = "keep" if e in kept else "drop"
                print("    [%s] %s %-14s %-3s %7.1fs" % (
                    mark, e["t0"].astimezone(TPE).strftime("%H:%M:%S"),
                    e["name"], e["dir"], e["elapsed_sec"]))
        seq = " ".join("%s(%s)" % (e["name"], "正" if e["dir"] == "fwd" else "反") for e in kept)
        print("    元素: %s" % (seq or "（無）"))
        print("    標題: %s" % (title or "（沿用原標題 + NP/AP）"))


if __name__ == "__main__":
    main()
