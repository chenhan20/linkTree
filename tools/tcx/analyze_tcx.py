#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
analyze_tcx.py — TCX 訓練檔解析器
輸出一份 JSON，包含彙整指標、區間分布、功率曲線、爬坡段、心率漂移等，
供上層 SKILL 撰寫「訓練彙整 + 教練評語」使用。

用法:
  python3 analyze_tcx.py ride.tcx --ftp 239 --weight 80 --height 173 --age 35 \
      [--maxhr 185] [--resthr 55] [--strava strava.json|URL] [--json out.json]

沒有 --ftp 時會以 20 分鐘最佳功率 x 0.95 估算並標記 estimated=true。
"""
import argparse
import bisect
import json
import math
import os
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from xml.etree import ElementTree as ET

NS = {
    "t": "http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2",
    "x": "http://www.garmin.com/xmlschemas/ActivityExtension/v2",
}
TPE = timezone(timedelta(hours=8))  # Asia/Taipei


# ---------------------------------------------------------------- 讀檔 / 解析
def _f(node, path, cast=float):
    el = node.find(path, NS)
    if el is None or el.text is None:
        return None
    try:
        return cast(el.text)
    except (TypeError, ValueError):
        return None


def parse_tcx(path):
    """回傳 (activity_meta, laps, points)"""
    tree = ET.parse(path)
    root = tree.getroot()
    act = root.find(".//t:Activities/t:Activity", NS)
    if act is None:
        raise SystemExit("找不到 Activity 節點，這可能不是標準 TCX。")

    meta = {
        "sport": act.get("Sport"),
        "id": (act.findtext("t:Id", default="", namespaces=NS) or "").strip(),
        "device": None,
    }
    creator = act.find("t:Creator", NS)
    if creator is not None:
        meta["device"] = creator.findtext("t:Name", default=None, namespaces=NS)

    laps, points = [], []
    for lap in act.findall("t:Lap", NS):
        lap_start = lap.get("StartTime")
        li = {
            "start": lap_start,
            "sec": _f(lap, "t:TotalTimeSeconds") or 0.0,
            "dist_m": _f(lap, "t:DistanceMeters") or 0.0,
            "max_speed": _f(lap, "t:MaximumSpeed"),
            "kcal": _f(lap, "t:Calories", int),
            "avg_hr": _f(lap, "t:AverageHeartRateBpm/t:Value", int),
            "max_hr": _f(lap, "t:MaximumHeartRateBpm/t:Value", int),
            "cadence": _f(lap, "t:Cadence", int),
            "intensity": lap.findtext("t:Intensity", default=None, namespaces=NS),
            "trigger": lap.findtext("t:TriggerMethod", default=None, namespaces=NS),
            "avg_watts": _f(lap, "t:Extensions/x:LX/x:AvgWatts"),
            "max_watts": _f(lap, "t:Extensions/x:LX/x:MaxWatts"),
            "i0": len(points),
        }
        for tp in lap.findall(".//t:Trackpoint", NS):
            ts = tp.findtext("t:Time", default=None, namespaces=NS)
            if not ts:
                continue
            p = {
                "t": _iso(ts),
                "lat": _f(tp, "t:Position/t:LatitudeDegrees"),
                "lon": _f(tp, "t:Position/t:LongitudeDegrees"),
                "alt": _f(tp, "t:AltitudeMeters"),
                "dist": _f(tp, "t:DistanceMeters"),
                "hr": _f(tp, "t:HeartRateBpm/t:Value", int),
                "cad": _f(tp, "t:Cadence", int),
                "spd": _f(tp, "t:Extensions/x:TPX/x:Speed"),
                "w": _f(tp, "t:Extensions/x:TPX/x:Watts"),
            }
            if p["cad"] is None:
                p["cad"] = _f(tp, "t:Extensions/x:TPX/x:RunCadence", int)
            points.append(p)
        li["i1"] = len(points)
        laps.append(li)
    return meta, laps, points



# ---------------------------------------------------------------- FIT
# TCX 是 Garmin 的簡化交換格式，每點只有 8 個欄位；FIT 才是完整的那份。
# 實測同一趟（activity 23929795272）FIT 多出來的：左右功率平衡、裝置上真正設定的
# 心率／功率區間邊界、Garmin 訓練效果、HRV、呼吸速率、站立時間。
# 這個函式回傳與 parse_tcx 完全相同的 (meta, laps, points) 三元組，
# 下游 24 處用到 laps／points 的程式碼一行都不必改；FIT 專屬的東西放在 meta["fit"]。
SEMI = 180.0 / (2 ** 31)          # semicircles → 度
_MFR = {"garmin": "Garmin", "giant_manufacturing_co": "Giant", "wahoo_fitness": "Wahoo",
        "stages_cycling": "Stages", "sram": "SRAM", "shimano": "Shimano", "favero_electronics": "Favero"}


def _mfr(name):
    return _MFR.get(str(name), str(name).replace("_", " ").title())


def _lrb_right_pct(v):
    """FIT 的左右平衡是帶旗標的整數；record 層遮罩 0x7F、session/lap 層 0x3FFF（單位 1/100 %）。
    fitdecode 偶爾會把純旗標值解成字串，所以非數字一律當沒有。"""
    if isinstance(v, str) or v is None:
        return None
    if v > 255:                    # session / lap：left_right_balance_100
        return (v & 0x3FFF) / 100.0
    return float(v & 0x7F)         # record


def parse_fit(path):
    """回傳 (activity_meta, laps, points)，形狀與 parse_tcx 一致。"""
    try:
        import fitdecode
    except ImportError:
        raise SystemExit(
            "讀 FIT 需要 fitdecode，請先安裝：\n"
            "  python3 -m pip install fitdecode\n"
            "（或改丟 .tcx，那條路徑只用標準函式庫）"
        )

    recs, fit_laps, sess, tiz, devices = [], [], None, None, []
    gear_evs, aux_batt = [], 0
    with fitdecode.FitReader(path) as fr:
        for frame in fr:
            if not isinstance(frame, fitdecode.FitDataMessage):
                continue
            d = {f.name: f.value for f in frame.fields}
            if frame.name == "record":
                recs.append(d)
            elif frame.name == "lap":
                fit_laps.append(d)
            elif frame.name == "session" and sess is None:
                sess = d
            elif frame.name == "time_in_zone" and tiz is None:
                tiz = d
            elif frame.name == "device_info":
                if d.get("manufacturer"):
                    devices.append(d)
            elif frame.name == "event":
                # 電子變速每次換檔寫一筆，且**兩個檔位都帶齊**（不是只帶動的那邊），
                # 所以單一事件就是完整狀態，不必自己維護前一次的前盤。
                if "gear_change" in str(d.get("event") or ""):
                    gear_evs.append(d)
            elif frame.name == "device_aux_battery_info":
                # 電變的副電池回報。它跟換檔事件是同生共死的：錶看不到變速系統時
                # 兩者一起消失，可以用來分辨「沒換檔」與「沒連上」。
                aux_batt += 1
    if not recs:
        raise SystemExit("FIT 裡沒有 record 訊息，這可能不是活動檔。")
    sess = sess or {}

    points = []
    for d in recs:
        ts = d.get("timestamp")
        if ts is None:
            continue
        lat, lon = d.get("position_lat"), d.get("position_long")
        cad = d.get("cadence")
        if cad is not None and d.get("fractional_cadence"):
            cad = cad + d["fractional_cadence"]
        points.append({
            "t":    ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc),
            "lat":  lat * SEMI if lat is not None else None,
            "lon":  lon * SEMI if lon is not None else None,
            "alt":  d.get("enhanced_altitude", d.get("altitude")),
            "dist": d.get("distance"),
            "hr":   d.get("heart_rate"),
            "cad":  int(cad) if cad is not None else None,
            "spd":  d.get("enhanced_speed", d.get("speed")),
            "w":    d.get("power"),
            "lrb":  _lrb_right_pct(d.get("left_right_balance")),
        })
    points.sort(key=lambda p: p["t"])

    # 把換檔事件往後填成「每一點掛在哪一檔」。FIT 只在換檔那一瞬間寫事件，中間是
    # 沉默的 —— 不填的話逐點資料裡根本沒有檔位這個欄位，也就畫不出隨路線變化的軌跡。
    # 第一次換檔之前一律留空（那時候掛哪一檔無從得知），不要用第一筆往前補。
    _gs = []
    for _d in gear_evs:
        _ts, _f, _r = _d.get("timestamp"), _d.get("front_gear"), _d.get("rear_gear")
        if _ts is None or not _f or not _r:
            continue
        _gs.append((_ts if _ts.tzinfo else _ts.replace(tzinfo=timezone.utc), int(_f), int(_r)))
    _gs.sort(key=lambda x: x[0])
    if _gs:
        _k = 0
        for p in points:
            while _k + 1 < len(_gs) and _gs[_k + 1][0] <= p["t"]:
                _k += 1
            if _gs[_k][0] <= p["t"]:
                p["gf"], p["gr"] = _gs[_k][1], _gs[_k][2]

    # lap 的起訖用時間戳對回 points，避免依賴訊息順序
    ptimes = [p["t"] for p in points]
    laps = []
    for d in sorted(fit_laps, key=lambda x: x.get("start_time") or ptimes[0]):
        st = d.get("start_time")
        if st is not None and st.tzinfo is None:
            st = st.replace(tzinfo=timezone.utc)
        # TCX 的 TotalTimeSeconds 對應的是計時時間，不是流逝時間
        sec = d.get("total_timer_time") or d.get("total_elapsed_time") or 0.0
        i0 = bisect.bisect_left(ptimes, st) if st else 0
        end = st + timedelta(seconds=sec) if st else None
        i1 = bisect.bisect_right(ptimes, end) if end else len(points)
        laps.append({
            "start":      st.isoformat().replace("+00:00", "Z") if st else None,
            "sec":        float(sec),
            "dist_m":     float(d.get("total_distance") or 0.0),
            "max_speed":  d.get("enhanced_max_speed", d.get("max_speed")),
            "kcal":       d.get("total_calories"),
            "avg_hr":     d.get("avg_heart_rate"),
            "max_hr":     d.get("max_heart_rate"),
            "cadence":    d.get("avg_cadence"),
            "intensity":  d.get("intensity"),
            "trigger":    d.get("lap_trigger"),
            "avg_watts":  d.get("avg_power"),
            "max_watts":  d.get("max_power"),
            "i0":         i0,
            "i1":         max(i1, i0),
        })
    if not laps:
        laps = [{"start": points[0]["t"].isoformat(), "sec": (points[-1]["t"] - points[0]["t"]).total_seconds(),
                 "dist_m": (points[-1]["dist"] or 0) - (points[0]["dist"] or 0),
                 "max_speed": None, "kcal": None, "avg_hr": None, "max_hr": None, "cadence": None,
                 "intensity": None, "trigger": None, "avg_watts": None, "max_watts": None,
                 "i0": 0, "i1": len(points)}]

    dev = None
    for d in devices:
        if d.get("product_name") or d.get("garmin_product"):
            dev = str(d.get("product_name") or d.get("garmin_product"))
            break
    meta = {
        "sport": (sess.get("sport") or "").title() or None,
        "id": str(sess.get("start_time") or points[0]["t"]),
        "device": dev,
        "fit": _fit_extras(sess, tiz, points, devices, gear_evs, aux_batt),
    }
    return meta, laps, points


def _fit_extras(sess, tiz, points, devices, gear_evs=(), aux_batt=0):
    """只有 FIT 有、TCX 與 Strava API 都拿不到的東西。"""
    tiz = tiz or {}
    lrb = _lrb_right_pct(sess.get("left_right_balance"))
    if lrb is None:                       # session 沒寫就從逐點用功率加權自己算
        num = den = 0.0
        for p in points:
            if p.get("lrb") is not None and p.get("w"):
                num += p["lrb"] * p["w"]; den += p["w"]
        lrb = round(num / den, 1) if den else None
    # 陣列可能「非空但元素是 None」—— 跑步的 FIT 沒有功率區間邊界時就是這樣，
    # 直接 int(None) 會整個 analyze 掛掉（4 個跑步檔每次執行都吐 traceback）。
    zone_edges = lambda hi: ([int(x) for x in hi if x is not None] or None) if hi else None
    zone_secs = lambda z: ([round(x, 1) for x in z if x is not None] or None) if z else None
    ex = {
        "lr_balance_right_pct": round(lrb, 1) if lrb is not None else None,
        "threshold_power":      sess.get("threshold_power") or tiz.get("functional_threshold_power"),
        "training_effect":      sess.get("total_training_effect"),
        "anaerobic_effect":     sess.get("total_anaerobic_training_effect"),
        "garmin_np":            sess.get("normalized_power"),
        "garmin_tss":           sess.get("training_stress_score"),
        "garmin_if":            sess.get("intensity_factor"),
        "total_ascent":         sess.get("total_ascent"),
        "total_descent":        sess.get("total_descent"),
        "max_hr_setting":       tiz.get("max_heart_rate"),
        "resting_hr":           tiz.get("resting_heart_rate"),
        "threshold_hr":         tiz.get("threshold_heart_rate"),
        "hr_zone_high":         zone_edges(tiz.get("hr_zone_high_boundary")),
        "power_zone_high":      zone_edges(tiz.get("power_zone_high_boundary")),
        # 跟 zone_edges 同一個地雷：陣列非空但元素是 None。lap 級的 time_in_zone
        # 訊息就長這樣（跑步的 time_in_power_zone 全是 None）。目前沒踩到只是因為
        # :150 只取第一筆、而第一筆剛好是 session 級的 —— 那是寫入順序的運氣。
        "time_in_hr_zone":      zone_secs(tiz.get("time_in_hr_zone")),
        "time_in_power_zone":   zone_secs(tiz.get("time_in_power_zone")),
        "hrv_rmssd":            sess.get("rmssd_hrv"),
        "hrv_sdrr":             sess.get("sdrr_hrv"),
        "resp_avg":             sess.get("enhanced_avg_respiration_rate"),
        "resp_max":             sess.get("enhanced_max_respiration_rate"),
        "avg_stress":           sess.get("avg_stress"),
        "avg_spo2":             sess.get("avg_spo2"),
        "time_standing":        sess.get("time_standing"),
        "stand_count":          sess.get("stand_count"),
        "grit":                 sess.get("total_grit"),
        "flow":                 sess.get("avg_flow"),
        "training_load_peak":   sess.get("training_load_peak"),
        "min_temperature":      sess.get("min_temperature"),
        "devices":              sorted({_mfr(d.get("manufacturer")) for d in devices if d.get("manufacturer")}),
        "gears":                (_gear_report(gear_evs, points)
                                 if str(sess.get("sport") or "").lower() == "cycling" else None),
        "shifting_seen":        ((bool(gear_evs) or aux_batt > 0)
                                 if str(sess.get("sport") or "").lower() == "cycling" else None),
    }
    return {k: v for k, v in ex.items() if v not in (None, [], ())}


# 700x25c 的實測滾動周長。只拿來把齒比換算成「踩一圈前進幾公尺」，
# 換輪換胎頂多差 1~2%，不影響齒比之間的相對關係。
WHEEL_CIRC_M = 2.105


def _gear_report(gear_evs, points):
    """電子變速的齒比分布。

    FIT 只在**換檔的瞬間**寫事件，中間是沉默的，所以要把狀態往後填到下一次換檔，
    再用逐點的時間去累積 —— 直接數事件次數只會告訴你「哪一檔最常被切進去」，
    不是「哪一檔騎最久」，兩者差很多（爬坡檔位切進去就待很久）。

    只累積移動中的時間：停紅燈時掛在哪一檔不是踩踏行為。
    """
    if not gear_evs or not points:
        return None
    from bisect import bisect_right

    states = []
    n_front = n_rear = 0
    for d in gear_evs:
        ts = d.get("timestamp")
        f, r = d.get("front_gear"), d.get("rear_gear")
        if ts is None or not f or not r:
            continue
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        if str(d.get("event")) == "front_gear_change":
            n_front += 1
        else:
            n_rear += 1
        states.append((ts, int(f), int(r)))
    if len(states) < 2:
        return None
    states.sort(key=lambda x: x[0])
    stimes = [x[0] for x in states]

    acc = {}                       # (front, rear) -> [secs, cad_sec, w_sec, cad_n, w_n]
    covered = moving = 0.0
    for i, p in enumerate(points):
        spd = p.get("spd")
        if spd is None or spd < 0.5:          # 停著不算
            continue
        nxt = points[i + 1]["t"] if i + 1 < len(points) else None
        dt = min((nxt - p["t"]).total_seconds(), 10.0) if nxt else 1.0
        if dt <= 0:
            continue
        moving += dt
        j = bisect_right(stimes, p["t"]) - 1
        if j < 0:                              # 第一次換檔之前無從得知掛哪一檔
            continue
        covered += dt
        _, f, r = states[j]
        a = acc.setdefault((f, r), [0.0, 0.0, 0.0, 0.0, 0.0])
        a[0] += dt
        if p.get("cad"):
            a[1] += p["cad"] * dt; a[3] += dt
        if p.get("w"):
            a[2] += p["w"] * dt;   a[4] += dt

    if not acc or covered <= 0:
        return None

    fronts = sorted({f for f, _ in acc})
    rears = sorted({r for _, r in acc})
    big, small = max(fronts), min(fronts)
    # 交叉鏈：大盤配最大的兩片、或小盤配最小的兩片。傳動效率差、鏈條磨損快。
    cross = sum(
        v[0] for (f, r), v in acc.items()
        if (f == big and r in sorted(rears)[-2:]) or (f == small and r in sorted(rears)[:2])
    ) if len(fronts) > 1 else 0.0

    combos = []
    for (f, r), v in sorted(acc.items(), key=lambda kv: -kv[1][0]):
        combos.append({
            "f": f, "r": r,
            "ratio": round(f / r, 2),
            "dev_m": round(f / r * WHEEL_CIRC_M, 2),
            "secs": int(v[0]),
            "pct": round(v[0] / covered * 100, 1),
            "avg_cad": round(v[1] / v[3]) if v[3] else None,
            "avg_w": round(v[2] / v[4]) if v[4] else None,
        })
    hours = moving / 3600 or None
    return {
        "front_teeth": fronts,
        "rear_teeth": rears,
        "shifts_front": n_front,
        "shifts_rear": n_rear,
        "shifts_per_hour": round((n_front + n_rear) / hours) if hours else None,
        "coverage_pct": round(covered / moving * 100, 1) if moving else None,
        "cross_chain_pct": round(cross / covered * 100, 1) if cross else 0.0,
        "combos": combos,
        "ratio_range": [combos and min(c["ratio"] for c in combos),
                        combos and max(c["ratio"] for c in combos)],
    }


def parse_ride(path):
    """依副檔名分派：.fit 走 FIT、其餘當 TCX。"""
    return parse_fit(path) if str(path).lower().endswith(".fit") else parse_tcx(path)

def _iso(s):
    s = s.strip().replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        return datetime.strptime(s[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)


# ---------------------------------------------------------------- 基礎工具
def haversine(a, b):
    if None in (a[0], a[1], b[0], b[1]):
        return 0.0
    R = 6371000.0
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp = p2 - p1
    dl = math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(min(1.0, math.sqrt(h)))


def smooth(vals, win):
    """簡單移動平均，None 以前值補。"""
    out, buf, s = [], [], 0.0
    for v in vals:
        v = 0.0 if v is None else float(v)
        buf.append(v)
        s += v
        if len(buf) > win:
            s -= buf.pop(0)
        out.append(s / len(buf))
    return out


def rolling_best(series, sec_list, dt=1.0):
    """最佳平均值（mean-maximal）曲線。series 為每秒一筆的數列。"""
    n = len(series)
    pre = [0.0] * (n + 1)
    for i, v in enumerate(series):
        pre[i + 1] = pre[i] + (v or 0.0)
    res = {}
    for s in sec_list:
        w = int(round(s / dt))
        if w <= 0 or w > n:
            res[s] = None
            continue
        best = max(pre[i + w] - pre[i] for i in range(n - w + 1)) / w
        res[s] = round(best, 1)
    return res


def resample_1hz(points):
    """把 trackpoint 重新對齊成每秒一筆（TCX 多半已是 1Hz，缺口以前值補）。"""
    pts = [p for p in points if p["t"]]
    if not pts:
        return []
    pts.sort(key=lambda p: p["t"])
    t0, t1 = pts[0]["t"], pts[-1]["t"]
    total = int((t1 - t0).total_seconds())
    if total <= 0:
        return pts
    grid = [None] * (total + 1)
    for p in pts:
        i = int((p["t"] - t0).total_seconds())
        if 0 <= i <= total:
            grid[i] = p
    last = pts[0]
    out = []
    for i in range(total + 1):
        cur = grid[i]
        if cur is None:
            cur = dict(last)
            cur["t"] = t0 + timedelta(seconds=i)
            cur["_gap"] = True
        else:
            last = cur
        out.append(cur)
    return out


# ---------------------------------------------------------------- 指標計算
def normalized_power(watts_1hz):
    if not watts_1hz or len(watts_1hz) < 30:
        return None
    r = smooth(watts_1hz, 30)
    return round((sum(v**4 for v in r) / len(r)) ** 0.25, 1)


def zone_time(series, edges, dt=1.0):
    """回傳每個區間累積秒數。edges 為 (下限, 上限) 清單，上限 None = 無上限。"""
    out = [0.0] * len(edges)
    for v in series:
        if v is None:
            continue
        for i, (lo, hi) in enumerate(edges):
            if v >= lo and (hi is None or v < hi):
                out[i] += dt
                break
    return out


def elevation_gain(alts, threshold=1.0, win=15):
    if not alts:
        return 0.0, 0.0
    sm = smooth(alts, win)
    up = dn = 0.0
    ref = sm[0]
    for a in sm[1:]:
        d = a - ref
        if d >= threshold:
            up += d
            ref = a
        elif d <= -threshold:
            dn += -d
            ref = a
    return round(up), round(dn)


def detect_climbs(pts, min_gain=30.0, min_grade=2.0):
    """偵測連續爬坡段（>= min_gain 公尺、平均坡度 >= min_grade%）。"""
    if len(pts) < 30:
        return []
    alts = smooth([p["alt"] for p in pts], 15)
    dists = [p["dist"] or 0.0 for p in pts]
    climbs, i, n = [], 0, len(pts)
    while i < n - 1:
        if alts[i + 1] > alts[i]:
            j = i
            slack = 0
            while j < n - 1 and slack < 20:
                if alts[j + 1] >= alts[j]:
                    slack = 0
                else:
                    slack += 1
                j += 1
            gain = alts[j] - alts[i]
            dist = dists[j] - dists[i]
            if gain >= min_gain and dist > 200 and (gain / dist * 100) >= min_grade:
                seg = pts[i : j + 1]
                ws = [p["w"] for p in seg if p["w"] is not None]
                hs = [p["hr"] for p in seg if p["hr"] is not None]
                cs = [p["cad"] for p in seg if p["cad"]]
                sec = (seg[-1]["t"] - seg[0]["t"]).total_seconds()
                climbs.append(
                    {
                        "start_sec": int((seg[0]["t"] - pts[0]["t"]).total_seconds()),
                        "sec": int(sec),
                        "dist_km": round(dist / 1000, 2),
                        "gain_m": round(gain),
                        "grade_pct": round(gain / dist * 100, 1),
                        "vam": round(gain / sec * 3600) if sec else None,
                        "avg_w": round(sum(ws) / len(ws)) if ws else None,
                        "avg_hr": round(sum(hs) / len(hs)) if hs else None,
                        "avg_cad": round(sum(cs) / len(cs)) if cs else None,
                        "speed_kmh": round(dist / sec * 3.6, 1) if sec else None,
                    }
                )
            i = j
        else:
            i += 1
    climbs.sort(key=lambda c: -c["gain_m"])
    return climbs[:8]


def decoupling(pts):
    """Pw:HR 心率漂移：後半段效率相對前半段的變化率。

    只有在「前後半強度相近」時才有生理意義。前段慢騎接近、後段爆爬的行程，
    算出來的數字反映的是課表結構而不是有氧耐力，因此一併回傳可信度旗標。
    """
    mid = len(pts) // 2

    def stats(seg):
        ws = [p["w"] for p in seg if p["w"] is not None]
        hs = [p["hr"] for p in seg if p["hr"]]
        if len(ws) > 60 and len(hs) > 60:
            aw, ah = sum(ws) / len(ws), sum(hs) / len(hs)
            return (aw / ah, aw) if ah else (None, None)
        return (None, None)

    r1, w1 = stats(pts[:mid])
    r2, w2 = stats(pts[mid:])
    if not (r1 and r2):
        return None
    pct = round((r2 - r1) / r1 * 100, 1)
    shift = abs(w2 - w1) / w1 if w1 else 0
    ok = shift <= 0.25
    return {
        "pct": pct,
        "reliable": ok,
        "note": None if ok else
        f"前後半平均功率差 {round(shift * 100)}%（{round(w1)} → {round(w2)} W），"
        "強度不對等，這個數字反映課表結構而非有氧耐力，不要拿來評體能。",
    }


# ---------------------------------------------------------------- Strava 脈絡
def load_strava(src):
    if not src:
        return None
    try:
        if re.match(r"^https?://", src):
            with urllib.request.urlopen(src, timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        with open(src, encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:  # noqa: BLE001
        sys.stderr.write(f"[warn] 無法載入 Strava 資料：{e}\n")
        return None


def strava_context(sv, date_str, sport="Ride"):
    """抽出與本次訓練相關的縱向脈絡。"""
    if not sv:
        return None
    ctx = {
        "updated_at": sv.get("updated_at"),
        "summary": sv.get("summary"),
        "monthly_summary": sv.get("monthly_summary"),
        "monthly_goals": sv.get("monthly_goals"),
        "weekly_quest": sv.get("weekly_quest"),
        "power_prs": [
            {"label": p.get("duration_label"), "sec": p.get("duration_sec"), "watts": p.get("watts"),
             "date": p.get("date"), "activity": p.get("activity_name")}
            for p in sv.get("power_prs", [])
        ],
    }
    rides = sv.get("recent_rides", []) or []
    ctx["this_ride"] = next((r for r in rides if r.get("date") == date_str), None)
    # 近 8 週同類型訓練（用於趨勢）
    ctx["recent"] = rides[:15]
    # 4 週 TSS / 里程負荷
    def _d(r):
        try:
            return datetime.strptime(r["date"], "%Y-%m-%d").date()
        except Exception:  # noqa: BLE001
            return None
    ref = None
    try:
        ref = datetime.strptime(date_str, "%Y-%m-%d").date()
    except Exception:  # noqa: BLE001
        pass
    if ref:
        weeks = []
        for wk in range(4):
            hi = ref - timedelta(days=7 * wk)
            lo = hi - timedelta(days=6)
            sel = [r for r in rides if (_d(r) and lo <= _d(r) <= hi)]
            weeks.append({
                "range": f"{lo}~{hi}",
                "rides": len(sel),
                "km": round(sum(r.get("distance_km") or 0 for r in sel), 1),
                "elev_m": sum(r.get("elevation_m") or 0 for r in sel),
                "tss": sum(r.get("tss") or 0 for r in sel),
                "hours": round(sum(r.get("moving_time_hr") or 0 for r in sel), 1),
            })
        ctx["weekly_load"] = weeks
    # 同一路線／同星期幾的歷史對照
    if ref:
        wd = ref.weekday()
        same = [r for r in rides if _d(r) and _d(r).weekday() == wd and r["date"] != date_str]
        ctx["same_weekday"] = same[:6]
    # 本次可能觸及的路段
    ctx["segments"] = [
        {"name": s.get("name"), "km": s.get("distance_km"), "pr": s.get("pr_time_str"),
         "kom": s.get("kom_time_str"),
         "efforts": sorted(s.get("efforts", []), key=lambda e: e.get("date", ""), reverse=True)[:5]}
        for s in sv.get("segments", [])
    ]
    return ctx


# ---------------------------------------------------------------- 主流程
def analyze(path, ftp=None, weight=None, height=None, age=None, maxhr=None,
            resthr=None, strava=None):
    meta, laps, raw = parse_ride(path)
    pts = resample_1hz(raw)
    if not pts:
        raise SystemExit("TCX 內沒有可用的 trackpoint。")
    remap_laps(laps, pts)

    t0, t1 = pts[0]["t"], pts[-1]["t"]
    elapsed = (t1 - t0).total_seconds()
    local0 = t0.astimezone(TPE)

    watts = [p["w"] for p in pts]
    hrs = [p["hr"] for p in pts]
    cads = [p["cad"] for p in pts]
    alts = [p["alt"] for p in pts]
    spds = [p["spd"] for p in pts]

    # 距離：優先用裝置累積距離
    dists = [p["dist"] for p in pts if p["dist"] is not None]
    dist_m = (max(dists) - min(dists)) if len(dists) > 1 else 0.0
    if dist_m <= 0:
        dist_m = sum(haversine((pts[i]["lat"], pts[i]["lon"]),
                               (pts[i + 1]["lat"], pts[i + 1]["lon"]))
                     for i in range(len(pts) - 1))

    # 移動時間：速度 > 0.5 m/s
    moving = sum(1 for s in spds if s and s > 0.5)
    if moving == 0:
        moving = int(elapsed)
    stopped = int(elapsed - moving)

    have_pw = sum(1 for w in watts if w is not None) > len(watts) * 0.5
    w_clean = [w if w is not None else 0.0 for w in watts]

    # 停等時的 0 瓦會把 NP 一路拉低（實測一趟停等 53 分鐘的騎乘差了 13 W / 23 TSS）。
    # Strava 與 TrainingPeaks 都只用「移動中」的資料算 NP／IF／TSS，這裡照做。
    mask = [bool(s and s > 0.5) for s in spds]
    mw = [w for w, m in zip(w_clean, mask) if m]
    if not mw:                       # 沒有速度欄位（訓練台）就退回全段
        mw, mask = w_clean, [True] * len(w_clean)

    np_w = normalized_power(mw) if have_pw else None
    avg_w = round(sum(w_clean) / len(w_clean), 1) if have_pw else None
    avg_w_moving = round(sum(mw) / len(mw), 1) if (have_pw and mw) else None
    max_w = round(max(w_clean)) if have_pw else None
    kj = round(sum(w_clean) / 1000) if have_pw else None

    # FIT 帶著錶上真正設定的 FTP／最大心率／靜息心率。這些以前只能猜（年齡公式、
    # 20 分 ×0.95、本次觀測最高心率），區間圖因此是估算值。有原始檔就別再猜。
    fitx = (meta.get("fit") or {}) if isinstance(meta, dict) else {}
    ftp_src = "使用者提供" if ftp else None

    ftp_est = False
    curve_secs = [5, 10, 30, 60, 120, 300, 480, 600, 1200, 1800, 3600, 5400]
    curve = rolling_best(mw, curve_secs) if have_pw else {}
    if not ftp and fitx.get("threshold_power"):
        ftp = float(fitx["threshold_power"])
        ftp_src = "裝置設定值"
    if not ftp:
        b20 = curve.get(1200)
        if b20:
            ftp = round(b20 * 0.95)
            ftp_est = True
            ftp_src = "20 分功率 × 0.95 推估"

    iff = round(np_w / ftp, 3) if (np_w and ftp) else None
    tss = round(moving * np_w * iff / (ftp * 3600) * 100) if (np_w and iff and ftp) else None
    vi = round(np_w / avg_w_moving, 2) if (np_w and avg_w_moving) else None

    hr_vals = [h for h in hrs if h]
    avg_hr = round(sum(hr_vals) / len(hr_vals)) if hr_vals else None
    max_hr_obs = max(hr_vals) if hr_vals else None
    maxhr_src = "使用者提供"
    if not maxhr and fitx.get("max_hr_setting"):
        maxhr = fitx["max_hr_setting"]
        maxhr_src = "裝置設定值"
    if not maxhr:
        est = round(211 - 0.64 * age) if age else 0
        maxhr = max(max_hr_obs or 0, est) or None
        maxhr_src = "年齡公式推估" if est and est >= (max_hr_obs or 0) else "本次觀測最高值（可能低估）"
    if not resthr and fitx.get("resting_hr"):
        resthr = fitx["resting_hr"]

    cad_vals = [c for c in cads if c and c > 0]
    avg_cad = round(sum(cad_vals) / len(cad_vals)) if cad_vals else None
    pedal_pct = round(len(cad_vals) / max(1, moving) * 100, 1)

    stops_list, stop_sum = detect_stops(pts)
    blocks = classify_blocks(pts, ftp or 250.0, weight or 80.0)

    up, dn = elevation_gain(alts)
    alt_vals = [a for a in alts if a is not None]

    # 區間
    hr_edges = hr_zone_edges(maxhr) if maxhr else None
    hr_zt = zone_time(hrs, hr_edges) if hr_edges else None
    pw_edges = power_zone_edges(ftp) if (ftp and have_pw) else None
    pw_zt = zone_time(watts, pw_edges) if pw_edges else None

    # 熱量與體重脈絡
    # 踩踏機械效率約 20~25%，1 kcal = 4.184 kJ → 消耗 kcal ≈ kJ（業界慣例近似）
    kcal = round(kj / 4.184 / 0.235) if kj else None
    if kcal is None and weight:
        kcal = round(weight * elapsed / 3600 * 7)  # 粗估
    # 脂肪供能比例隨強度下降：Zone2 約 50~60%，閾值以上剩 20% 以下。
    if iff:
        fat_pct = min(0.60, max(0.12, 0.70 - 0.58 * iff))
    elif avg_hr and maxhr:
        fat_pct = min(0.60, max(0.12, 1.30 - 1.30 * (avg_hr / maxhr)))
    else:
        fat_pct = 0.40
    fat_g = round(kcal * fat_pct / 9) if kcal else None

    bmi = round(weight / (height / 100) ** 2, 1) if (weight and height) else None
    wkg = round(avg_w / weight, 2) if (avg_w and weight) else None
    np_wkg = round(np_w / weight, 2) if (np_w and weight) else None
    ftp_wkg = round(ftp / weight, 2) if (ftp and weight) else None

    result = {
        "file": os.path.basename(path),
        "meta": meta,
        "athlete": {"height_cm": height, "weight_kg": weight, "age": age, "bmi": bmi,
                    "ftp": ftp, "ftp_estimated": ftp_est, "ftp_source": ftp_src, "ftp_wkg": ftp_wkg,
                    "max_hr": maxhr, "max_hr_source": maxhr_src, "rest_hr": resthr},
        "when": {
            "start_utc": t0.isoformat(),
            "start_local": local0.strftime("%Y-%m-%d %H:%M"),
            "weekday": ["週一", "週二", "週三", "週四", "週五", "週六", "週日"][local0.weekday()],
            "date": local0.strftime("%Y-%m-%d"),
        },
        "totals": {
            "elapsed_sec": int(elapsed),
            "moving_sec": int(moving),
            "stopped_sec": stopped,
            "distance_km": round(dist_m / 1000, 2),
            "avg_speed_kmh": round(dist_m / moving * 3.6, 1) if moving else None,
            "max_speed_kmh": round(max([s for s in spds if s] or [0]) * 3.6, 1),
            "elev_gain_m": up, "elev_loss_m": dn,
            "elev_min_m": round(min(alt_vals)) if alt_vals else None,
            "elev_max_m": round(max(alt_vals)) if alt_vals else None,
            "climb_rate_m_per_km": round(up / (dist_m / 1000), 1) if dist_m else None,
        },
        "power": {
            "has_power": have_pw, "avg_w": avg_w, "avg_w_moving": avg_w_moving,
            "np_w": np_w, "max_w": max_w, "if": iff, "tss": tss, "vi": vi,
            "kj": kj, "w_per_kg": wkg, "np_per_kg": np_wkg,
            "curve": {f"{k}s": v for k, v in curve.items()},
        },
        "hr": {"avg": avg_hr, "max": max_hr_obs,
               "pct_of_max": round(avg_hr / maxhr * 100) if (avg_hr and maxhr) else None,
               # EF（效率因子）＝ NP ÷ 平均心率。同一個人、同一種地形下，
               # 這個數字往上走＝同樣心率能出更多功率，是有氧基礎進步最直接的證據。
               # 跨地形／跨天氣比沒有意義，所以趨勢要看同型路線。
               "ef": round(np_w / avg_hr, 3) if (np_w and avg_hr) else None,
               "decoupling": decoupling([p for p, m in zip(pts, mask) if m])},
        "cadence": {"avg": avg_cad, "max": max(cad_vals) if cad_vals else None,
                    "pedaling_pct": pedal_pct},
        "energy": {"kcal": kcal, "fat_g_est": fat_g,
                   "fat_pct_est": round(fat_pct * 100),
                   "device_kcal": sum(l["kcal"] or 0 for l in laps) or None},
        "zones": {
            "hr": zone_report(hr_zt, HR_ZONE_NAMES, hr_edges, elapsed) if hr_zt else None,
            "power": zone_report(pw_zt, PW_ZONE_NAMES, pw_edges, elapsed) if pw_zt else None,
        },
        "laps": lap_report(laps, pts, t0),
        "climbs": detect_climbs(pts),
        "stops": stops_list,
        "stop_summary": stop_sum,
        "blocks": blocks,
        "training_quality": training_quality(blocks, moving),
    }
    result["strava"] = strava_context(load_strava(strava), result["when"]["date"])
    return result


HR_ZONE_NAMES = ["Z1 恢復", "Z2 有氧", "Z3 節奏", "Z4 閾值", "Z5 最大"]
PW_ZONE_NAMES = ["Z1 主動恢復", "Z2 耐力", "Z3 節奏", "Z4 閾值", "Z5 VO2max",
                 "Z6 無氧", "Z7 神經肌肉"]


def hr_zone_edges(maxhr):
    p = [0.60, 0.70, 0.80, 0.90]
    b = [round(maxhr * x) for x in p]
    return [(0, b[0]), (b[0], b[1]), (b[1], b[2]), (b[2], b[3]), (b[3], None)]


def power_zone_edges(ftp):
    b = [round(ftp * x) for x in (0.55, 0.75, 0.90, 1.05, 1.20, 1.50)]
    return [(0, b[0]), (b[0], b[1]), (b[1], b[2]), (b[2], b[3]),
            (b[3], b[4]), (b[4], b[5]), (b[5], None)]


def zone_report(zt, names, edges, total):
    out = []
    for name, sec, (lo, hi) in zip(names, zt, edges):
        out.append({
            "zone": name,
            "range": f"{lo}-{hi if hi else '+'}",
            "sec": int(sec),
            "mmss": f"{int(sec)//60}:{int(sec)%60:02d}",
            "pct": round(sec / total * 100, 1) if total else 0,
        })
    return out


def remap_laps(laps, pts):
    """把分圈的起訖索引改成對齊「重新取樣後」的逐秒序列。

    原始 trackpoint 序號在訊號中斷時會與時間軸脫節（實測可差到 170 秒以上），
    直接拿來切片會取到錯誤的區段，分圈功率／爬升全部失真。改用 Lap 的
    StartTime 與 TotalTimeSeconds 對時間定位。
    """
    if not pts:
        return
    t0 = pts[0]["t"]
    n = len(pts)
    for i, l in enumerate(laps):
        try:
            i0 = int((_iso(l["start"]) - t0).total_seconds())
        except Exception:  # noqa: BLE001
            continue
        i1 = i0 + int(l.get("sec") or 0)
        if i + 1 < len(laps):
            try:
                i1 = min(i1, int((_iso(laps[i + 1]["start"]) - t0).total_seconds()))
            except Exception:  # noqa: BLE001
                pass
        l["i0"] = max(0, min(n - 1, i0))
        l["i1"] = max(l["i0"], min(n, i1))


def lap_report(laps, pts, t0):
    out = []
    for i, l in enumerate(laps, 1):
        seg = pts[l["i0"]:l["i1"]] if l["i1"] > l["i0"] else []
        ws = [p["w"] for p in seg if p["w"] is not None]
        alt = [p["alt"] for p in seg if p["alt"] is not None]
        up, _ = elevation_gain(alt) if alt else (0, 0)
        sec = l["sec"] or 0
        out.append({
            "n": i,
            "sec": int(sec),
            "hhmmss": f"{int(sec)//3600}:{int(sec)%3600//60:02d}:{int(sec)%60:02d}",
            "km": round(l["dist_m"] / 1000, 2),
            "kmh": round(l["dist_m"] / sec * 3.6, 1) if sec else None,
            "avg_hr": l["avg_hr"], "max_hr": l["max_hr"],
            "cad": l["cadence"],
            "avg_w": round(sum(ws) / len(ws)) if ws else l["avg_watts"],
            "np_w": normalized_power([w or 0 for w in ws]) if len(ws) > 30 else None,
            "max_w": round(max(ws)) if ws else l["max_watts"],
            "elev_gain_m": up,
            "kcal": l["kcal"],
            "trigger": l["trigger"],
        })
    return out



# ---------------------------------------------------------------- 停等與路段判讀
STOP_LIGHT, STOP_SHORT, STOP_LONG = "路口／紅燈", "短休（補水、等人、拍照）", "長休（店休、等待、非騎乘）"


def detect_stops(pts, min_sec=5):
    """找出所有停止事件並分類。回傳 (事件清單, 統計)。"""
    stops, i, n = [], 0, len(pts)
    t0 = pts[0]["t"]
    while i < n:
        if pts[i]["spd"] is not None and pts[i]["spd"] <= 0.5:
            j = i
            while j < n and (pts[j]["spd"] is None or pts[j]["spd"] <= 0.5):
                j += 1
            dur = j - i
            if dur >= min_sec:
                kind = STOP_LIGHT if dur <= 90 else (STOP_SHORT if dur <= 420 else STOP_LONG)
                stops.append({
                    "at_sec": int((pts[i]["t"] - t0).total_seconds()),
                    "dur_sec": dur,
                    "km": round((pts[i]["dist"] or 0) / 1000, 2),
                    "type": kind,
                })
            i = j
        else:
            i += 1
    summary = {"count": len(stops), "total_sec": sum(s["dur_sec"] for s in stops)}
    for kind in (STOP_LIGHT, STOP_SHORT, STOP_LONG):
        sel = [s for s in stops if s["type"] == kind]
        summary[kind] = {"count": len(sel), "sec": sum(s["dur_sec"] for s in sel)}
    summary["longest"] = max((s["dur_sec"] for s in stops), default=0)
    return stops, summary


def solo_watts(v_ms, grade=0.0, mass=88.0, cda=0.36, crr=0.005, rho=1.18):
    """單騎在給定速度／坡度下的理論功率（含 3% 傳動損失）。用來看有沒有跟車。"""
    if v_ms <= 0:
        return 0.0
    aero = 0.5 * rho * cda * v_ms ** 3
    roll = crr * mass * 9.81 * v_ms
    climb = mass * 9.81 * grade * v_ms
    return max(0.0, (aero + roll + climb) / 0.97)


def classify_blocks(pts, ftp, weight=80.0, win=180):
    """把整趟切成數個性質不同的路段，各自給出強度與判讀。

    分類邏輯（依序判斷）：停等為主 → 市區走停 → 爬坡 → 下坡滑行 → 高強度平路 → 低強度巡航。
    這樣「通勤 + 認真爬坡」的混合行程，可以把真正的訓練段獨立出來評估。
    """
    n = len(pts)
    if n < win * 2:
        return []
    t0 = pts[0]["t"]
    alts = smooth([p["alt"] for p in pts], 20)
    mass = (weight or 80.0) + 8.0
    cells = []
    for a in range(0, n - 1, win):
        b = min(n - 1, a + win)
        seg = pts[a:b + 1]
        sec = b - a
        if sec < 30:
            continue
        dist = (seg[-1]["dist"] or 0) - (seg[0]["dist"] or 0)
        stopped = sum(1 for p in seg if p["spd"] is not None and p["spd"] <= 0.5)
        ws = [p["w"] for p in seg if p["w"] is not None]
        hs = [p["hr"] for p in seg if p["hr"]]
        avg_w = sum(ws) / len(ws) if ws else 0.0
        mov = [p["w"] for p in seg if p["w"] is not None and p["spd"] and p["spd"] > 0.5]
        avg_w_mov = sum(mov) / len(mov) if mov else 0.0
        grade = (alts[b] - alts[a]) / dist if dist > 50 else 0.0
        v = dist / max(1, sec - stopped)
        npw = normalized_power([w or 0 for w in mov]) or avg_w_mov
        inten = (npw / ftp) if ftp else 0.0
        stop_ratio = stopped / sec
        if stop_ratio > 0.55:
            kind = "停等／休息"
        elif stop_ratio > 0.18 and grade < 0.02:
            kind = "市區走停"
        elif grade >= 0.025:
            kind = "爬坡"
        elif grade <= -0.025:
            kind = "下坡滑降"
        elif inten >= 0.80:
            kind = "平路加速"
        else:
            kind = "平路巡航"
        # 只在「夠快的平路」才比對單騎模型，慢速時空氣阻力佔比太低、模型沒有鑑別力
        exp = solo_watts(v, grade, mass) if (v > 7.0 and abs(grade) < 0.010) else None
        cells.append({
            "a": a, "b": b, "kind": kind, "sec": sec, "dist": dist,
            "stopped": stopped, "avg_w": avg_w_mov, "np": npw, "grade": grade,
            "v": v, "hr": (sum(hs) / len(hs)) if hs else None,
            "exp_w": exp,
        })
    # 合併相鄰同類
    blocks = []
    for c in cells:
        if blocks and blocks[-1]["kind"] == c["kind"]:
            m = blocks[-1]
            m["cells"].append(c)
            m["b"] = c["b"]
        else:
            blocks.append({"kind": c["kind"], "a": c["a"], "b": c["b"], "cells": [c]})
    out = []
    for blk in blocks:
        cl = blk["cells"]
        sec = sum(c["sec"] for c in cl)
        dist = sum(c["dist"] for c in cl)
        stopped = sum(c["stopped"] for c in cl)
        wsum = sum(c["avg_w"] * (c["sec"] - c["stopped"]) for c in cl)
        msec = max(1, sec - stopped)
        hrs = [c["hr"] for c in cl if c["hr"]]
        exps = [(c["exp_w"], c["avg_w"], c["sec"]) for c in cl if c["exp_w"]]
        draft = None
        if exps:
            e = sum(x[0] * x[2] for x in exps) / sum(x[2] for x in exps)
            a_ = sum(x[1] * x[2] for x in exps) / sum(x[2] for x in exps)
            pct = round((a_ - e) / e * 100)
            # 只有明顯低於單騎所需功率才算跟車訊號，否則回報 None 免得誤導
            draft = pct if (e > 90 and pct <= -18) else None
        npw = sum(c["np"] * c["sec"] for c in cl) / sec
        out.append({
            "kind": blk["kind"],
            "start_sec": int((pts[blk["a"]]["t"] - t0).total_seconds()),
            "sec": sec, "moving_sec": msec, "stopped_sec": stopped,
            "km": round(dist / 1000, 2),
            "kmh": round(dist / msec * 3.6, 1),
            "avg_w": round(wsum / msec),
            "np_w": round(npw),
            "if": round(npw / ftp, 2) if ftp else None,
            "avg_hr": round(sum(hrs) / len(hrs)) if hrs else None,
            "grade_pct": round(sum(c["grade"] * c["dist"] for c in cl) / max(1, dist) * 100, 1),
            "draft_pct": draft,
        })
    return out


def training_quality(blocks, total_moving):
    """把路段彙總成「有效訓練時間 vs 移動但沒在練 vs 停等」。"""
    if not blocks:
        return None
    hard = sum(b["moving_sec"] for b in blocks if (b["if"] or 0) >= 0.75)
    easy = sum(b["moving_sec"] for b in blocks if (b["if"] or 0) < 0.75)
    stop = sum(b["stopped_sec"] for b in blocks)
    return {
        "effective_sec": hard, "low_sec": easy, "stopped_sec": stop,
        "effective_pct": round(hard / max(1, total_moving) * 100, 1),
    }


def chart_series(path, target_points=480, gear_min_w=150.0):
    """輸出畫圖用的降採樣序列：[距離km, 海拔m, 功率W, 心率bpm]，外加每個分圈的距離區間。

    功率／心率先做 45 秒平滑，否則逐秒噪訊會讓折線變成一團毛球。

    另外輸出**齒比軌跡**（gear_runs）：只保留「有在出力」的區段。整趟不篩的話，
    滑行、紅燈、下坡全部混進來，畫出來像一直在換檔，其實是在放空 —— 而這張圖要
    回答的是「他是一直加重，還是掛最輕一路磨」，那只有出力的時候才算數。
    門檻用**平滑後**的功率（逐秒原始值會把同一段路切成幾十截）。
    """
    meta, laps, raw = parse_ride(path)
    pts = resample_1hz(raw)
    remap_laps(laps, pts)
    n = len(pts)
    alt = smooth([p["alt"] for p in pts], 25)
    pw = smooth([p["w"] or 0 for p in pts], 45)
    hr = smooth([p["hr"] or 0 for p in pts], 45)
    dist = [(p["dist"] or 0) / 1000 for p in pts]
    # 訓練台沒有距離（逐秒 dist 全是 0），拿它當 X 軸會讓剖面圖整張除以零畫成 NaN。
    # 這種日子改用經過分鐘當 X 軸 —— 室內課表本來就是照時間開的，時間軸才是對的軸。
    indoor_x = (dist[-1] or 0) < 0.05
    xs = [i / 60 for i in range(n)] if indoor_x else dist
    step = max(1, n // target_points)
    prof = [[round(xs[i], 3), round(alt[i], 1), round(pw[i]), round(hr[i])]
            for i in range(0, n, step)]
    prof.append([round(xs[-1], 3), round(alt[-1], 1), round(pw[-1]), round(hr[-1])])
    lap_km = [[round(xs[l["i0"]], 2), round(xs[min(l["i1"], n - 1)], 2)] for l in laps]

    # ── 齒比軌跡：連續「有出力且同一檔」的區段，每段一筆 [起km, 迄km, 前盤, 飛輪] ──
    runs, cur = [], None
    moving = loaded = 0
    for i, p in enumerate(pts):
        if p.get("_gap"):
            continue
        moving += 1
        key = (p.get("gf"), p.get("gr")) if (p.get("gr") and pw[i] >= gear_min_w) else None
        if key:
            loaded += 1
        if cur is not None and cur[2] == key:
            cur[1] = xs[i]
        else:
            if cur is not None and cur[2] is not None and cur[1] > cur[0]:
                runs.append([round(cur[0], 3), round(cur[1], 3), cur[2][0], cur[2][1]])
            cur = [xs[i], xs[i], key]
    if cur is not None and cur[2] is not None and cur[1] > cur[0]:
        runs.append([round(cur[0], 3), round(cur[1], 3), cur[2][0], cur[2][1]])

    out = {"profile": prof, "lap_km": lap_km, "x_axis": "min" if indoor_x else "km",
           "sport": meta.get("sport"), "total_km": round(dist[-1], 2)}
    if runs:
        out["gear"] = {
            "runs": runs,
            "cogs": sorted({r[3] for r in runs}),
            "rings": sorted({r[2] for r in runs}),
            "min_w": gear_min_w,
            # 出力時間佔移動時間多少 —— 低於一半的話這張圖只代表一小段路，要講出來
            "load_pct": round(loaded / moving * 100, 1) if moving else None,
        }
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("tcx")
    ap.add_argument("--ftp", type=float)
    ap.add_argument("--weight", type=float)
    ap.add_argument("--height", type=float)
    ap.add_argument("--age", type=int)
    ap.add_argument("--maxhr", type=int)
    ap.add_argument("--resthr", type=int)
    ap.add_argument("--strava")
    ap.add_argument("--json", dest="out")
    ap.add_argument("--charts", help="另外輸出畫圖用的降採樣序列 JSON")
    a = ap.parse_args()
    r = analyze(a.tcx, ftp=a.ftp, weight=a.weight, height=a.height, age=a.age,
                maxhr=a.maxhr, resthr=a.resthr, strava=a.strava)
    if a.charts:
        with open(a.charts, "w", encoding="utf-8") as f:
            json.dump(chart_series(a.tcx), f, ensure_ascii=False, separators=(",", ":"))
        print(f"已寫出 {a.charts}")
    s = json.dumps(r, ensure_ascii=False, indent=2)
    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            f.write(s)
        print(f"已寫出 {a.out}")
    else:
        print(s)


if __name__ == "__main__":
    main()
