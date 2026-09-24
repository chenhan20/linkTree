#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build-fit-extras.py —— FIT 裡平常沒讀到的東西，整理成 data/fit-extras.json

兩類：
  器材（build-tasks.py 的 gear 規則讀這一段）
    ‧ 功率計電池：device_info 的 battery_status（bike_power；new/good/ok/low/critical），取整趟最差的
      —— 2026-09-22 起 Giant 功率計回報 low，intervals 的 power_meter_battery 同一天從 OK 變 LOW
    ‧ Di2 電量：Shimano 那顆 device_info 的 battery_level（%），取整趟最低
    ‧ 左右平衡：record 的 left_right_balance（bit 7＝右腳，低 7 位是 %），功率加權
      —— 2026-08-27 起讀到右腳 9–11%，9/08 起回到 48–50%（見 memory lr-balance-broken-since-2026-08-27）
    ‧ 功率掉線：在騎（戶外速度 > 3 m/s；室內踏頻 > 30）又有踏頻、功率欄位卻是空的秒數，連續 ≥ 5 秒才算
  Garmin 沒公開的逐秒欄位（record 的 unknown 欄位，2026-09-24 對照值域解出來的，不是官方文件）
    ‧ 90  Performance Condition（體能狀態，開騎約 6 分鐘後才有值，−20…+20）
    ‧ 137 Stamina（%）、138 Potential Stamina（%）
    ‧ 143 Body Battery（出門時、騎完時）
    ‧ 136 是心率的複本，107 是旗標，135 還不知道 —— 不用

增量：已經算過的 FIT（檔名＋大小相同）直接沿用，只解新的；第一次跑大約兩分鐘。

用法：
  python3 scripts/build-fit-extras.py            # 寫 data/fit-extras.json
  python3 scripts/build-fit-extras.py --all      # 忽略快取全部重算
  python3 scripts/build-fit-extras.py --analyze  # 出門時的 Body Battery／體能狀態 跟那天表現的相關（不寫檔）
