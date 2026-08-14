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

GATE_HALF_WIDTH_M = 30.0    # 舊的閘門線半寬（保留給 Gate 幾何，實際判定已改用最近接近點）
PASS_RADIUS_M = 35.0        # 「經過」端點的判定半徑；取這段區間內離錨點最近的那一刻
MID_RADIUS_M = 50.0         # 中途檢查點半徑
CHECK_FRACS = (0.25, 0.5, 0.75)   # 路徑一致性檢查點（沿折線的累積距離比例）
CHECK_RADIUS_M = 70.0       # 檢查點容忍半徑（河濱雙線道、山路內外線都要吃得下）
REVERSE_DOT = -0.3          # 端點通過時，行進方向與折線切線的內積低於此值 = 明確反向
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


def _local_minima(run):
    """一段「連續在半徑內」的軌跡裡，每一次真正的貼近各算一筆。

    只取整段的最小值是不夠的：路段終點常常就是折返點（風櫃嘴山頂、河濱迴轉），
    車子先通過終點、再折回來，兩次都在半徑內。只取最小值會挑到折返後那一次，
    整段時間就多算了迴轉的那一兩分鐘（實測萬溪陡段被多算 100 秒）。

    這裡找的是距離序列的局部極小：距離降到谷底再上升，就記一筆。
    RISE_M 是為了不要被 GPS 抖動切成一堆假谷底。
    """
    RISE_M = 8.0
    out = []
    best = run[0]
    rising = False
    for ev in run[1:]:
        if ev[1] < best[1]:
            if rising:                 # 從上升轉回下降 → 前一個谷底成立
                out.append(best)
                best = ev
                rising = False
            else:
                best = ev
        elif ev[1] - best[1] >= RISE_M:
            rising = True
    out.append(best)
    return out


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

    def passes(self, pts, radius=PASS_RADIUS_M):
        """回傳 [(最接近錨點的時刻, 最近距離)]，每一次「經過」一筆。

        取代原本的「垂直閘門線段相交」判定。閘門線的法線是用折線端點的行進方向算的，
        在髮夾彎起點那條線幾乎與實際行進方向平行 —— 車子從錨點 4 公尺旁邊過去卻判定
        沒有穿越（實測風櫃嘴髮夾彎間 12 筆只抓到 3 筆、碧山路 26-5 全掛）。

        最近接近點是方向無關的：軌跡離錨點最近的那一刻，正是它通過「垂直於**實際**
        行進方向、且過錨點」的那條線的時刻。這才是 Strava 計時點的定義，
        而且不需要事先知道車子從哪個方向來。

        仍然不能用「進入半徑就算」—— 50 km/h 每秒跳 13.9 m，那樣會在圈內連續觸發好幾次。
        這裡是先找出「連續落在半徑內」的區段，每個區段只取距離最小的那一點，
        並在相鄰兩點間做線性插值求真正的最近時刻。
        """
        events, run = [], []          # run = 目前這一段「連續在半徑內」的 (時刻, 距離)
        near = NEAR_GATE_DEG
        lat0, lon0 = self.lat0, self.lon0
        for p, q in zip(pts, pts[1:]):
            # 粗篩：兩點都離錨點很遠就跳過（沒有這個，27 條路段 × 25 萬個點會慢到不能用）
            if (abs(p["lat"] - lat0) > near or abs(p["lon"] - lon0) > near) and \
               (abs(q["lat"] - lat0) > near or abs(q["lon"] - lon0) > near):
                if run:
                    events.extend(_local_minima(run))
                    run = []
                continue
            px, py = self._xy(p["lat"], p["lon"])
            qx, qy = self._xy(q["lat"], q["lon"])
            rx, ry = qx - px, qy - py
            L2 = rx * rx + ry * ry
            # 錨點在這段軌跡上的投影參數，夾在 [0,1] 之內就是線段上的最近點
            t = 0.0 if L2 <= 1e-12 else max(0.0, min(1.0, -(px * rx + py * ry) / L2))
            d = math.hypot(px + t * rx, py + t * ry)
            if d <= radius:
                dt = (q["t"] - p["t"]).total_seconds()
                seg_len = math.hypot(rx, ry) or 1.0
                dot = (rx * self.dir[0] + ry * self.dir[1]) / seg_len
                run.append((p["t"] + timedelta(seconds=t * dt), d, dot))
            elif run:
                events.extend(_local_minima(run))
                run = []
        if run:
            events.extend(_local_minima(run))
        return events


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
            # 路徑一致性檢查點：通過的順序決定方向，取代原本用閘門法線內積判方向
            "checks": [_point_at_frac(pts, cum, f) for f in CHECK_FRACS],
            "max_sec": max(1800.0, dist / MIN_SPEED_MPS),
            "min_sec": dist / MAX_SPEED_MPS,
        }
    return segs


