#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""score.py — 課表對帳評分

把一趟騎乘跟 data/plan.json 裡當天的處方逐段對帳，輸出可解釋的評分卡。

用法:
  python3 tools/tcx/score.py <ride.fit|ride.tcx> [--date YYYY-MM-DD]
                             [--plan data/plan.json] [--json out.json] [--quiet]

也可以 import:
  from score import load_plan, plan_for_date, score_ride, format_scorecard

為什麼要有這支程式
------------------
analyze_tcx.py 的 training_quality() 把 IF < 0.75 的自動分段一律當成「移動但沒在練」。
那是**爬坡**的判準（低功率＝在滑行），拿來看平路課表就完全錯位：處方寫死的熱身、
組間恢復、收操本來就低於 IF 0.75，被算成沒在練，一趟照表操課的騎乘就會被寫成「爽騎」。

這支程式不看 IF 門檻，只問一件事：**處方叫你做什麼，你實際做了什麼**。
沒有處方的日子一律不評分，不會拿課表標準去打一趟自由騎。

設計原則
--------
1. 不輸出黑盒總分。每個維度都附原始數字，每一段都回報 matched_start_sec / matched_sec，
   人可以拿碼錶回去查。
2. 不假設使用者精準照時間執行。切段用功率序列做動態規劃找全域最合理的對齊。
3. 對不上就標 matched:false，不硬湊。
"""
import argparse
import json
import math
import os
import sys
from datetime import timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import analyze_tcx as A  # noqa: E402  （只讀，不改）

INF = float("inf")
DEFAULT_PLAN = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "data", "plan.json",
)

# 預設常數。data/plan.json 的 scoring.params / scoring.align 可以逐項覆寫，
# 想調鬆調緊改 JSON 就好，不必動程式。
DEFAULT_PARAMS = {
    "deficit_k": 3.0,            # 平均功率每低於下限 1%，執行度扣 3 分
    "overshoot_k": 1.5,          # 每高於上限 1% 扣 1.5 分
    "overshoot_floor": 70.0,     # 超標最多扣到 70 分為止
    "duration_grace": 0.95,      # 做到處方時間的 95% 就算做滿
    "below_k": 3.0,              # min_power_hold：違規秒數佔比每 1% 扣 3 分
    "fade_k": 8.0,               # no_fade_last：最後 N 分鐘每掉 1% 扣 8 分
    "durability_k": 6.0,         # 續航：後半比前半每掉 1% 扣 6 分
    "cadence_near_rpm": 5,       # 迴轉區間外 5 rpm 內給半分
    "cadence_near_credit": 0.5,
    "twenty_min_decay_exponent": 0.06,   # 全力段不足 20 分時的外推指數
}
DEFAULT_ALIGN = {
    "grid_sec": 10,          # DP 網格解析度，之後再用 1 秒微調邊界
    "smooth_sec": 10,        # 算偏差前先平滑，免得單秒尖峰主導成本
    "refine_window_sec": 30,
    "w_duration": 1.0,       # 時長偏差的權重
    "w_power_work": 2.0,     # 主課表段的功率偏差權重
    "w_power_easy": 0.6,     # 熱身／恢復／收操的功率偏差權重
    "overshoot_weight": 0.3, # 踩超過處方只輕罰
    "gap_weight": 0.5,       # 主課表段之間空檔長度偏離預期的權重
    "edge_weight": 0.25,     # 第一段前／最後一段後的時間偏離預期的權重
    "miss_cost": 0.9,        # 「這段根本沒做」的代價，超過就標 matched:false
    "match_floor_ratio": 0.75,   # 平均功率低於處方下限的 75% 就不認為做了這段
    "allout_floor_ratio": 0.6,   # 全力段至少要有 FTP 的 60%，否則那只是在滑行
    "min_dur_ratio": 0.3,
    "max_dur_ratio": 1.8,
}
DEFAULT_WEIGHTS = {"compliance": 0.40, "discipline": 0.25, "durability": 0.20, "cadence": 0.15}
DEFAULT_GRADES = [[95, "A+"], [90, "A"], [85, "A-"], [80, "B+"], [75, "B"],
                  [70, "B-"], [65, "C+"], [60, "C"], [50, "D"], [0, "F"]]

WORK_ROLES = ("work", "allout")


# ---------------------------------------------------------------- 處方檔
def load_plan(path=None):
    """讀 data/plan.json。找不到就丟 FileNotFoundError，不要靜靜回傳空的。"""
    path = path or DEFAULT_PLAN
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def plan_for_date(plan, date_str):
    """回傳當天的處方，沒有就 None。"""
    return (plan.get("days") or {}).get(date_str)


def _params(plan):
    p = dict(DEFAULT_PARAMS)
    p.update(((plan.get("scoring") or {}).get("params") or {}))
    return {k: v for k, v in p.items() if not isinstance(v, str)}


def _align_params(plan):
    a = dict(DEFAULT_ALIGN)
    a.update(((plan.get("scoring") or {}).get("align") or {}))
    return {k: v for k, v in a.items() if not isinstance(v, str)}


def _weights(plan):
    return dict((plan.get("scoring") or {}).get("weights") or DEFAULT_WEIGHTS)


def _grade(score, plan):
    for cut, name in ((plan.get("scoring") or {}).get("grades") or DEFAULT_GRADES):
        if score >= cut:
            return name
    return "F"


# ---------------------------------------------------------------- 讀騎乘
def read_series(path):
    """從 analyze_tcx 借解析函式拿逐秒序列。回傳的欄位刻意保持原始，計分才可查證。"""
    meta, laps, raw = A.parse_ride(path)
    pts = A.resample_1hz(raw)
    if not pts:
        raise SystemExit("檔案裡沒有可用的軌跡點。")
    A.remap_laps(laps, pts)
    t0 = pts[0]["t"]
    w_raw = [p["w"] for p in pts]
    have_power = sum(1 for x in w_raw if x is not None) > len(w_raw) * 0.5
    w = [float(x) if x is not None else 0.0 for x in w_raw]
    spd = [p["spd"] for p in pts]
    moving = [bool(s and s > 0.5) for s in spd]
    if not any(moving):                       # 訓練台沒有速度欄位
        moving = [True] * len(w)
    dists = [p["dist"] for p in pts if p["dist"] is not None]
    pre = [0.0] * (len(w) + 1)
    for i, v in enumerate(w):
        pre[i + 1] = pre[i] + v
    return {
        "meta": meta, "laps": laps, "pts": pts, "t0": t0,
        "w": w, "wpre": pre, "ws": w, "hr": [p["hr"] for p in pts], "cad": [p["cad"] for p in pts],
        "spd": spd, "moving": moving, "n": len(w), "have_power": have_power,
        "dist_m": (max(dists) - min(dists)) if len(dists) > 1 else 0.0,
        "start_local": t0.astimezone(A.TPE),
    }


def _mean_w(S, a, b):
    if b <= a:
        return 0.0
    return (S["wpre"][b] - S["wpre"][a]) / (b - a)


# ---------------------------------------------------------------- 對齊（切段）
# 為什麼不用「整段平均功率 vs 處方」當成本：那樣算，一個橫跨邊界的窗口
# （一半 210W 一半 85W）平均起來剛好等於處方的 140W，成本是零。實測 2026-08-13
# 就被這個陷阱害到：緩衝段跨過主測 1 的尾巴、收操段吃掉全力段的後 6 分鐘。
# 改成「逐秒偏差的平均」之後，混搭窗口的兩邊都各自被罰，邊界才咬得住。
def _dev_prefix(seg, S, ap, ftp):
    """逐秒偏差序列的前綴和。偏差定義依處方型態不同，全部無量綱（相對於目標瓦數）。"""
    key = id(seg)
    cache = S.setdefault("_devcache", {})
    if key in cache:
        return cache[key]
    ws = S["ws"]
    ow = ap["overshoot_weight"]
    tw = seg.get("target_w") or {}
    lo, hi, about = tw.get("lo"), tw.get("hi"), tw.get("about")
    if tw.get("allout"):
        # 全力段沒有處方瓦數：離 FTP 越遠成本越高 ⇒ 等同「找同長度裡功率最高的窗口」
        def f(v):
            return max(0.0, (ftp - v) / ftp)
    elif lo is not None and hi is not None:
        def f(v):
            return max(0.0, (lo - v) / lo) + ow * max(0.0, (v - hi) / hi)
    elif lo is not None:
        # 處方寫「至少 185W」：踩不到重罰、踩超過只輕罰，對稱罰會在使用者超標時滑掉正確位置
        def f(v):
            return max(0.0, (lo - v) / lo) + ow * max(0.0, (v - lo) / lo)
    elif hi is not None:
        def f(v):
            return ow * max(0.0, (v - hi) / hi)
    elif about:
        def f(v):
            return abs(v - about) / about
    else:
        def f(v):
            return 0.0
    pre = [0.0] * (len(ws) + 1)
    for i, v in enumerate(ws):
        pre[i + 1] = pre[i] + f(v)
    cache[key] = pre
    return pre


def _seg_cost(seg, S, a, b, ap, ftp):
    """一段處方擺在 [a,b) 這個窗口的成本 = 時長偏差 + 逐秒功率偏差的平均。"""
    dur = b - a
    if dur <= 0:
        return INF
    pres = seg["minutes"] * 60.0
    dur_cost = abs(dur - pres) / pres
    pre = _dev_prefix(seg, S, ap, ftp)
    dev = (pre[b] - pre[a]) / dur
    wp = ap["w_power_work"] if seg.get("role") in WORK_ROLES else ap["w_power_easy"]
    return ap["w_duration"] * dur_cost + wp * dev


def _gate_ok(seg, S, a, b, ap, ftp):
    """硬性門檻：低到這個程度就不叫「做了這段」，應該標 matched:false。

    沒有這道門檻的話，一段處方 300-330W 但當天根本沒做的間歇，DP 會去搶一塊 200W 的
    路段來充數（成本 0.67 還低於 miss_cost），順帶把隔壁真正的主課表段擠掉。
    """
    if b - a <= 0:
        return False
    mean = _mean_w(S, a, b)
    tw = seg.get("target_w") or {}
    if tw.get("allout"):
        return mean >= ftp * ap["allout_floor_ratio"]
    ref = tw.get("lo") or tw.get("about")
    if not ref:
        return True
    return mean >= ref * ap["match_floor_ratio"]


def _smooth_centered(vals, win):
    """置中移動平均。用 analyze_tcx.smooth 會有 win/2 的延遲，邊界會整體往後偏。"""
    if win <= 1:
        return list(vals)
    n = len(vals)
    pre = [0.0] * (n + 1)
    for i, v in enumerate(vals):
        pre[i + 1] = pre[i] + v
    h = win // 2
    out = []
    for i in range(n):
        a, b = max(0, i - h), min(n, i + h + 1)
        out.append((pre[b] - pre[a]) / (b - a))
    return out


def _edge_cost(actual, expected, weight):
    """空檔／熱身前空轉／收操後剩餘時間的長度偏差，分母給下限免得 expected=0 時爆掉。"""
    return weight * abs(actual - expected) / max(120.0, float(expected))


def align_segments(segments, S, ap, ftp):
    """兩階段對齊。回傳 (spans, 診斷字典)。spans[i] 是 (start,end) 或 None。

    階段一：只對 work / allout 這些**主課表段**做動態規劃。它們是課表的骨架，
            也是唯一有明確功率處方可以認位置的東西。段與段之間預期空多久
            （＝中間那些熱身／恢復／收操的處方時間總和）也算進成本。
    階段二：熱身、組間恢復、收操按順序填進骨架讓出來的空檔。

    為什麼不是一次 DP 全部做完：收操處方 130W、實際只做 4 分鐘 23W，一次 DP 會讓
    收操往前吃掉全力段來讓自己的平均好看一點 —— 主課表段被次要段偷走時間。
    先釘骨架就不會有這種事。
    """
    n = S["n"]
    step = int(ap["grid_sec"])
    m = int(math.ceil(n / step))
    S["ws"] = _smooth_centered(S["w"], int(ap["smooth_sec"]))
    S["_devcache"] = {}
    anchors = [i for i, s in enumerate(segments) if s.get("role") in WORK_ROLES]
    spans = [None] * len(segments)
    diag = {"anchors": len(anchors), "total_cost": None}
    if not anchors:
        return spans, diag

    def bd(c):
        return min(c * step, n)

    # 每個骨架段的前置預期空檔（＝夾在它與前一個骨架段之間的所有段的處方時間）
    exp_before = []
    prev = -1
    for i in anchors:
        exp_before.append(sum(segments[j]["minutes"] * 60 for j in range(prev + 1, i)))
        prev = i
    exp_tail = sum(segments[j]["minutes"] * 60 for j in range(anchors[-1] + 1, len(segments)))

    w_edge = ap["edge_weight"]
    w_gap = ap["gap_weight"]

    # 第 0 層：第一個骨架段開始之前的空轉（熱身佔掉的時間）
    E = [_edge_cost(bd(c), exp_before[0], w_edge) for c in range(m + 1)]
    layers = []

    for k, i in enumerate(anchors):
        seg = segments[i]
        pres = seg["minutes"] * 60.0
        dmin = max(1, int(pres * ap["min_dur_ratio"] / step))
        dmax = max(dmin, int(pres * ap["max_dur_ratio"] / step))
        gap_exp = exp_before[k] if k > 0 else 0
        # 抵達成本：這段從 a 開始，前面那個骨架段可以結束在 [a-gap_span, a] 的任何地方。
        # 只跟 a 有關、跟這段多長無關，所以先算好一份，別塞進 (b,d) 雙迴圈裡重算。
        if k == 0:
            Arr, Arrsrc = list(E), list(range(m + 1))
        else:
            gap_span = int((gap_exp + max(300.0, gap_exp)) / step) + 1
            Arr, Arrsrc = [INF] * (m + 1), [0] * (m + 1)
            for a in range(m + 1):
                bv, bs = INF, a
                for e in range(max(0, a - gap_span), a + 1):
                    ev = E[e]
                    if ev == INF:
                        continue
                    v = ev + _edge_cost(bd(a) - bd(e), gap_exp, w_gap)
                    if v < bv:
                        bv, bs = v, e
                Arr[a], Arrsrc[a] = bv, bs
        En = [INF] * (m + 1)
        Ensrc = [None] * (m + 1)
        for b in range(0, m + 1):
            best, src = E[b] + ap["miss_cost"], (None, None, False)   # 這段沒做
            for d in range(dmin, min(dmax, b) + 1):
                a = b - d
                if Arr[a] == INF or not _gate_ok(seg, S, bd(a), bd(b), ap, ftp):
                    continue
                v = Arr[a] + _seg_cost(seg, S, bd(a), bd(b), ap, ftp)
                if v < best:
                    best, src = v, (a, Arrsrc[a], True)
            En[b], Ensrc[b] = best, src
        layers.append(Ensrc)
        E = En

    best_b, best_v = 0, INF
    for b in range(m + 1):
        v = E[b] + _edge_cost(n - bd(b), exp_tail, w_edge)
        if v < best_v:
            best_v, best_b = v, b

    b = best_b
    for k in range(len(anchors) - 1, -1, -1):
        a_cell, e_cell, matched = layers[k][b]
        if matched:
            spans[anchors[k]] = (bd(a_cell), bd(b))
            b = e_cell
        # 沒做的話位置不動，直接往前一層退
    diag["total_cost"] = round(best_v, 3)

    _refine_anchors(segments, anchors, spans, S, ap, ftp)
    _fill_easy(segments, anchors, spans, S, ap, ftp)
    return spans, diag


def _refine_anchors(segments, anchors, spans, S, ap, ftp):
    """把網格解析度的邊界拉到 1 秒。只在 ±refine_window_sec 內找，整段不會跑掉。"""
    R = int(ap["refine_window_sec"])
    n = S["n"]
    idx = [i for i in anchors if spans[i]]
    for _ in range(2):
        for k, i in enumerate(idx):
            a, b = spans[i]
            lo = spans[idx[k - 1]][1] if k > 0 else 0
            hi = spans[idx[k + 1]][0] if k + 1 < len(idx) else n
            seg = segments[i]
            best = (_seg_cost(seg, S, a, b, ap, ftp), a, b)
            for a2 in range(max(lo, a - R), min(b - 30, a + R) + 1):
                c = _seg_cost(seg, S, a2, b, ap, ftp)
                if c < best[0] and _gate_ok(seg, S, a2, b, ap, ftp):
                    best = (c, a2, b)
            a = best[1]
            best = (_seg_cost(seg, S, a, b, ap, ftp), a, b)
            for b2 in range(max(a + 30, b - R), min(hi, b + R) + 1):
                c = _seg_cost(seg, S, a, b2, ap, ftp)
                if c < best[0] and _gate_ok(seg, S, a, b2, ap, ftp):
                    best = (c, a, b2)
            spans[i] = (best[1], best[2])


def _fill_easy(segments, anchors, spans, S, ap, ftp):
    """熱身／組間恢復／收操填進骨架之間的空檔。

    空檔裡只有一段（絕大多數情況）就整段吃下去，超過 max_dur_ratio 倍處方時間才裁掉，
    裁的時候留下靠著主課表段的那一側 —— 熱身留尾巴、收操留開頭、組間恢復留開頭。
    空檔裡有多段就按處方時間比例切，再用同一個成本函式微調內部邊界。
    """
    n = S["n"]
    placed = [i for i in anchors if spans[i]]
    bounds = []
    prev_end = 0
    for i in placed:
        bounds.append((prev_end, spans[i][0], i))
        prev_end = spans[i][1]
    bounds.append((prev_end, n, None))

    groups = []
    cursor = 0
    for lo, hi, anchor_i in bounds:
        stop = anchor_i if anchor_i is not None else len(segments)
        segs = [j for j in range(cursor, stop) if segments[j].get("role") not in WORK_ROLES]
        cursor = stop + 1 if anchor_i is not None else len(segments)
        if segs:
            groups.append((lo, hi, segs, anchor_i))

    for lo, hi, segs, anchor_i in groups:
        room = hi - lo
        if room < 30:
            continue
        if len(segs) == 1:
            j = segs[0]
            cap = int(segments[j]["minutes"] * 60 * ap["max_dur_ratio"])
            if room <= cap:
                spans[j] = (lo, hi)
            elif segments[j].get("role") == "warmup" or anchor_i is not None:
                spans[j] = (hi - cap, hi)      # 熱身／恢復：留靠著主課表段的那一側
            else:
                spans[j] = (lo, lo + cap)      # 收操：留主課表段結束後的那一側
            continue
        tot = sum(segments[j]["minutes"] for j in segs)
        acc = lo
        for k, j in enumerate(segs):
            end = hi if k == len(segs) - 1 else acc + int(room * segments[j]["minutes"] / tot)
            spans[j] = (acc, max(acc + 30, min(end, hi)))
            acc = spans[j][1]
        for _ in range(2):                      # 內部邊界微調
            R = int(ap["refine_window_sec"])
            for k in range(len(segs) - 1):
                j1, j2 = segs[k], segs[k + 1]
                a1, b1 = spans[j1]
                a2, b2 = spans[j2]
                best = (_seg_cost(segments[j1], S, a1, b1, ap, ftp)
                        + _seg_cost(segments[j2], S, a2, b2, ap, ftp), b1)
                for x in range(max(a1 + 30, b1 - R), min(b2 - 30, b1 + R) + 1):
                    c = (_seg_cost(segments[j1], S, a1, x, ap, ftp)
                         + _seg_cost(segments[j2], S, x, b2, ap, ftp))
                    if c < best[0]:
                        best = (c, x)
                spans[j1] = (a1, best[1])
                spans[j2] = (best[1], b2)


# ---------------------------------------------------------------- 段落統計
def _splits(S, a, b):
    """段內分割平均，讓「前段不足、後段超標」這種形狀看得見。"""
    dur = b - a
    if dur >= 1800:
        L = 600
    elif dur >= 900:
        L = 300
    else:
        L = max(30, dur // 4)
    out = []
    i = a
    while i < b:
        j = min(i + L, b)
        if j - i < 20 and out:              # 尾巴太短就併進上一格
            break
        seg = S["w"][i:j]
        cad = [c for c in S["cad"][i:j] if c]
        hr = [h for h in S["hr"][i:j] if h]
        out.append({
            "from_min": round((i - a) / 60.0, 1),
            "to_min": round((j - a) / 60.0, 1),
            "avg_w": round(sum(seg) / len(seg)),
            "avg_cad": round(sum(cad) / len(cad)) if cad else None,
            "avg_hr": round(sum(hr) / len(hr)) if hr else None,
        })
        i = j
    return out


def _seg_actual(S, a, b, ftp):
    dur = b - a
    w = S["w"][a:b]
    hr = [h for h in S["hr"][a:b] if h]
    cad = [c for c in S["cad"][a:b] if c]
    half = dur // 2
    npw = A.normalized_power(w) if dur >= 30 else None
    return {
        "avg_w": round(sum(w) / dur, 1),
        "np_w": npw,
        "max_w": round(max(w)),
        "if": round(npw / ftp, 3) if npw else None,
        "avg_hr": round(sum(hr) / len(hr)) if hr else None,
        "max_hr": max(hr) if hr else None,
        "avg_cad": round(sum(cad) / len(cad), 1) if cad else None,
        "pedaling_pct": round(len(cad) / dur * 100, 1),
        "stopped_sec": sum(1 for i in range(a, b) if not S["moving"][i]),
        "first_half_w": round(sum(w[:half]) / max(1, half), 1),
        "second_half_w": round(sum(w[half:]) / max(1, dur - half), 1),
    }


def _target_text(tw):
    tw = tw or {}
    if tw.get("allout"):
        return "全力"
    lo, hi, about = tw.get("lo"), tw.get("hi"), tw.get("about")
    if lo is not None and hi is not None:
        return "%d-%dW" % (lo, hi)
    if lo is not None:
        return ">=%dW" % lo
    if hi is not None:
        return "<=%dW" % hi
    if about:
        return "~%dW" % about
    return "-"


# ---------------------------------------------------------------- 維度一：執行度
def _power_score(mean, tw, P):
    """在區間內 100 分；低於下限依比例扣（每低 1% 扣 deficit_k 分）；高於上限輕罰。"""
    tw = tw or {}
    if tw.get("allout"):
        return 100.0, "全力段沒有處方瓦數，執行度只看有沒有做滿時間"
    lo, hi = tw.get("lo"), tw.get("hi")
    if lo is None and hi is None:
        return None, "這段沒有處方瓦數"
    if lo is not None and mean < lo:
        d = (lo - mean) / lo * 100.0
        return max(0.0, 100.0 - d * P["deficit_k"]), "平均 %.0fW 低於下限 %dW（-%.1f%%）" % (mean, lo, d)
    if hi is not None and mean > hi:
        d = (mean - hi) / hi * 100.0
        return max(P["overshoot_floor"], 100.0 - d * P["overshoot_k"]), \
            "平均 %.0fW 高於上限 %dW（+%.1f%%）" % (mean, hi, d)
    return 100.0, "平均 %.0fW 在處方區間內" % mean


def compliance_dim(segreps, P):
    ent = []
    for r in segreps:
        if r["role"] not in WORK_ROLES:
            continue
        pres = r["planned_sec"]
        if not r["matched"]:
            ent.append({"name": r["name"], "planned_sec": pres, "power_score": None,
                        "duration_factor": 0.0, "score": 0.0, "why": "這段沒對到（matched:false）"})
            continue
        ps, why = _power_score(r["actual"]["avg_w"], r["target_w"], P)
        ps = 100.0 if ps is None else ps
        df = min(1.0, r["matched_sec"] / (pres * P["duration_grace"]))
        ent.append({"name": r["name"], "planned_sec": pres, "power_score": round(ps, 1),
                    "duration_factor": round(df, 3), "score": round(ps * df, 1),
                    "completion_pct": round(r["matched_sec"] / pres * 100, 1), "why": why})
    if not ent:
        return None
    tot = sum(e["planned_sec"] for e in ent)
    score = sum(e["score"] * e["planned_sec"] for e in ent) / tot
    return {"score": round(score, 1), "segments": ent,
            "method": "各 work/allout 段的（功率分 × 時間完成率），以處方秒數加權平均"}


# ---------------------------------------------------------------- 維度二：紀律（規則）
def _scope_segs(segreps, scope):
    if scope == "all":
        return [r for r in segreps if r["matched"]]
    if scope == "work_allout":
        return [r for r in segreps if r["matched"] and r["role"] in WORK_ROLES]
    return [r for r in segreps if r["matched"] and r["role"] == "work"]


def _rule_min_power_hold(rule, segreps, S, P):
    thr = rule["watts"]
    maxb = rule.get("max_below_sec", 10)
    segs = _scope_segs(segreps, rule.get("scope", "work"))
    runs, scope_sec = [], 0
    for r in segs:
        a, b = r["matched_start_sec"], r["matched_start_sec"] + r["matched_sec"]
        scope_sec += b - a
        i = a
        while i < b:
            if S["w"][i] < thr:
                j = i
                while j < b and S["w"][j] < thr:
                    j += 1
                if j - i > maxb:
                    seg_w = S["w"][i:j]
                    stopped = sum(1 for k in range(i, j) if not S["moving"][k])
                    runs.append({"segment": r["name"], "at_sec": i, "at_min_in_seg": round((i - a) / 60.0, 1),
                                 "dur_sec": j - i, "avg_w": round(sum(seg_w) / len(seg_w)),
                                 "min_w": round(min(seg_w)), "stopped_sec": stopped})
                i = j
            else:
                i += 1
    below = sum(r["dur_sec"] for r in runs)
    # scope_sec == 0 表示這條規則的作用段一段都沒對到 —— 那是「無從判定」，
    # 不是「全程守住」。給 100 分會讓一趟完全沒做課表的騎乘拿到 38.5 分，
    # 而且 verdict 會印出「全程沒有一次低於 165W」這種假話（複驗實測）。
    if not scope_sec:
        return {
            "score": None, "scored": False,
            "detail": {"threshold_w": thr, "max_below_sec": maxb,
                       "violations": None, "violation_sec": None,
                       "scope_sec": 0, "pct": None},
            "verdict": "作用段沒有對到，無從判定（不計分）",
        }
    pct = below / scope_sec * 100
    score = max(0.0, min(100.0, 100.0 - pct * P["below_k"]))
    runs.sort(key=lambda r: -r["dur_sec"])
    return {
        "score": round(score, 1),
        "detail": {
            "threshold_w": thr, "max_below_sec": maxb,
            "violations": len(runs), "violation_sec": below,
            "scope_sec": scope_sec, "violation_pct": round(pct, 2),
            "worst_run_sec": runs[0]["dur_sec"] if runs else 0,
            "stopped_sec_in_violations": sum(r["stopped_sec"] for r in runs),
            "worst": runs[:8],
        },
        "verdict": ("%d 次低於 %dW 超過 %d 秒，合計 %d 秒（佔 %.1f%%）"
                    % (len(runs), thr, maxb, below, pct)) if runs else
                   "全程沒有一次低於 %dW 超過 %d 秒" % (thr, maxb),
    }


def _rule_no_fade_last(rule, segreps, S, P):
    N = int(rule.get("minutes", 3)) * 60
    segs = _scope_segs(segreps, rule.get("scope", "work"))
    reps, scores = [], []
    for r in segs:
        a = r["matched_start_sec"]
        b = a + r["matched_sec"]
        if b - a < N + 60:
            continue
        whole = _mean_w(S, a, b)
        last = _mean_w(S, b - N, b)
        drop = (whole - last) / whole * 100 if whole else 0.0
        sc = max(0.0, min(100.0, 100.0 - max(0.0, drop) * P["fade_k"]))
        reps.append({"segment": r["name"], "whole_w": round(whole, 1), "last_w": round(last, 1),
                     "ratio": round(last / whole, 3) if whole else None,
                     "drop_pct": round(drop, 1), "score": round(sc, 1),
                     "faded": drop > 0})
        scores.append(sc)
    if not scores:
        return None
    faded = [r for r in reps if r["faded"]]
    verdict = ("%d/%d 組最後 %d 分鐘掉瓦（最多 -%.1f%%）"
               % (len(faded), len(reps), N // 60, max(r["drop_pct"] for r in faded))) if faded \
        else "%d 組最後 %d 分鐘都沒掉瓦" % (len(reps), N // 60)
    if faded and rule.get("on_fail"):
        verdict += " -> " + rule["on_fail"]
    return {"score": round(sum(scores) / len(scores), 1),
            "detail": {"minutes": N // 60, "reps": reps}, "verdict": verdict}


def _rule_hr_note_above(rule, segreps, S, P):
    """課表明說「記錄下來但不要降瓦，那是資訊不是失敗」，所以只回報不扣分。"""
    bpm = rule["bpm"]
    segs = _scope_segs(segreps, rule.get("scope", "work"))
    items = []
    for r in segs:
        a = r["matched_start_sec"]
        b = a + r["matched_sec"]
        hrs = S["hr"][a:b]
        above = sum(1 for h in hrs if h and h > bpm)
        cross = None
        run = 0
        for i in range(a, b):                # 連續 60 秒站上門檻才算「漂過去了」
            h = S["hr"][i]
            if h and h > bpm:
                run += 1
                if run >= 60:
                    cross = i - 59
                    break
            else:
                run = 0
        it = {"segment": r["name"], "sec_above": above,
              "pct_above": round(above / (b - a) * 100, 1),
              "max_hr": max([h for h in hrs if h] or [0]) or None,
              "first_sustained_cross_sec": cross,
              "cross_at_min_in_seg": round((cross - a) / 60.0, 1) if cross else None}
        if cross and cross > a + 300 and b - cross > 300:
            it["avg_w_before_cross"] = round(_mean_w(S, a, cross))
            it["avg_w_after_cross"] = round(_mean_w(S, cross, b))
            it["held_watts"] = it["avg_w_after_cross"] >= it["avg_w_before_cross"]
        items.append(it)
    hot = [i for i in items if i["sec_above"] > 0]
    if not hot:
        verdict = "沒有超過 %d bpm" % bpm
    else:
        w = hot[0]
        verdict = "%s 有 %d 秒（%.0f%%）心率高於 %d bpm，最高 %d" % (
            w["segment"], w["sec_above"], w["pct_above"], bpm, w["max_hr"] or 0)
        if "held_watts" in w:
            verdict += "；漂過去之後功率 %dW -> %dW（%s）" % (
                w["avg_w_before_cross"], w["avg_w_after_cross"],
                "沒有降瓦，照課表" if w["held_watts"] else "有降瓦")
    return {"score": None, "informational": True, "detail": {"bpm": bpm, "segments": items},
            "verdict": verdict}


RULE_EVALUATORS = {
    "min_power_hold": _rule_min_power_hold,
    "no_fade_last": _rule_no_fade_last,
    "hr_note_above": _rule_hr_note_above,
}


def discipline_dim(rules, segreps, S, P):
    out, scored = [], []
    for rule in rules or []:
        fn = RULE_EVALUATORS.get(rule.get("kind"))
        if not fn:
            out.append({"kind": rule.get("kind"), "label": rule.get("label"),
                        "score": None, "verdict": "score.py 沒有註冊這個 rule kind，略過"})
            continue
        res = fn(rule, segreps, S, P)
        if res is None:
            out.append({"kind": rule["kind"], "label": rule.get("label"), "score": None,
                        "verdict": "沒有可套用的段落（對不到或太短）"})
            continue
        item = {"kind": rule["kind"], "label": rule.get("label"),
                "informational": bool(rule.get("informational"))}
        item.update(res)
        if item.get("informational"):
            item["score"] = None
        out.append(item)
        if item["score"] is not None:
            scored.append(item["score"])
    if not scored:
        return None, out
    return {"score": round(sum(scored) / len(scored), 1), "rules_scored": len(scored),
            "method": "每條可計分規則各給 0-100，取平均"}, out


# ---------------------------------------------------------------- 維度三：續航
def durability_dim(segreps, P):
    ent = []
    for r in segreps:
        if r["role"] not in WORK_ROLES or not r["matched"] or r["matched_sec"] < 300:
            continue
        h1 = r["actual"]["first_half_w"]
        h2 = r["actual"]["second_half_w"]
        decay = (h1 - h2) / h1 * 100 if h1 else 0.0
        sc = max(0.0, min(100.0, 100.0 - max(0.0, decay) * P["durability_k"]))
        ent.append({"name": r["name"], "sec": r["matched_sec"], "first_half_w": h1,
                    "second_half_w": h2, "decay_pct": round(decay, 1), "score": round(sc, 1),
                    "shape": "負分割（後半更強）" if decay < -1 else
                             ("平穩" if abs(decay) <= 1 else "後半掉瓦")})
    if not ent:
        return None
    tot = sum(e["sec"] for e in ent)
    return {"score": round(sum(e["score"] * e["sec"] for e in ent) / tot, 1), "segments": ent,
            "method": "各 work/allout 段前半 vs 後半平均功率的衰減率，以實際秒數加權；後半更強一律 100"}


# ---------------------------------------------------------------- 維度四：迴轉
def cadence_dim(segreps, S, P):
    near, credit = P["cadence_near_rpm"], P["cadence_near_credit"]
    ent = []
    for r in segreps:
        tc = r.get("target_cadence")
        if not tc or not r["matched"]:
            continue
        lo, hi = tc["lo"], tc["hi"]
        a, b = r["matched_start_sec"], r["matched_start_sec"] + r["matched_sec"]
        dur = b - a
        inb = nb = 0
        for c in S["cad"][a:b]:
            if not c:
                continue
            if lo <= c <= hi:
                inb += 1
            elif lo - near <= c < lo or hi < c <= hi + near:
                nb += 1
        sc = (inb + credit * nb) / dur * 100
        ent.append({"name": r["name"], "target": [lo, hi], "sec": dur,
                    "avg_cad": r["actual"]["avg_cad"],
                    "in_band_pct": round(inb / dur * 100, 1),
                    "near_band_pct": round(nb / dur * 100, 1),
                    "score": round(sc, 1)})
    if not ent:
        return None
    tot = sum(e["sec"] for e in ent)
    return {"score": round(sum(e["score"] * e["sec"] for e in ent) / tot, 1), "segments": ent,
            "method": "目標區間內給滿分、區間外 %d rpm 內給半分，以實際秒數加權" % near}


# ---------------------------------------------------------------- 校準日專用
def calibration_report(cal, segreps, S, plan, P):
    """課表第 4 節指定要產出的兩個數字。"""
    base = plan.get("baseline") or {}
    by_name = {r["name"]: r for r in segreps}
    out = {}

    # (1) 60 分 @185W 撐不撐得住
    hs = by_name.get(cal.get("hold_segment"))
    tgt = cal.get("hold_watts")
    if hs and hs["matched"]:
        act = hs["actual"]
        comp = hs["matched_sec"] / (cal.get("hold_minutes", 60) * 60)
        held = (comp >= 0.95 and act["avg_w"] >= tgt * 0.99 and act["second_half_w"] >= tgt * 0.97)
        out["hold_test"] = {
            "segment": hs["name"], "target_w": tgt,
            "planned_min": cal.get("hold_minutes"), "actual_min": round(hs["matched_sec"] / 60.0, 1),
            "completion_pct": round(comp * 100, 1),
            "avg_w": act["avg_w"], "np_w": act["np_w"],
            "first_half_w": act["first_half_w"], "second_half_w": act["second_half_w"],
            "avg_hr": act["avg_hr"], "max_hr": act["max_hr"],
            "held": held,
            "verdict": ("撐得住 —— 四週表數字照跑" if held else "沒撐住 —— 四週表全部 -10W"),
            "criteria": "做滿 95% 時間、平均 >= 目標 99%、後半 >= 目標 97%，三條都過才算撐住",
        }
    else:
        out["hold_test"] = {"segment": cal.get("hold_segment"), "target_w": tgt,
                            "held": None, "verdict": "這段沒對到，無法判定"}

    # (2) 疲勞後 20 分功率
    as_ = by_name.get(cal.get("allout_segment"))
    need = int(cal.get("allout_minutes", 20)) * 60
    if as_ and as_["matched"]:
        a, b = as_["matched_start_sec"], as_["matched_start_sec"] + as_["matched_sec"]
        dur = b - a
        if dur >= need:
            best = max(_mean_w(S, i, i + need) for i in range(a, b - need + 1))
            w20, est = round(best, 1), False
            how = "段內最佳 %d 秒滾動平均" % need
        else:
            raw = _mean_w(S, a, b)
            k = P["twenty_min_decay_exponent"]
            w20 = round(raw * (need / dur) ** (-k), 1)
            est = True
            how = ("只做了 %.1f 分（處方 %d 分），以實測 %.0fW 依 P ∝ t^(-%.2f) 外推到 %d 分"
                   % (dur / 60.0, need // 60, raw, k, need // 60))
        item = {"segment": as_["name"], "planned_min": need // 60,
                "actual_min": round(dur / 60.0, 1),
                "actual_avg_w": as_["actual"]["avg_w"], "np_w": as_["actual"]["np_w"],
                "max_w": as_["actual"]["max_w"], "avg_hr": as_["actual"]["avg_hr"],
                "first_half_w": as_["actual"]["first_half_w"],
                "second_half_w": as_["actual"]["second_half_w"],
                "watts_20min": w20, "estimated": est, "method": how, "vs_fresh": []}
        for f in (cal.get("compare_fresh_20min") or base.get("fresh_20min_history") or []):
            fw = f.get("watts")
            if not fw:
                continue
            item["vs_fresh"].append({
                "period": f.get("period"), "fresh_w": fw,
                "delta_w": round(w20 - fw, 1),
                "delta_pct": round((w20 - fw) / fw * 100, 1),
            })
        out["fatigued_20min"] = item
        if cal.get("compare_to_date"):
            out["fatigued_20min"]["w4_check"] = {
                "compare_to_date": cal["compare_to_date"],
                "improvement_target_w": cal.get("improvement_target_w"),
                "note": "與 %s 的疲勞後 20 分相比提升 >= %sW 即代表斷崖被填了一段（需自行帶入該日評分結果）"
                        % (cal["compare_to_date"], cal.get("improvement_target_w")),
            }
    else:
        out["fatigued_20min"] = {"segment": cal.get("allout_segment"),
                                 "watts_20min": None, "method": "這段沒對到，無法產出"}

    # 斷崖：本趟疲勞後 20 分 vs 課表記錄的既有曲線
    cliff = base.get("known_cliff") or {}
    if out["fatigued_20min"].get("watts_20min") and cliff.get("min20_w"):
        out["cliff"] = {"fresh_20min_w": cliff["min20_w"],
                        "hour1_w": cliff.get("hour1_w"), "hour2_w": cliff.get("hour2_w"),
                        "fatigued_20min_w": out["fatigued_20min"]["watts_20min"]}
    return out


# ---------------------------------------------------------------- 主流程
def score_ride(path, date=None, plan=None, plan_path=None):
    """對一趟騎乘做課表對帳。沒有處方的日期回傳 {"scored": false, ...}。"""
    plan = plan or load_plan(plan_path)
    S = read_series(path)
    date = date or S["start_local"].strftime("%Y-%m-%d")
    day = plan_for_date(plan, date)
    base = plan.get("baseline") or {}
    fname = os.path.basename(path)

    if not day:
        return {"scored": False, "date": date, "file": fname,
                "reason": "當天沒有處方",
                "detail": "data/plan.json 的 days 裡沒有 %s。這趟不套課表標準，"
                          "自由騎不該被課表打分。" % date,
                "sport": (S["meta"] or {}).get("sport"),
                "start_local": S["start_local"].strftime("%Y-%m-%d %H:%M")}

    # 課表是騎車課表。Garmin 的跑步功率會通過 have_power 檢查，不擋的話
    # 週二/週四改成跑步的日子會被拿騎車處方去打分（複驗實測跑步 FIT 會得 38.5 分）。
    sport = str((S["meta"] or {}).get("sport") or "")
    if sport and sport.lower() not in ("cycling", "biking", "ride", "virtualride"):
        return {"scored": False, "date": date, "file": fname,
                "reason": "不是騎乘",
                "detail": "%s 有處方（%s），但這個檔案的運動類型是 %s。"
                          "課表是騎車課表，不套用。" % (date, day.get("label"), sport),
                "sport": sport,
                "start_local": S["start_local"].strftime("%Y-%m-%d %H:%M")}

    if not S["have_power"]:
        return {"scored": False, "date": date, "file": fname,
                "reason": "這個檔案沒有功率資料",
                "detail": "%s 有處方（%s），但這個檔案超過一半的取樣點沒有功率，無法逐段對帳。"
                          % (date, day.get("label")),
                "sport": (S["meta"] or {}).get("sport"),
                "start_local": S["start_local"].strftime("%Y-%m-%d %H:%M")}

    P = _params(plan)
    ap = _align_params(plan)
    ftp = float(base.get("ftp_w") or 238)
    segments = day["segments"]

    spans, align_diag = align_segments(segments, S, ap, ftp)

    segreps = []
    for i, (seg, sp) in enumerate(zip(segments, spans)):
        rep = {
            "idx": i + 1, "name": seg["name"], "role": seg.get("role"),
            "rep": seg.get("rep"), "of": seg.get("of"),
            "planned_min": seg["minutes"], "planned_sec": int(seg["minutes"] * 60),
            "target_w": seg.get("target_w"), "target_w_text": _target_text(seg.get("target_w")),
            "target_cadence": seg.get("target_cadence"), "note": seg.get("note"),
        }
        if sp is None:
            rep.update({"matched": False, "matched_start_sec": None, "matched_sec": 0,
                        "why_unmatched": "找不到窗口同時滿足「平均功率 >= 處方下限的 %d%%」"
                                         "與「成本 < miss_cost %.2f」，誠實標為沒對到，不硬湊"
                                         % (ap["match_floor_ratio"] * 100, ap["miss_cost"])})
        else:
            a, b = sp
            clock0 = (S["start_local"] + timedelta(seconds=a)).strftime("%H:%M:%S")
            clock1 = (S["start_local"] + timedelta(seconds=b)).strftime("%H:%M:%S")
            rep.update({
                "matched": True, "matched_start_sec": a, "matched_sec": b - a,
                "matched_min": round((b - a) / 60.0, 1),
                "matched_clock": "%s-%s" % (clock0, clock1),
                "completion_pct": round((b - a) / (seg["minutes"] * 60) * 100, 1),
                "align_cost": round(_seg_cost(seg, S, a, b, ap, ftp), 3),
                "actual": _seg_actual(S, a, b, ftp),
                "splits": _splits(S, a, b),
            })
            tw = seg.get("target_w") or {}
            if tw.get("lo") or tw.get("hi") or tw.get("about"):
                ref = tw.get("lo") or tw.get("about") or tw.get("hi")
                rep["vs_target"] = {
                    "ref_w": ref,
                    "delta_w": round(rep["actual"]["avg_w"] - ref, 1),
                    "sec_below_ref": sum(1 for x in S["w"][a:b] if x < ref),
                    "pct_below_ref": round(sum(1 for x in S["w"][a:b] if x < ref) / (b - a) * 100, 1),
                }
        segreps.append(rep)

    comp = compliance_dim(segreps, P)
    disc, rulereps = discipline_dim(day.get("rules"), segreps, S, P)
    dur = durability_dim(segreps, P)
    cad = cadence_dim(segreps, S, P)

    dims = {"compliance": comp, "discipline": disc, "durability": dur, "cadence": cad}
    weights = _weights(plan)
    used = {k: weights.get(k, 0.0) for k, v in dims.items() if v}
    wsum = sum(used.values()) or 1.0
    total = sum(dims[k]["score"] * w for k, w in used.items()) / wsum
    contrib = {k: round(dims[k]["score"] * w / wsum, 1) for k, w in used.items()}

    # 整趟指標（NP/IF/TSS/VI 只採計移動中，跟 analyze_tcx 同一套規則）
    mw = [x for x, m in zip(S["w"], S["moving"]) if m] or S["w"]
    moving_sec = len(mw)
    npw = A.normalized_power(mw)
    avg_moving = sum(mw) / len(mw)
    iff = round(npw / ftp, 3) if npw else None
    tss = round(moving_sec * npw * iff / (ftp * 3600) * 100) if (npw and iff) else None
    vi = round(npw / avg_moving, 2) if (npw and avg_moving) else None

    planned_work = sum(s["minutes"] * 60 for s in segments if s.get("role") in WORK_ROLES)
    matched_work = sum(r["matched_sec"] for r in segreps if r["role"] in WORK_ROLES and r["matched"])

    res = {
        "scored": True,
        "date": date,
        "file": fname,
        "plan": {"type": day.get("type"), "label": day.get("label"), "block": day.get("block"),
                 "week": day.get("week"), "weekday": day.get("weekday"), "intent": day.get("intent")},
        "ride": {
            "start_local": S["start_local"].strftime("%Y-%m-%d %H:%M"),
            "sport": (S["meta"] or {}).get("sport"),
            "elapsed_sec": S["n"], "moving_sec": moving_sec,
            "distance_km": round(S["dist_m"] / 1000, 2),
            "avg_w": round(sum(S["w"]) / S["n"], 1), "avg_w_moving": round(avg_moving, 1),
            "np_w": npw, "if": iff, "tss": tss, "vi": vi,
            "ftp_used": ftp, "ftp_source": "data/plan.json baseline.ftp_w",
            "device_ftp_w": base.get("device_ftp_w"),
        },
        "alignment": {
            "method": "先用 %d 秒網格動態規劃釘住 %d 個主課表段（成本＝時長偏差＋逐秒功率偏差，"
                      "段間空檔長度也計價），再用 1 秒解析度微調邊界，最後把熱身／恢復／收操"
                      "填進空檔" % (ap["grid_sec"], align_diag.get("anchors", 0)),
            "grid_sec": ap["grid_sec"], "total_cost": align_diag.get("total_cost"),
            "miss_cost": ap["miss_cost"],
            "unaccounted_sec": S["n"] - sum(r["matched_sec"] for r in segreps if r["matched"]),
            "note": "matched_start_sec 是相對於檔案第一個取樣點的秒數，matched_clock 是當地時間，"
                    "兩個都可以拿去查原始檔。對不上的段標 matched:false，不硬湊。",
        },
        "work_time": {
            "planned_sec": planned_work, "matched_sec": matched_work,
            "planned_min": round(planned_work / 60.0, 1), "matched_min": round(matched_work / 60.0, 1),
            "pct": round(matched_work / planned_work * 100, 1) if planned_work else None,
            "note": "這一格取代 analyze_tcx 的 effective_pct。低功率的熱身／恢復是處方寫死的，不算「沒在練」。",
        },
        "segments": segreps,
        "rules": rulereps,
        "dimensions": dims,
        "total": {"score": round(total, 1), "grade": _grade(total, plan),
                  "weights": weights, "weights_used": used, "contribution": contrib},
    }

    if day.get("calibration"):
        res["calibration"] = calibration_report(day["calibration"], segreps, S, plan, P)

    tg = day.get("targets") or {}
    checks = []
    if tg.get("vi_max") is not None and vi is not None:
        checks.append({"name": "VI", "value": vi, "target": "<= %.2f" % tg["vi_max"],
                       "pass": vi <= tg["vi_max"],
                       "why": "NP ÷ 平均瓦。掉不下來代表還在用「騎車」的方式踩課表"})
    if tg.get("if_range") and iff is not None:
        lo, hi = tg["if_range"]
        checks.append({"name": "IF", "value": iff, "target": "%.2f-%.2f" % (lo, hi),
                       "pass": lo <= iff <= hi})
    if tg.get("tss_range") and tss is not None:
        lo, hi = tg["tss_range"]
        checks.append({"name": "TSS", "value": tss, "target": "%d-%d" % (lo, hi),
                       "pass": lo <= tss <= hi})
    if checks:
        res["checks"] = checks
    res["notes"] = _build_notes(res)
    return res


def _build_notes(res):
    """把數字翻成可以直接貼進報告的中文句子。每一句都對得回上面的欄位。"""
    out = []
    for r in res["segments"]:
        if r["role"] not in WORK_ROLES or not r["matched"]:
            if r["role"] in WORK_ROLES:
                out.append("%s 沒對到：處方 %.0f 分，實際找不到對應的區間。" % (r["name"], r["planned_min"]))
            continue
        act, tw = r["actual"], (r["target_w"] or {})
        if tw.get("allout"):
            out.append("%s 全力段做了 %.1f 分（處方 %.0f 分），平均 %.0fW、最高 %dW。"
                       % (r["name"], r["matched_min"], r["planned_min"], act["avg_w"], act["max_w"]))
        else:
            ref = tw.get("lo") or tw.get("about")
            if ref:
                d = act["avg_w"] - ref
                how = ("剛好壓在處方線上" if abs(d) < 1 else
                       ("超出 %.0fW" % d if d > 0 else "少了 %.0fW" % -d))
                out.append("%s 平均 %.0fW，處方 %s，%s；前半 %.0fW／後半 %.0fW。"
                           % (r["name"], act["avg_w"], r["target_w_text"], how,
                              act["first_half_w"], act["second_half_w"]))
                h1, h2 = act["first_half_w"], act["second_half_w"]
                half = r["matched_min"] / 2.0
                if h1 < ref * 0.98 and h2 > ref * 1.02:
                    # 這正是使用者抱怨的那件事：平均達標，但形狀是前段欠、後段補
                    out.append("  └ 形狀：前 %.0f 分 %.0fW 欠 %.0fW、後 %.0f 分 %.0fW 超 %.0fW —— "
                               "平均達標是後段補回來的，不是全程守住。"
                               % (half, h1, ref - h1, half, h2, h2 - ref))
                elif h1 > ref * 1.02 and h2 < ref * 0.98:
                    out.append("  └ 形狀：前 %.0f 分 %.0fW 超 %.0fW、後 %.0f 分 %.0fW 欠 %.0fW —— "
                               "出門太猛，後段掉下來。"
                               % (half, h1, h1 - ref, half, h2, ref - h2))
        if r.get("completion_pct", 100) < 95:
            out.append("  └ %s 只做到處方時間的 %.0f%%，執行度按比例打折。"
                       % (r["name"], r["completion_pct"]))
    for rl in res.get("rules", []):
        if rl.get("verdict"):
            tag = "（僅記錄，不扣分）" if rl.get("informational") else ""
            out.append("規則「%s」：%s%s" % (rl.get("label") or rl.get("kind"), rl["verdict"], tag))
    cal = res.get("calibration") or {}
    if cal.get("hold_test", {}).get("held") is not None:
        h = cal["hold_test"]
        out.append("校準產出①　%.0f 分 @%dW：%s（實際 %.1f 分、平均 %.0fW、後半 %.0fW）。"
                   % (h["planned_min"], h["target_w"], h["verdict"], h["actual_min"],
                      h["avg_w"], h["second_half_w"]))
    f = cal.get("fatigued_20min") or {}
    if f.get("watts_20min"):
        s = "校準產出②　疲勞後 20 分功率 %.0fW%s" % (f["watts_20min"], "（外推）" if f["estimated"] else "")
        for v in f.get("vs_fresh", []):
            s += "，對照 %s 新鮮狀態 %dW 為 %+.1f%%" % (v["period"], v["fresh_w"], v["delta_pct"])
        out.append(s + "。")
    return out


# ---------------------------------------------------------------- 評分卡（純文字）
def _dw(s):
    """顯示寬度：CJK 佔兩欄。表格對齊靠這個。"""
    return sum(2 if ord(c) > 0x2E7F else 1 for c in str(s))


def _pad(s, n, right=False):
    s = str(s)
    gap = " " * max(0, n - _dw(s))
    return gap + s if right else s + gap


def _hr(ch="-", n=86):
    return ch * n


def format_scorecard(res):
    L = []
    if not res.get("scored"):
        L.append(_hr("="))
        L.append(" 課表對帳評分卡 | %s | 不評分" % res.get("date"))
        L.append(_hr("="))
        L.append(" 檔案     %s" % res.get("file"))
        L.append(" 運動     %s" % (res.get("sport") or "-"))
        L.append(" 出發     %s" % (res.get("start_local") or "-"))
        L.append(" 原因     %s" % res.get("reason"))
        L.append(" 說明     %s" % res.get("detail"))
        L.append(_hr("="))
        return "\n".join(L)

    p, ride, tot = res["plan"], res["ride"], res["total"]
    L.append(_hr("="))
    L.append(" 課表對帳評分卡 | %s (%s) | %s" % (res["date"], p.get("weekday") or "-", p.get("label")))
    L.append(_hr("="))
    L.append(" 檔案     %s" % res["file"])
    L.append(" 區塊     %s  [%s]  W%s" % (p.get("block"), p.get("type"), p.get("week")))
    L.append(" 出發     %s   %s" % (ride["start_local"], ride.get("sport") or ""))
    if p.get("intent"):
        L.append(" 用意     %s" % p["intent"])
    L.append(_hr())
    L.append(" 總分   %.1f / 100      等第  %s" % (tot["score"], tot["grade"]))
    L.append(_hr())
    names = {"compliance": ("執行度", "work 段平均功率 vs 處方區間"),
             "discipline": ("紀律", "逐秒執行 rules[]"),
             "durability": ("續航", "work 段前半 vs 後半衰減"),
             "cadence": ("迴轉", "落在目標迴轉區間的時間佔比")}
    for k in ("compliance", "discipline", "durability", "cadence"):
        d = res["dimensions"].get(k)
        zh, why = names[k]
        if not d:
            L.append("   %s %-11s   --        (本日無此維度，權重已重新分配)" % (_pad(zh, 6), k))
            continue
        w = tot["weights_used"].get(k, 0)
        L.append("   %s %-11s %5.1f   x %.2f = %4.1f   %s"
                 % (_pad(zh, 6), k, d["score"], w, tot["contribution"][k], why))
    L.append(_hr())
    wt = res["work_time"]
    L.append(" 整趟     %.1f 分 / %.2f km    平均 %.0fW   NP %sW   IF %s   TSS %s   VI %s"
             % (ride["elapsed_sec"] / 60.0, ride["distance_km"], ride["avg_w"],
                ride["np_w"], ride["if"], ride["tss"], ride["vi"]))
    L.append("          FTP %.0fW（%s；錶上設定 %sW）"
             % (ride["ftp_used"], ride["ftp_source"], ride.get("device_ftp_w")))
    L.append(" 主課表   處方 %.1f 分 -> 實際對到 %.1f 分（%.0f%%）"
             % (wt["planned_min"], wt["matched_min"], wt["pct"] or 0))
    L.append(_hr())
    L.append(" 逐段對帳   對齊：%s，總成本 %.2f" % (res["alignment"]["method"], res["alignment"]["total_cost"]))
    L.append(_hr())
    L.append("  # %s %s %s %s %s %s" % (_pad("段名", 14), _pad("角色", 10), _pad("處方", 18),
                                        _pad("對到（起點 / 長度）", 26), _pad("實際", 12), "對帳"))
    for r in res["segments"]:
        pres = "%.0f分 %s" % (r["planned_min"], r["target_w_text"])
        if not r["matched"]:
            L.append(" %2d %s %s %s %s %s %s"
                     % (r["idx"], _pad(r["name"], 14), _pad(r["role"], 10), _pad(pres, 18),
                        _pad("-- 沒對到 --", 26), _pad("-", 12), "0 分"))
            continue
        a = r["matched_start_sec"]
        loc = "+%02d:%02d %s %.1f分" % (a // 60, a % 60, r["matched_clock"].split("-")[0][:5], r["matched_min"])
        act = "%.0fW" % r["actual"]["avg_w"]
        if r["actual"]["avg_cad"]:
            act += "/%.0frpm" % r["actual"]["avg_cad"]
        ce = next((e for e in (res["dimensions"].get("compliance") or {}).get("segments", [])
                   if e["name"] == r["name"]), None)
        judge = ("%.0f 分（%s）" % (ce["score"], ce["why"])) if ce else "不計分"
        L.append(" %2d %s %s %s %s %s %s"
                 % (r["idx"], _pad(r["name"], 14), _pad(r["role"], 10), _pad(pres, 18),
                    _pad(loc, 26), _pad(act, 12), judge))
        if r["role"] in WORK_ROLES and r.get("splits") and len(r["splits"]) > 1:
            sp = " / ".join("%d" % s["avg_w"] for s in r["splits"])
            L.append("    %s 分段平均：%s W" % (_pad("", 12), sp))
            L.append("    %s 前半 %.0fW  後半 %.0fW  (%+.1f%%)"
                     % (_pad("", 12), r["actual"]["first_half_w"], r["actual"]["second_half_w"],
                        (r["actual"]["second_half_w"] - r["actual"]["first_half_w"])
                        / max(1.0, r["actual"]["first_half_w"]) * 100))
            if r["actual"]["avg_hr"]:
                L.append("    %s 心率 平均 %d / 最高 %d   踩踏 %.0f%%   停等 %d 秒"
                         % (_pad("", 12), r["actual"]["avg_hr"], r["actual"]["max_hr"],
                            r["actual"]["pedaling_pct"], r["actual"]["stopped_sec"]))
    L.append(_hr())
    L.append(" 規則執行")
    L.append(_hr())
    if not res["rules"]:
        L.append("   （本日處方沒有可執行規則）")
    for rl in res["rules"]:
        mark = "記錄" if rl.get("informational") else ("%5.1f" % rl["score"] if rl.get("score") is not None else "  --")
        L.append("   [%s] %s" % (mark, rl.get("label") or rl["kind"]))
        L.append("          %s" % rl.get("verdict"))
        d = rl.get("detail") or {}
        for wv in (d.get("worst") or [])[:5]:
            L.append("          - %s 第 %.1f 分起，低於門檻 %d 秒（平均 %dW，最低 %dW，其中停等 %d 秒）"
                     % (wv["segment"], wv["at_min_in_seg"], wv["dur_sec"], wv["avg_w"],
                        wv["min_w"], wv["stopped_sec"]))
        for rp in (d.get("reps") or []):
            L.append("          - %s 整體 %.0fW，最後 %d 分 %.0fW（%+.1f%%）"
                     % (rp["segment"], rp["whole_w"], d["minutes"], rp["last_w"], -rp["drop_pct"]))
    cal = res.get("calibration")
    if cal:
        L.append(_hr())
        L.append(" 校準日產出（課表第 4 節指定的兩個數字）")
        L.append(_hr())
        h = cal.get("hold_test") or {}
        L.append(" (1) %.0f 分 @%dW 撐不撐得住 ->  %s"
                 % (h.get("planned_min") or 0, h.get("target_w") or 0, h.get("verdict")))
        if h.get("avg_w"):
            L.append("     實際 %.1f 分（%.0f%%）  平均 %.0fW  NP %sW  前半 %.0fW  後半 %.0fW  心率 %s/%s"
                     % (h["actual_min"], h["completion_pct"], h["avg_w"], h["np_w"],
                        h["first_half_w"], h["second_half_w"], h["avg_hr"], h["max_hr"]))
            L.append("     判定條件：%s" % h["criteria"])
        f = cal.get("fatigued_20min") or {}
        L.append(" (2) 疲勞後 20 分功率 ->  %s"
                 % ("%.0f W%s" % (f["watts_20min"], "（外推估算）" if f.get("estimated") else "")
                    if f.get("watts_20min") else "無法產出"))
        if f.get("watts_20min"):
            L.append("     取法：%s" % f["method"])
            L.append("     實測段：%.1f 分  平均 %.0fW  NP %sW  最高 %dW  前半 %.0fW  後半 %.0fW"
                     % (f["actual_min"], f["actual_avg_w"], f["np_w"], f["max_w"],
                        f["first_half_w"], f["second_half_w"]))
            for v in f.get("vs_fresh", []):
                L.append("     對照新鮮狀態 %s 的 %dW：%+.0fW（%+.1f%%）  <- 這就是斷崖的實際大小"
                         % (v["period"], v["fresh_w"], v["delta_w"], v["delta_pct"]))
        c = cal.get("cliff")
        if c:
            L.append("     功率曲線：新鮮 20 分 %dW / 1 小時 %sW / 2 小時 %sW / 疲勞後 20 分 %.0fW"
                     % (c["fresh_20min_w"], c["hour1_w"], c["hour2_w"], c["fatigued_20min_w"]))
    if res.get("checks"):
        L.append(_hr())
        L.append(" 檢核指標")
        L.append(_hr())
        for c in res["checks"]:
            L.append("   %s %s  實際 %s  目標 %s  %s"
                     % (_pad(c["name"], 5), "[OK]" if c["pass"] else "[NG]",
                        c["value"], c["target"], c.get("why", "")))
    L.append(_hr())
    L.append(" 對帳摘要")
    L.append(_hr())
    for nline in res.get("notes", []):
        L.append(" " + nline)
    L.append(_hr("="))
    return "\n".join(L)


def main():
    ap = argparse.ArgumentParser(description="課表對帳評分")
    ap.add_argument("ride", help=".fit 或 .tcx")
    ap.add_argument("--date", help="覆寫日期 YYYY-MM-DD（預設由檔案的起始時間換算台北時間）")
    ap.add_argument("--plan", help="處方檔路徑，預設 data/plan.json")
    ap.add_argument("--json", dest="out", help="把完整結果寫成 JSON")
    ap.add_argument("--quiet", action="store_true", help="不印評分卡")
    a = ap.parse_args()
    res = score_ride(a.ride, date=a.date, plan_path=a.plan)
    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            json.dump(res, f, ensure_ascii=False, indent=2)
        print("已寫出 %s" % a.out)
    if not a.quiet:
        print(format_scorecard(res))
    return 0


if __name__ == "__main__":
    sys.exit(main())
