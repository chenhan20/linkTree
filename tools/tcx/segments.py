#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
segments.py — 自建 ITT 路段計時偵測器

拿 data/segment-streams.json 的六條 ITT 參考折線（端點即官方閘門），
對 .fit / .tcx 騎乘檔的「原始定位點」做垂直閘門線穿越偵測，
輸出每次通過的 effort（起始時刻插值、經過秒數一位小數）。

演算法重點（見昨天計畫）：
  1. 起／終點都是「垂直閘門線 + 相鄰兩點線性插值」求穿越時刻，不用半徑判定。
  2. 一律跑原始 points，不用 resample_1hz()（補洞會複製座標，會種假群集）。
  3. 方向判斷：穿越起點閘門的行進方位角要與參考折線起段同向（夾角 < 90 度），
     另在參考折線 50% 處設中途檢查點（軌跡需有點落在 50 m 內、時間介於起終之間）。
  4. 一趟多次通過各自成一筆；起點穿越後在合理上限內沒等到終點就丟棄該次繼續掃。

可 import（detect_efforts / load_segments），也可 CLI：
  python3 segments.py ride.fit [ride2.fit ...] [--segments PATH] [--json]
"""
import argparse
import json
import math
import os
import sys
from datetime import timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from analyze_tcx import parse_ride  # noqa: E402  解析 .fit/.tcx，每點含 lat/lon/t

TPE = timezone(timedelta(hours=8))  # Asia/Taipei，跟 repo 慣例一致
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEFAULT_SEGMENTS = os.path.join(REPO_ROOT, "data", "segment-streams.json")

GATE_HALF_WIDTH_M = 30.0    # 閘門線左右各展 30 m（計畫要求 25-35 m）
MID_RADIUS_M = 50.0         # 中途檢查點半徑
BEARING_MIN_LEN_M = 15.0    # 求端點方位角時，沿折線至少走這麼遠再取向量（抗鄰點噪音）
NEAR_GATE_DEG = 0.003       # 粗篩：離閘門中心約 300 m 內才做線段相交測試
MIN_SPEED_MPS = 1.0         # 合理上限 = 路段長 / 1 m/s（走路速度），再取下限 1800 s
MAX_SPEED_MPS = 25.0        # 合理下限 = 路段長 / 25 m/s（90 km/h），防原地抖動即穿越


# ---------------------------------------------------------------- 幾何
def _local_scale(lat0):
    """該緯度下經緯度一度各是幾公尺（equirectangular 近似，閘門尺度誤差可忽略）。"""
    kx = 111320.0 * math.cos(math.radians(lat0))
    ky = 110574.0
    return kx, ky


def _polyline_cumdist(pts):
    """參考折線各點的累積距離（用局部平面近似即可）。"""
    kx, ky = _local_scale(pts[0][0])
    cum = [0.0]
    for a, b in zip(pts, pts[1:]):
        dx = (b[1] - a[1]) * kx
        dy = (b[0] - a[0]) * ky
        cum.append(cum[-1] + math.hypot(dx, dy))
    return cum


def _bearing_vec(pts, cum, at_start):
    """端點的行進方向單位向量（local xy）。沿折線取至少 BEARING_MIN_LEN_M 遠的點。"""
    kx, ky = _local_scale(pts[0][0])
    if at_start:
        anchor = pts[0]
        j = 1
        while j < len(pts) - 1 and cum[j] < BEARING_MIN_LEN_M:
            j += 1
        other = pts[j]
        dx = (other[1] - anchor[1]) * kx
        dy = (other[0] - anchor[0]) * ky
    else:
        anchor = pts[-1]
        total = cum[-1]
        j = len(pts) - 2
        while j > 0 and total - cum[j] < BEARING_MIN_LEN_M:
            j -= 1
        other = pts[j]
        dx = (anchor[1] - other[1]) * kx
        dy = (anchor[0] - other[0]) * ky
    n = math.hypot(dx, dy) or 1.0
    return (dx / n, dy / n)


def _point_at_frac(pts, cum, frac):
    """折線上累積距離 frac 處的座標（線性插值）。"""
    target = cum[-1] * frac
    for i in range(1, len(cum)):
        if cum[i] >= target:
            span = cum[i] - cum[i - 1] or 1.0
            t = (target - cum[i - 1]) / span
            lat = pts[i - 1][0] + t * (pts[i][0] - pts[i - 1][0])
            lon = pts[i - 1][1] + t * (pts[i][1] - pts[i - 1][1])
            return (lat, lon)
    return (pts[-1][0], pts[-1][1])


def _haversine_m(a, b):
    R = 6371000.0
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp = p2 - p1
    dl = math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(min(1.0, math.sqrt(h)))


class Gate:
    """垂直閘門線：錨點（官方端點）+ 行進方向，閘門線是其垂直方向左右各 GATE_HALF_WIDTH_M。"""

    def __init__(self, anchor, direction):
        self.lat0, self.lon0 = anchor
        self.kx, self.ky = _local_scale(self.lat0)
        self.dir = direction                      # 行進方向單位向量
        nx, ny = -direction[1], direction[0]      # 垂直方向
        self.ax, self.ay = -nx * GATE_HALF_WIDTH_M, -ny * GATE_HALF_WIDTH_M
        self.bx, self.by = nx * GATE_HALF_WIDTH_M, ny * GATE_HALF_WIDTH_M

    def _xy(self, lat, lon):
        return ((lon - self.lon0) * self.kx, (lat - self.lat0) * self.ky)

    def crossings(self, pts):
        """回傳 [(穿越時刻 datetime, 行進方向與參考同向的內積)]。
        pts: 已濾掉無 GPS 的原始 points（不重採樣）。"""
        out = []
        near = NEAR_GATE_DEG
        for p, q in zip(pts, pts[1:]):
            # 粗篩：兩點都離閘門中心很遠就跳過
            if (abs(p["lat"] - self.lat0) > near or abs(p["lon"] - self.lon0) > near) and \
               (abs(q["lat"] - self.lat0) > near or abs(q["lon"] - self.lon0) > near):
                continue
            px, py = self._xy(p["lat"], p["lon"])
            qx, qy = self._xy(q["lat"], q["lon"])
            rx, ry = qx - px, qy - py                     # 軌跡線段向量
            sx, sy = self.bx - self.ax, self.by - self.ay  # 閘門線段向量
            denom = rx * sy - ry * sx
            if abs(denom) < 1e-12:
                continue  # 平行或零長度
            wx, wy = self.ax - px, self.ay - py
            t = (wx * sy - wy * sx) / denom   # 軌跡線段上的參數
            u = (wx * ry - wy * rx) / denom   # 閘門線段上的參數
            if not (0.0 <= t <= 1.0 and 0.0 <= u <= 1.0):
                continue
            dt = (q["t"] - p["t"]).total_seconds()
            when = p["t"] + timedelta(seconds=t * dt)
            seg_len = math.hypot(rx, ry) or 1.0
            dot = (rx * self.dir[0] + ry * self.dir[1]) / seg_len
            out.append((when, dot))
        return out


# ---------------------------------------------------------------- 路段定義
def load_segments(path=DEFAULT_SEGMENTS):
    """讀 segment-streams.json，回傳 {id: 預先算好閘門/中點的定義}。"""
    with open(path, encoding="utf-8") as f:
        raw = json.load(f)
    segs = {}
    for sid, s in raw.items():
        pts = [(p[0], p[1]) for p in s["pts"]]
        cum = _polyline_cumdist(pts)
        dist = cum[-1]
        segs[sid] = {
            "id": int(sid),
            "name": s["name"],
            "dist_m": dist,
            "start_gate": Gate(pts[0], _bearing_vec(pts, cum, at_start=True)),
            "end_gate": Gate(pts[-1], _bearing_vec(pts, cum, at_start=False)),
            "mid": _point_at_frac(pts, cum, 0.5),
            "max_sec": max(1800.0, dist / MIN_SPEED_MPS),
            "min_sec": dist / MAX_SPEED_MPS,
        }
    return segs


# ---------------------------------------------------------------- 偵測
def _match_efforts(seg, gps_pts, source):
    starts = [c for c in seg["start_gate"].crossings(gps_pts) if c[1] > 0.0]
    ends = [c for c in seg["end_gate"].crossings(gps_pts) if c[1] > 0.0]
    if not starts or not ends:
        return []
    times = [p["t"] for p in gps_pts]
    efforts = []
    last_end = None
    for s_time, _ in starts:
        if last_end is not None and s_time < last_end:
            continue  # 已被上一筆 effort 覆蓋（同一次通過內的重覆穿越）
        cand = [e for e, _ in ends if e > s_time]
        if not cand:
            continue
        e_time = min(cand)
        elapsed = (e_time - s_time).total_seconds()
        if elapsed < seg["min_sec"] or elapsed > seg["max_sec"]:
            continue  # 快得離譜或超過合理上限：丟棄這次起點穿越，繼續掃
        # 中途檢查點：防反向與抄捷徑
        import bisect
        i0 = bisect.bisect_left(times, s_time)
        i1 = bisect.bisect_right(times, e_time)
        mid_ok = any(
            _haversine_m((p["lat"], p["lon"]), seg["mid"]) <= MID_RADIUS_M
            for p in gps_pts[i0:i1]
        )
        if not mid_ok:
            continue
        last_end = e_time
        efforts.append({
            "segment_id": seg["id"],
            "segment_name": seg["name"],
            "start_time": s_time.astimezone(TPE).isoformat(),
            "elapsed_sec": round(elapsed, 1),
            "source": os.path.basename(source),
        })
    return efforts


def detect_efforts(ride_path, segments=None):
    """對一個 .fit/.tcx 檔跑六條路段的偵測，回傳 effort dict 的 list。"""
    if segments is None:
        segments = load_segments()
    _, _, points = parse_ride(ride_path)
    # 只用「有 GPS 的原始點」——不重採樣、不補洞
    gps_pts = [p for p in points if p.get("lat") is not None and p.get("lon") is not None]
    if len(gps_pts) < 2:
        return []
    out = []
    for seg in segments.values():
        out.extend(_match_efforts(seg, gps_pts, ride_path))
    out.sort(key=lambda e: e["start_time"])
    return out


# ---------------------------------------------------------------- CLI
def main(argv=None):
    ap = argparse.ArgumentParser(description="自建 ITT 路段計時偵測器")
    ap.add_argument("rides", nargs="+", help=".fit 或 .tcx 檔")
    ap.add_argument("--segments", default=DEFAULT_SEGMENTS, help="segment-streams.json 路徑")
    ap.add_argument("--json", action="store_true", help="輸出 JSON 而非表格")
    args = ap.parse_args(argv)

    segments = load_segments(args.segments)
    all_efforts = []
    for ride in args.rides:
        try:
            all_efforts.extend(detect_efforts(ride, segments))
        except SystemExit as e:
            print("skip %s: %s" % (ride, e), file=sys.stderr)
    if args.json:
        print(json.dumps(all_efforts, ensure_ascii=False, indent=1))
    else:
        for e in all_efforts:
            print("%s  %-12s  %8.1f s  %s" % (
                e["start_time"], e["segment_name"], e["elapsed_sec"], e["source"]))
    return all_efforts


if __name__ == "__main__":
    main()
