#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""build-recent-from-intervals.py —— 把 intervals.icu 的新活動補進 data/strava.json

為什麼需要這支：
  Strava 在 2026-10-12 把 App 停用（activities API 回 Application Inactive），他也決定不再用。
  但 strava.html／strava_cinema.html 的近期騎乘與重訓列表、月總結、教練脈絡、損益線月時數都還在
  讀 strava.json 的 recent_rides／recent_weights，於是畫面「卡在最後一次 Strava 同步那天」
  （recent_rides 停 10/06、recent_weights 停 10/08），而 FIT 管線其實一直是綠的。

做法：
  讀 data/fit/_activities.json（intervals 的活動清單）＋ data/fit/*.fit，把還不在
  recent_rides／recent_weights 的活動，用跟 fetch-strava.js 同一份欄位格式補進去。
  - 只看 Strava 凍結日（updated_at）前 3 天之後的活動，更早的歷史不碰。
  - 已經有的（日期相同、開始時間差 ≤ 10 分）不動，Strava 時代的紀錄原封不留。
  - id 用 intervals 的活動 id（'i196641732' 這種字串），並加 source:'intervals' 方便分辨。
  - polyline／route_stream 由 FIT 現算，格式與 Strava 版相同：
      route_stream 每點 [lat, lng, 心率, 時速 km/h, 海拔 m, 瓦數]
  - 冪等：重跑不會重複加。
  其餘 strava.json 欄位（summary／monthly_*／weekly_quest／power_prs）仍是 Strava 時代的凍結值，
  這支不碰。

用法：
  python3 scripts/build-recent-from-intervals.py          # 增量補
  python3 scripts/build-recent-from-intervals.py --dry    # 只列出會補哪些
"""
import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone

from fitparse import FitFile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIT_DIR = os.path.join(ROOT, "data", "fit")
STRAVA = os.path.join(ROOT, "data", "strava.json")
ACTS = os.path.join(FIT_DIR, "_activities.json")
ATHLETE = os.path.join(ROOT, "athlete", "gpt_教練前提資訊.json")

RIDE_TYPES = {"Ride", "VirtualRide", "GravelRide", "MountainBikeRide", "EBikeRide"}
WEIGHT_TYPES = {"WeightTraining", "Workout", "Crossfit"}
SAME_ACTIVITY_MIN = 10   # 同一天、開始時間差在這之內視為同一筆
STREAM_POINTS = 140      # route_stream 約略點數（Strava 版是 100–150）
POLY_POINTS = 240


def semicircles(v):
    return v * (180.0 / 2 ** 31) if v is not None else None


def encode_polyline(pts):
    """Google polyline，精度 5。"""
    out, plat, plng = [], 0, 0
    for lat, lng in pts:
        la, ln = round(lat * 1e5), round(lng * 1e5)
        for d in (la - plat, ln - plng):
            d = ~(d << 1) if d < 0 else d << 1
            while d >= 0x20:
                out.append(chr((0x20 | (d & 0x1F)) + 63))
                d >>= 5
            out.append(chr(d + 63))
        plat, plng = la, ln
    return "".join(out)


def find_fit(act_id, date):
    pre = f"{date}_{act_id}_"
    for f in os.listdir(FIT_DIR):
        if f.startswith(pre) and f.lower().endswith(".fit"):
            return os.path.join(FIT_DIR, f)
    return None


def read_fit(path):
    ff = FitFile(path)
    sess = {}
    for m in ff.get_messages("session"):
        sess = m.get_values()
        break
    recs = []
    for m in ff.get_messages("record"):
        v = m.get_values()
        recs.append({
            "lat": semicircles(v.get("position_lat")),
            "lng": semicircles(v.get("position_long")),
            "hr": v.get("heart_rate"),
            "w": v.get("power"),
            "cad": v.get("cadence"),
            "spd": v.get("enhanced_speed") if v.get("enhanced_speed") is not None else v.get("speed"),
            "alt": v.get("enhanced_altitude") if v.get("enhanced_altitude") is not None else v.get("altitude"),
        })
    return sess, recs


def route_from(recs):
    gps = [r for r in recs if r["lat"] is not None and r["lng"] is not None]
    if len(gps) < 10:
        return None, None
    step = max(1, len(gps) // STREAM_POINTS)
    stream = []
    for r in gps[::step]:
        stream.append([
            round(r["lat"], 5), round(r["lng"], 5),
            int(r["hr"]) if r["hr"] is not None else None,
            round(r["spd"] * 3.6, 1) if r["spd"] is not None else None,
            int(round(r["alt"])) if r["alt"] is not None else None,
            int(r["w"]) if r["w"] is not None else None,
        ])
    pstep = max(1, len(gps) // POLY_POINTS)
    poly = encode_polyline([(r["lat"], r["lng"]) for r in gps[::pstep]])
    return poly, stream


def minutes(date, hhmm):
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def already_have(lst, date, hhmm, act_id):
    t = minutes(date, hhmm)
    for r in lst:
        if str(r.get("id")) == act_id:
            return True
        if r.get("date") == date and r.get("time") and abs(minutes(date, r["time"]) - t) <= SAME_ACTIVITY_MIN:
            return True
    return False


def ftp():
    try:
        return json.load(open(ATHLETE, encoding="utf-8"))["cycling"]["ftp_watts"]["latest"] or 238
    except Exception:
        return 238


def build_ride(act_id, a, sess, recs, path):
    date, hhmm = a["start_date_local"][:10], a["start_date_local"][11:16]
    poly, stream = route_from(recs)
    trainer = a.get("type") == "VirtualRide" or poly is None
    moving = int(a.get("moving_time") or sess.get("total_timer_time") or 0)
    dist_m = a.get("distance") or sess.get("total_distance") or 0
    avg_w = sess.get("avg_power")
    np_w = sess.get("normalized_power") or (round(a["icu_weighted_avg_watts"]) if a.get("icu_weighted_avg_watts") else None) or avg_w
    f = ftp()
    if_score = round(np_w / f, 3) if np_w else None
    tss = round(moving * np_w * (np_w / f) / (f * 3600) * 100) if np_w and moving else None
    cad = sess.get("avg_cadence")
    r = {
        "id": act_id,
        "name": a.get("name") or "騎乘",
        "date": date,
        "time": hhmm,
        "distance_km": round(dist_m / 10) / 100,
        "moving_time_sec": moving,
        "moving_time_hr": round(moving / 360) / 10,
        "elevation_m": round(a.get("total_elevation_gain") or sess.get("total_ascent") or 0),
        "avg_speed_kmh": round(dist_m / moving * 36) / 10 if moving else 0,
        "avg_cadence_rpm": round(cad) if cad else None,
        "avg_heartrate": round(sess["avg_heart_rate"]) if sess.get("avg_heart_rate") else None,
        "max_heartrate": round(sess["max_heart_rate"]) if sess.get("max_heart_rate") else None,
        "avg_watts": round(avg_w) if avg_w else None,
        "max_watts": round(sess["max_power"]) if sess.get("max_power") else None,
        "np_watts": round(np_w) if np_w else None,
        "trainer": trainer,
        "sport_type": a.get("type") or "Ride",
        "if_score": if_score,
        "tss": tss,
        "calories_kcal": round(a["calories"]) if a.get("calories") else None,
        "description": None,
        "polyline": poly,
        "top_laps": [],
        "source": "intervals",
    }
    if stream:
        r["route_stream"] = stream
    return r


def build_weight(act_id, a, sess):
    date, hhmm = a["start_date_local"][:10], a["start_date_local"][11:16]
    moving = int(a.get("moving_time") or sess.get("total_timer_time") or 0)
    return {
        "id": act_id,
        "name": a.get("name") or "重量訓練",
        "date": date,
        "time": hhmm,
        "moving_time_hr": round(moving / 360) / 10,
        "avg_heartrate": round(sess["avg_heart_rate"]) if sess.get("avg_heart_rate") else None,
        "max_heartrate": round(sess["max_heart_rate"]) if sess.get("max_heart_rate") else None,
        "description": None,
        "source": "intervals",
    }


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true")
    args = ap.parse_args(argv)

    acts = json.load(open(ACTS, encoding="utf-8"))
    acts = acts if isinstance(acts, dict) else {x["id"]: x for x in acts}
    strava = json.load(open(STRAVA, encoding="utf-8"))
    rides = strava.setdefault("recent_rides", [])
    weights = strava.setdefault("recent_weights", [])

    # 只補 Strava 凍結那天（updated_at）前 3 天之後的活動。更早的歷史 Strava 都有，而且室內重複、
    # 時間差幾分鐘的那些去重判斷是 Strava 時代做好的，不要被 intervals 的清單再灌一次。
    cutoff = (datetime.strptime(strava["updated_at"][:10], "%Y-%m-%d") - timedelta(days=3)).strftime("%Y-%m-%d")

    added_r = added_w = 0
    skipped = {}
    for act_id, a in sorted(acts.items(), key=lambda kv: kv[1].get("start_date_local", "")):
        typ = a.get("type")
        date, hhmm = a["start_date_local"][:10], a["start_date_local"][11:16]
        if date < cutoff:
            continue
        if typ in RIDE_TYPES:
            target = rides
        elif typ in WEIGHT_TYPES:
            target = weights
        else:
            skipped[typ] = skipped.get(typ, 0) + 1
            continue
        if already_have(target, date, hhmm, act_id):
            continue
        path = find_fit(act_id, date)
        if not path:
            print(f"  ⚠️  {date} {a.get('name')}：還沒有 FIT，下一班再補")
            continue
        try:
            sess, recs = read_fit(path)
        except Exception as e:  # 壞檔不擋整批
            print(f"  ⚠️  {os.path.basename(path)} 解析失敗：{e}")
            continue
        if target is rides:
            rec = build_ride(act_id, a, sess, recs, path)
            added_r += 1
        else:
            rec = build_weight(act_id, a, sess)
            added_w += 1
        print(f"  + {date} {hhmm} {typ} {rec['name']}")
        target.append(rec)

    for lst in (rides, weights):
        lst.sort(key=lambda r: (r["date"], r["time"]), reverse=True)

    if args.dry:
        print(f"(dry) 會補 騎乘 {added_r}、重訓 {added_w}")
        return 0
    if added_r or added_w:
        strava["recent_updated_from_intervals"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        with open(STRAVA, "w", encoding="utf-8") as f:
            json.dump(strava, f, ensure_ascii=False, indent=2)
            f.write("\n")
    other = f"；略過其他類型 {skipped}" if skipped else ""
    print(f"✅ strava.json：補騎乘 {added_r}、重訓 {added_w}{other}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