"""
import argparse
import io
import json
import math
import os
import random
import re
import statistics as st
from datetime import timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIT_DIR = os.path.join(ROOT, "data", "fit")
OUT = os.path.join(ROOT, "data", "fit-extras.json")
ACTS = os.path.join(ROOT, "data", "fit", "_activities.json")
TPE = timezone(timedelta(hours=8))
RIDE_RE = re.compile(r"(公路車|自行車)\.fit$")
BATT_RANK = {"new": 0, "good": 1, "ok": 2, "low": 3, "critical": 4}
GARMIN = {90: "pc", 137: "sta", 138: "sta_pot", 143: "bb"}


def load(path, default=None):
    try:
        return json.loads(io.open(path, encoding="utf-8").read())
    except Exception:
        return default


def scan(path):
    import fitdecode
    recs, pm, di2, hr_src, sport, sub = [], [], [], None, None, None
    with fitdecode.FitReader(path) as fr:
        for fm in fr:
            if not isinstance(fm, fitdecode.FitDataMessage):
                continue
            if fm.name == "record":
                r = {}
                for fd in fm.fields:
                    n = fd.def_num
                    if n == 253:
                        r["t"] = fd.value
                    elif n == 7:
                        r["w"] = fd.value
                    elif n == 4:
                        r["cad"] = fd.value
                    elif n in (6, 73):
                        if fd.value is not None:
                            r["spd"] = fd.value
                    elif n == 30:
                        r["lrb"] = fd.raw_value
                    elif n in GARMIN:
                        r[GARMIN[n]] = fd.raw_value
                if r.get("t") is not None:
                    recs.append(r)
            elif fm.name == "device_info":
                d = {fd.name: fd.value for fd in fm.fields if fd.value is not None}
                kind = str(d.get("antplus_device_type") or d.get("device_type") or "")
                if kind == "bike_power" and d.get("battery_status"):
                    pm.append(str(d["battery_status"]))
                elif str(d.get("manufacturer")) == "shimano" and d.get("battery_level") is not None:
                    di2.append(int(d["battery_level"]))
                if kind == "whr":
                    hr_src = hr_src or "wrist"
                elif kind == "heart_rate":
                    hr_src = "strap"
            elif fm.name == "session" and sport is None:
                sport = str(fm.get_value("sport", fallback="") or "")
                sub = str(fm.get_value("sub_sport", fallback="") or "")
    if not recs:
        return None
    recs.sort(key=lambda r: r["t"])
    t0 = recs[0]["t"]
    if t0.tzinfo is None:
        t0 = t0.replace(tzinfo=timezone.utc)
    indoor = "indoor" in sub or "virtual" in sub or not any(r.get("spd") for r in recs)
    # 左右平衡：功率加權的右腳 %
    num = den = cov = ped = 0.0
    for r in recs:
        w, v = r.get("w"), r.get("lrb")
        if w and (r.get("cad") or 0) > 20:
            ped += 1
            if isinstance(v, int) and v != 0xFF and v & 0x80:
                num += (v & 0x7F) * w; den += w; cov += 1
    # 功率掉線
    gap_s = gaps = run = 0
    for r in recs + [{}]:
        moving = (r.get("cad") or 0) > (30 if indoor else 20) and (indoor or (r.get("spd") or 0) > 3)
        if r and moving and r.get("w") is None:
            run += 1
        else:
            if run >= 5:
                gap_s += run; gaps += 1
            run = 0

    def series(key):
        return [r[key] for r in recs if isinstance(r.get(key), int) and r[key] not in (0xFF, 0x7F, -128)]

    def signed(v):
        return v - 256 if v > 127 else v
    bb, sta, stp = series("bb"), series("sta"), series("sta_pot")
    pcs = [(r["t"], signed(r["pc"])) for r in recs if isinstance(r.get("pc"), int) and r["pc"] not in (0x7F, 0x80, 0xFF)]

    def pc_at(minute):
        want = t0 + timedelta(minutes=minute)
        c = [v for t, v in pcs if abs(((t if t.tzinfo else t.replace(tzinfo=timezone.utc)) - want).total_seconds()) <= 60]
        return c[len(c) // 2] if c else None
    loc = t0.astimezone(TPE)
    out = {
        "date": loc.date().isoformat(), "start": loc.strftime("%H:%M"), "sec": len(recs),
        "indoor": indoor, "sport": sport or None,
        "pm": {"worst": max(pm, key=lambda s: BATT_RANK.get(s, -1)), "last": pm[-1]} if pm else None,
        "di2": min(di2) if di2 else None,
        "hr_src": hr_src,
        "lrb": round(num / den, 1) if den else None,
        "lrb_cov": round(cov / ped, 2) if ped else None,
        "pw_gap_s": gap_s, "pw_gaps": gaps,
        "bb": [bb[0], bb[-1]] if bb else None,
        "sta": [sta[0], sta[-1], min(sta)] if sta else None,
        "sta_pot": [stp[0], stp[-1], min(stp)] if stp else None,
        "pc": {"m10": pc_at(10), "m20": pc_at(20), "end": pcs[-1][1] if pcs else None} if pcs else None,
    }
    return out


# ---------------------------------------------------------------- 分析：出門時的狀態 vs 那天騎得怎樣
def spearman(x, y):
    def ranks(v):
        o = sorted(range(len(v)), key=lambda i: v[i]); r = [0.0] * len(v); i = 0
        while i < len(o):
            j = i
            while j + 1 < len(o) and v[o[j + 1]] == v[o[i]]:
                j += 1
            for k in range(i, j + 1):
                r[o[k]] = (i + j) / 2
            i = j + 1
        return r
    rx, ry = ranks(x), ranks(y)
    mx, my = st.mean(rx), st.mean(ry)
    sx = math.sqrt(sum((a - mx) ** 2 for a in rx)); sy = math.sqrt(sum((b - my) ** 2 for b in ry))
    return sum((a - mx) * (b - my) for a, b in zip(rx, ry)) / (sx * sy) if sx and sy else 0.0


def perm_p(x, y, n=4000, seed=7):
    r0 = abs(spearman(x, y)); rnd = random.Random(seed); yy = list(y); hit = 0
    for _ in range(n):
        rnd.shuffle(yy)
        if abs(spearman(x, yy)) >= r0:
            hit += 1
    return (hit + 1) / (n + 1)


def analyze(doc):
    """早上的恢復狀態 vs 當天爬坡最大努力（2026-09-24 第一次跑）。

    表現＝當天所有爬坡計時段（itt-config type=CLIMB、≥ 5 分鐘）裡最高的「平均功率 ÷ 當時 eFTP」
    （intervals 的 icu_rolling_ftp），一天一個值 —— 同一趟四等分那種重複段不會重複計數。
    跟 2026-08-27 驗睡眠那次不同：那次看的是整趟 IF／EF，會被「那天排什麼課」污染；
    爬坡計時段是他每次都會用力的地方，比較接近「那天身體給得出多少」。
    還是分不開「給不出來」跟「那天不想用力」，所以畫面寫的是「相關」不是「因為」。
    """
    acts = load(ACTS, {}) or {}
    well = load(os.path.join(ROOT, "data", "fit", "_wellness.json"), {}) or {}
    cfg = load(os.path.join(ROOT, "data", "itt-config.json"), {}) or {}
    segs = {x["id"]: x for x in (load(os.path.join(ROOT, "data", "itt-segments.json"), []) or [])}
    by = {}
    for a in acts.values():
        s = str(a.get("start_date_local") or "")
        if a.get("type") in ("Ride", "VirtualRide"):
            by[(s[:10], s[11:16])] = a
    climb = {x["id"] for x in cfg.get("segments") or [] if x.get("type") == "CLIMB"}
    day = {}
    for sid in climb:
        for e in (segs.get(sid) or {}).get("efforts") or []:
            x = doc["rides"].get(e.get("fit") or "")
            if not x or not e.get("avg_watts") or (e.get("elapsed_sec") or 0) < 300:
                continue
            ftp = (by.get((x["date"], x["start"])) or {}).get("icu_rolling_ftp")
            if not ftp:
                continue
            r = e["avg_watts"] / ftp
            if x["date"] not in day or r > day[x["date"]]["y"]:
                day[x["date"]] = {"y": r, "x": x}
    wdays = sorted(k for k in well if re.match(r"^\d{4}-\d\d-\d\d$", k))

    def hrv_z(d):
        """早上 HRV 相對前 60 天常態（跟第 01 章那條常態帶同一個算法）。"""
        v = (well.get(d) or {}).get("hrv")
        hist = [well[k]["hrv"] for k in wdays if k < d and k >= _shift(d, -60) and (well[k] or {}).get("hrv")]
        if not v or len(hist) < 20:
            return None
        m, sd = st.mean(hist), st.pstdev(hist)
        return (v - m) / sd if sd else None
    W = lambda d, k: (well.get(d) or {}).get(k)
    preds = [
        ("hrv", "早上 HRV", lambda v, d: W(d, "hrv")),
        ("rhr", "靜息心率", lambda v, d: W(d, "restingHR")),
        ("bb", "出門時 Body Battery", lambda v, d: (v["x"].get("bb") or [None])[0]),
        ("sleep", "睡眠時數", lambda v, d: (W(d, "sleepSecs") or 0) / 3600 or None),
        ("tsb", "TSB", lambda v, d: (W(d, "ctl") - W(d, "atl")) if W(d, "ctl") is not None and W(d, "atl") is not None else None),
        ("pc", "Garmin 體能狀態（第 20 分鐘）", lambda v, d: (v["x"].get("pc") or {}).get("m20")),
    ]
    tests = []
    for key, label, f in preds:
        pts = [(f(v, d), v["y"]) for d, v in day.items()]
        pts = [q for q in pts if q[0] is not None]
        if len(pts) < 12:
            continue
        xs, ys = [q[0] for q in pts], [q[1] for q in pts]
        tests.append({"key": key, "x": label, "n": len(pts), "r": round(spearman(xs, ys), 3), "p": round(perm_p(xs, ys), 4)})

    def groups(fn, cuts):
        out = []
        for label, lo, hi in cuts:
            ys = [v["y"] for d, v in day.items() if fn(v, d) is not None and lo <= fn(v, d) < hi]
            out.append({"label": label, "n": len(ys), "median": round(st.median(ys), 3) if ys else None})
        return out
    bbf = lambda v, d: (v["x"].get("bb") or [None])[0]
    zf = lambda v, d: hrv_z(d)
    return {
        "metric": "當天爬坡計時段最大努力（平均功率 ÷ 當時 eFTP）",
        "days": len(day),
        "tests": tests,
        "points": sorted([{"d": d, "y": round(v["y"], 3), "bb": bbf(v, d), "z": (round(zf(v, d), 2) if zf(v, d) is not None else None)}
                          for d, v in day.items()], key=lambda q: q["d"]),
        "by_bb": groups(bbf, [("< 35", -1, 35), ("35–54", 35, 55), ("≥ 55", 55, 101)]),
        "by_hrv": groups(zf, [("低於常態", -99, -1), ("常態內", -1, 1), ("高於常態", 1, 99)]),
    }


def _shift(d, k):
    from datetime import date
    return (date.fromisoformat(d) + timedelta(days=k)).isoformat()


def main(argv=None):
    ap = argparse.ArgumentParser(description="FIT 裡的器材狀態與 Garmin 未公開欄位")
    ap.add_argument("--all", action="store_true", help="忽略快取全部重算")
    ap.add_argument("--analyze", action="store_true", help="印相關分析，不寫檔")
    ap.add_argument("-q", "--quiet", action="store_true")
    args = ap.parse_args(argv)

    old = load(OUT, {}) or {}
    rides = {} if args.all else dict(old.get("rides") or {})
    sizes = {} if args.all else dict(old.get("_sizes") or {})
    files = sorted(f for f in os.listdir(FIT_DIR) if RIDE_RE.search(f))
    new = 0
    for f in files:
        size = os.path.getsize(os.path.join(FIT_DIR, f))
        if f in rides and sizes.get(f) == size:
            continue
        try:
            x = scan(os.path.join(FIT_DIR, f))
        except Exception as e:                 # 壞掉的單一 FIT 不該讓整批失敗
            print(f"  ⚠️  跳過 {f}：{str(e).splitlines()[-1][:100]}")
            continue
        if x:
            rides[f] = x; sizes[f] = size; new += 1
            if not args.quiet:
                print(f"  {f}：電池 {x['pm'] and x['pm']['worst']}、Di2 {x['di2']}、平衡 {x['lrb']}、BB {x['bb']}")
    for f in list(rides):
        if f not in files:                     # FIT 被刪了就跟著拿掉
            rides.pop(f); sizes.pop(f, None)
    doc = {
        "_comment": "FIT 裡平常沒讀到的東西（器材電量、左右平衡、功率掉線、Garmin 未公開的 Body Battery／Stamina／體能狀態）。"
                    "由 scripts/build-fit-extras.py 產生，不要手改；欄位說明在那支的檔頭。",
        "rides": dict(sorted(rides.items())),
        "_sizes": dict(sorted(sizes.items())),
    }
    if args.analyze:
        an = analyze(doc)
        print(f"  {an['metric']}，{an['days']} 天")
        for r in an["tests"]:
            print(f"  {r['x']:<20} n={r['n']:<3} r={r['r']:+.3f}  p={r['p']:.4f}")
        print("  Body Battery：" + "、".join(f"{g['label']} {g['median']}（{g['n']}）" for g in an["by_bb"]))
        print("  早上 HRV：" + "、".join(f"{g['label']} {g['median']}（{g['n']}）" for g in an["by_hrv"]))
        return
    doc["analysis"] = analyze(doc)
    io.open(OUT, "w", encoding="utf-8").write(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")
    print(f"✅ 寫入 {os.path.relpath(OUT, ROOT)}（{len(rides)} 趟，這次新解 {new} 趟）")


if __name__ == "__main__":
    main()