# ---------------------------------------------------------------- 偵測
def _path_ok(seg, window_pts):
    """這段軌跡是不是真的「照折線的方向」走完了整條路段。

    取代原本用閘門法線內積判方向的作法。內積只看端點那一瞬間的行進方向，
    在髮夾彎或折返點會判錯；這裡改看沿途 25% / 50% / 75% 三個檢查點被通過的**順序**：
    順著走時間必然遞增，反向走就會遞減，抄捷徑則某個檢查點根本碰不到。
    """
    times = []
    for cp in seg["checks"]:
        best = None
        for p in window_pts:
            d = _haversine_m((p["lat"], p["lon"]), cp)
            if best is None or d < best[1]:
                best = (p["t"], d)
        if best is None or best[1] > CHECK_RADIUS_M:
            return False          # 沒經過這個檢查點 = 抄捷徑或根本不是這條路
        times.append(best[0])
    return all(a < b for a, b in zip(times, times[1:]))   # 必須依序通過


def _match_efforts(seg, gps_pts, source):
    """把起／終點的「經過」配成 effort。

    配對是「以終點為錨往回找起點」，取**最後一次**經過起點 —— 不是第一次。
    實測 2025-10-29 河濱10K：騎士 20:01:14 過了起點，20:02:57 折返，20:03:01 再起跑，
    20:25:06 抵達終點。取第一次得 1431 秒、取最後一次得 1324 秒，Strava 官方正是後者 ——
    折返代表前一次不算數。候選由晚到早試，讓最後一次若沒通過檢查時還能退回更早那次。
    """
    import bisect
    # 通過事件一律收下，不用端點切線的內積過濾方向。
    # 實測過濾反而更糟：折線端點的切線在髮夾彎、折返點上算不準，
    # 連 dot > -0.3 這種寬鬆門檻都會把真正的通過丟掉（碧山路 26-5 四筆全滅、
    # 中社路同日多趟的第 2~4 趟消失）。方向改由 _path_ok 的檢查點順序來把關，
    # 那個訊號來自整段軌跡，比端點瞬間的行進方向穩定得多。
    starts = sorted(t for t, _, _ in seg["start_gate"].passes(gps_pts))
    ends = sorted(t for t, _, _ in seg["end_gate"].passes(gps_pts))
    if not starts or not ends:
        return []
    times = [p["t"] for p in gps_pts]
    efforts = []
    prev_end = None
    for e_time in ends:
        cand = [s for s in starts if s < e_time and (prev_end is None or s > prev_end)]
        for s_time in reversed(cand):          # 由晚到早
            elapsed = (e_time - s_time).total_seconds()
            if elapsed < seg["min_sec"] or elapsed > seg["max_sec"]:
                continue
            i0 = bisect.bisect_left(times, s_time)
            i1 = bisect.bisect_right(times, e_time)
            if not _path_ok(seg, gps_pts[i0:i1]):
                continue
            prev_end = e_time
            efforts.append({
                "segment_id": seg["id"],
                "segment_name": seg["name"],
                "start_time": s_time.astimezone(TPE).isoformat(),
                "elapsed_sec": round(elapsed, 1),
                "source": os.path.basename(source),
            })
            break
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
