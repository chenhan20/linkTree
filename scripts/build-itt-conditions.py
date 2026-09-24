#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build-itt-conditions.py —— 平路 ITT 的「條件校正」：每一筆成績換算成「單騎、無風、標準空氣」的時間

為什麼要有這支：
  河濱計時段的成績差，很大一部分不是體能。2026-09-24 拿 98 筆平路 effort（26 天）驗的結果：
  ‧ 物理模型只吃那一趟的逐秒功率，就能把**單騎**的時間預測在 ±3.4% 以內（36 筆單騎，偏差 +1.8%）。
  ‧ 比模型快 5–10% 的全是團騎：8/24、12/10、1/14、6/18、9/17（draft_summary 23–53% 的平路在跟車）。
    **大稻埕→馬場町 10:50（12/10）與砍鴨頭 29:09（1/14）兩個 PR 都在團騎裡。**
  ‧ 風反而小：清晨／傍晚的 10 m 風中位只有 1–2 m/s，河堤又擋風。五個模型的風對單騎殘差的回歸斜率
    0.01–0.19（± 0.08–0.14），分不出是不是 0；連團騎一起算 0.23 ± 0.09。這裡取 K_WIND = 0.2
    （河道那一公尺高度吃到的是 10 m 模型風的兩成左右），風的影響多半是個位數秒。
  所以真正公平的比較是「換算時間」：只由功率決定，跟風、跟車都無關。
  實際時間 = 換算 + 風與空氣密度 + 跟車／其他。

做法：
  1. itt-config 裡 type=ENDURANCE 的路段、每一筆有 FIT 的 effort，用 segments.detect_efforts
     切到秒（itt-segments.json 的 start_time 只到分鐘）。
  2. 天氣：Open-Meteo historical-forecast，五個模型的 10 m 風「向量平均」＋氣溫／濕度／氣壓
     （只存用到的那兩個整點，快取在 data/weather/open-meteo.json；抓不到就下一班再抓）。
  3. 物理模型跟 analyze_tcx.solo_watts 同一組（CdA 0.36、Crr 0.005、人車 88 kg、傳動 3%），
     用那一趟的逐秒功率「重騎」同一段路：坡度從 FIT 高度（±60 m 平滑），風用 GPS 航向拆出逆風分量。
       t_equiv ＝ 無風、rho 1.18                   → 換算時間
       t_cond  ＝ 那天的風 × K_WIND、那天的空氣密度 → 那天條件下「單騎」該騎多快
     兩者都乘上單騎偏差 e^BIAS，才跟實際時間同一把尺。
  4. 實際 − t_cond ＝ 跟車／其他。兩種標記（只描述看得到的，不硬猜原因）：
       group ＝ 整趟 draft_summary ≥ 15% 而且這一段比單騎模型快超過 1σ → 畫面寫「團騎」
       fast  ＝ 整趟沒有明顯跟車，但這一段比單騎模型快超過 2σ → 「偏快」（黏到路人、或模型沒抓到的順風）

天氣資料：Open-Meteo（CC BY 4.0），會把 effort 的日期與路段附近的座標送過去（2026-09-24 本人同意）。

用法：
  python3 scripts/build-itt-conditions.py            # 寫 data/itt-conditions.json
  python3 scripts/build-itt-conditions.py -v         # 每條路段印實際最快與換算最快
  python3 scripts/build-itt-conditions.py --calibrate # 重跑校準（印 K_WIND 回歸與單騎偏差，不寫檔）
"""
import argparse
import io
import json
import math
import os
import ssl
import statistics as st
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools", "tcx"))

import analyze_tcx as A                              # noqa: E402
from segments import _match_efforts, load_segments  # noqa: E402

FIT_DIR = os.path.join(ROOT, "data", "fit")
OUT = os.path.join(ROOT, "data", "itt-conditions.json")
WX_CACHE = os.path.join(ROOT, "data", "weather", "open-meteo.json")
TPE = timezone(timedelta(hours=8))

# 物理（跟 analyze_tcx.solo_watts / estimate-indoor-distance.py 同一組）
MASS, CDA, CRR, ETA, G = 88.0, 0.36, 0.005, 0.97, 9.81
RHO_STD = 1.18
# 校準值（2026-09-24，--calibrate 重算）：單騎 36 筆的中位殘差與離散
BIAS = 0.018          # 實際比模型慢 1.8%（河濱的彎、減速帶、坡道）
SD = 0.034
K_WIND = 0.2          # 10 m 模型風 → 騎士高度的有效逆風
DRAFT_RIDE_PCT = 15   # 整趟 draft_summary 的跟車比例門檻（analyze_tcx 自己用 15%）

MODELS = ["ecmwf_ifs", "jma_msm", "gfs_seamless", "icon_seamless", "ecmwf_ifs025"]
VARS = ["wind_speed_10m", "wind_direction_10m", "temperature_2m", "relative_humidity_2m", "surface_pressure"]
API = "https://historical-forecast-api.open-meteo.com/v1/forecast"


def load(path, default=None):
    try:
        return json.loads(io.open(path, encoding="utf-8").read())
    except Exception:
        return default


def _ssl_ctx():
    try:
        import certifi                      # 本機 macOS 的 python.org 版沒有系統 CA（CLAUDE.md 那條坑）
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()


# ---------------------------------------------------------------- 天氣
def grid_key(lat, lon):
    return "%.2f,%.2f" % (round(lat / 0.05) * 0.05, round(lon / 0.05) * 0.05)


def fetch_weather(cache, need):
    """need: {grid: set('YYYY-MM-DDTHH')}。缺的整點才打 API，一個格點一次打完。"""
    ctx = _ssl_ctx()
    for g, hours in need.items():
        have = cache.setdefault(g, {})
        miss = sorted(h for h in hours if h not in have)
        if not miss:
            continue
        lat, lon = g.split(",")
        q = {"latitude": lat, "longitude": lon, "start_date": miss[0][:10], "end_date": miss[-1][:10],
             "hourly": ",".join(VARS), "models": ",".join(MODELS), "wind_speed_unit": "ms", "timezone": "Asia/Taipei"}
        try:
            with urllib.request.urlopen(API + "?" + urllib.parse.urlencode(q), timeout=60, context=ctx) as r:
                d = json.load(r)
        except Exception as e:                # 天氣抓不到不該讓整班失敗；沒快取到的下一班再抓
            print(f"  ⚠️  Open-Meteo {g}：{str(e)[:120]}")
            continue
        H = d.get("hourly") or {}
        idx = {t: i for i, t in enumerate(H.get("time") or [])}
        for h in miss:
            i = idx.get(h + ":00")
            if i is None:
                continue
            row = {}
            for m in MODELS:
                vals = [H.get(f"{v}_{m}", [None] * (i + 1))[i] for v in VARS]
                if all(v is not None for v in vals):
                    row[m] = [round(x, 2) for x in vals]
            if row:                           # 全是 None（太新、模型還沒進檔）就不存，下一班再抓
                have[h] = row
        print(f"  ☁️  Open-Meteo {g}：{sum(1 for h in miss if h in have)}/{len(miss)} 個整點")


def weather_at(cache, g, when):
    """when 是台北時間；兩個整點線性內插。風用向量平均（五個模型、兩個整點都是），不平均角度。"""
    h0 = when.replace(minute=0, second=0, microsecond=0)
    f = (when - h0).total_seconds() / 3600
    rows = []
    for hh, wgt in ((h0, 1 - f), (h0 + timedelta(hours=1), f)):
        row = (cache.get(g) or {}).get(hh.strftime("%Y-%m-%dT%H"))
        if not row:
            return None
        rows.append((row, wgt))
    u = v = T = RH = P = 0.0
    for row, wgt in rows:
        ms = list(row.values())
        for ws, wd, t, rh, p in ms:
            u += wgt * ws * math.sin(math.radians(wd)) / len(ms)
            v += wgt * ws * math.cos(math.radians(wd)) / len(ms)
            T += wgt * t / len(ms); RH += wgt * rh / len(ms); P += wgt * p / len(ms)
    es = 6.112 * math.exp(17.67 * T / (T + 243.5)); pv = RH / 100 * es
    rho = (P - pv) * 100 / (287.05 * (T + 273.15)) + pv * 100 / (461.5 * (T + 273.15))
    return {"ms": math.hypot(u, v), "from": (math.degrees(math.atan2(u, v)) + 360) % 360, "temp": T, "rho": rho}


# ---------------------------------------------------------------- 物理
def bearing(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    y = math.sin(lo2 - lo1) * math.cos(la2)
    x = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(lo2 - lo1)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def prep(seg_pts, t0):
    """effort 的逐秒資料 → 距離、航向、坡度、功率（空值往前補）。"""
    import bisect
    n = len(seg_pts)
    T = [(p["t"] - t0).total_seconds() for p in seg_pts]
    d0 = seg_pts[0]["dist"] or 0.0
    D = [(p["dist"] or d0) - d0 for p in seg_pts]
    H = []
    for i in range(n):
        a, b = max(0, i - 5), min(n - 1, i + 5)
        pa, pb = seg_pts[a], seg_pts[b]
        if pa.get("lat") is not None and pb.get("lat") is not None and (pa["lat"], pa["lon"]) != (pb["lat"], pb["lon"]):
            H.append(bearing((pa["lat"], pa["lon"]), (pb["lat"], pb["lon"])))
        else:
            H.append(H[-1] if H else 0.0)
    GR = []
    for i in range(n):
        lo = bisect.bisect_left(D, D[i] - 60); hi = min(n - 1, bisect.bisect_right(D, D[i] + 60) - 1)
        a0, a1 = seg_pts[lo].get("alt"), seg_pts[hi].get("alt")
        g = (a1 - a0) / (D[hi] - D[lo]) if D[hi] - D[lo] > 20 and a0 is not None and a1 is not None else 0.0
        GR.append(max(-0.08, min(0.08, g)))
    W, last = [], 0.0
    for p in seg_pts:
        if p.get("w") is not None:
            last = p["w"]
        W.append(last)
    v0 = seg_pts[0].get("spd") or (D[-1] / max(T[-1], 1))
    return {"T": T, "D": D, "H": H, "G": GR, "W": W, "L": D[-1], "avg_w": sum(W) / len(W), "v0": v0}


def sim(p, head_ms=0.0, wind_from=0.0, rho=RHO_STD):
    """用逐秒功率把同一段路騎一遍（0.25 秒一步，含加減速），回傳秒數。head_ms 是騎士高度的風速。"""
    T, D, H, GR, W, L = p["T"], p["D"], p["H"], p["G"], p["W"], p["L"]
    n = len(T)
    v, d, t, dt, j, ti = p["v0"], 0.0, 0.0, 0.25, 0, 0
    limit = T[-1] * 3 + 600
    while d < L and t < limit:
        while ti + 1 < n and T[ti + 1] <= t:
            ti += 1
        pw = W[ti] if t <= T[-1] else p["avg_w"]     # 模擬比較慢：超出實際秒數的部分用平均功率
        while j + 1 < n and D[j + 1] <= d:
            j += 1
        va = v + head_ms * math.cos(math.radians(wind_from - H[j]))
        f = pw * ETA / max(v, 1.0) - (CRR * MASS * G + MASS * G * GR[j] + 0.5 * rho * CDA * va * abs(va))
        v = max(0.5, v + f / (MASS * 1.03) * dt)      # 1.03：輪組轉動慣量
        step = v * dt
        if d + step >= L:
            return t + (L - d) / v
        d += step; t += dt
    return t


def mean_headwind(p, w):
    """沿路徑的平均逆風分量（10 m 高度、m/s、正＝逆風），給畫面寫「順／逆」用。"""
    if not w:
        return None
    return sum(w["ms"] * math.cos(math.radians(w["from"] - h)) for h in p["H"]) / len(p["H"])


# ---------------------------------------------------------------- 主流程
def collect(verbose=False):
    cfg = load(os.path.join(ROOT, "data", "itt-config.json"), {}) or {}
    flat = {s["id"] for s in cfg.get("segments") or [] if s.get("type") == "ENDURANCE"}
    itt = {s["id"]: s for s in (load(os.path.join(ROOT, "data", "itt-segments.json"), []) or [])}
    segdefs = {k: v for k, v in load_segments().items() if v["id"] in flat}
    by_fit = {}
    for sid in flat:
        for e in (itt.get(sid) or {}).get("efforts") or []:
            if e.get("fit") and e.get("start_time"):
                by_fit.setdefault(e["fit"], []).append((sid, e))
    rows = []
    for fit, lst in sorted(by_fit.items()):
        path = os.path.join(FIT_DIR, fit)
        if not os.path.exists(path):
            continue
        try:
            _, _, pts = A.parse_ride(path)
            # 跟 segments.detect_efforts 一樣，只是不再解析第二次 FIT
            gps = [q for q in pts if q.get("lat") is not None and q.get("lon") is not None]
            det = [x for sd in segdefs.values() for x in _match_efforts(sd, gps, path)]
            cells, _, _ = A._ride_cells(A.resample_1hz(pts), 250.0, 80.0)
            ds = A.draft_summary(cells, MASS)
        except Exception as ex:               # 壞掉的單一 FIT 不該讓整批失敗
            print(f"  ⚠️  跳過 {fit}：{str(ex).splitlines()[-1][:100]}")
            continue
        for sid, e in lst:
            cand = [x for x in det if x["segment_id"] == sid and x["start_time"][11:16] == e["start_time"]]
            if not cand:
                continue
            st0 = datetime.fromisoformat(cand[0]["start_time"])
            en = st0 + timedelta(seconds=cand[0]["elapsed_sec"])
            seg_pts = [q for q in pts if st0 <= q["t"] <= en]
            if len(seg_pts) < 30:
                continue
            lats = [q["lat"] for q in seg_pts if q.get("lat") is not None]
            lons = [q["lon"] for q in seg_pts if q.get("lon") is not None]
            rows.append({"seg": sid, "e": e, "fit": fit, "start": st0.astimezone(TPE), "elapsed": cand[0]["elapsed_sec"],
                         "p": prep(seg_pts, st0), "grid": grid_key(st.mean(lats), st.mean(lons)),
                         "ride_draft_pct": ds["draft_pct"] if ds else None})
        if verbose:
            print(f"  {fit}：{len(lst)} 筆")
    return rows


def calibrate(rows, cache):
    """印出單騎偏差與 K_WIND 的回歸（不寫檔）。改了模型參數或累積更多單騎趟就重跑。"""
    X, Y, Xa, Ya = [], [], [], []
    for r in rows:
        w = weather_at(cache, r["grid"], r["start"] + timedelta(seconds=r["elapsed"] / 2))
        if not w:
            continue
        t0 = sim(r["p"], 0.0, 0.0, w["rho"]); t1 = sim(r["p"], w["ms"], w["from"], w["rho"])
        x, y = math.log(t1 / t0), math.log(r["elapsed"] / t0)
        Xa.append(x); Ya.append(y)
        if (r["ride_draft_pct"] or 0) < DRAFT_RIDE_PCT:
            X.append(x); Y.append(y)

    def ols(x, y):
        mx, my = st.mean(x), st.mean(y)
        sxx = sum((a - mx) ** 2 for a in x)
        b = sum((a - mx) * (c - my) for a, c in zip(x, y)) / sxx
        res = [c - (my + b * (a - mx)) for a, c in zip(x, y)]
        return b, (sum(q * q for q in res) / (len(x) - 2) / sxx) ** 0.5, my - b * mx, st.pstdev(res)
    for label, x, y in (("單騎", X, Y), ("全部", Xa, Ya)):
        b, se, a, sd = ols(x, y)
        print(f"{label} n={len(x)}：K_WIND 回歸 {b:.2f} ± {se:.2f}、偏差 {a:+.3f}、殘差 SD {sd:.3f}")


def main(argv=None):
    ap = argparse.ArgumentParser(description="平路 ITT 條件校正（風、空氣密度、跟車）")
    ap.add_argument("-v", "--verbose", action="store_true")
    ap.add_argument("--calibrate", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)

    rows = collect(args.verbose)
    cache = load(WX_CACHE, {}) or {}
    need = {}
    for r in rows:
        mid = r["start"] + timedelta(seconds=r["elapsed"] / 2)
        h0 = mid.replace(minute=0, second=0, microsecond=0)
        need.setdefault(r["grid"], set()).update({h0.strftime("%Y-%m-%dT%H"), (h0 + timedelta(hours=1)).strftime("%Y-%m-%dT%H")})
    fetch_weather(cache, need)
    if not args.dry_run:
        os.makedirs(os.path.dirname(WX_CACHE), exist_ok=True)
        io.open(WX_CACHE, "w", encoding="utf-8").write(json.dumps(cache, ensure_ascii=False, sort_keys=True) + "\n")
    if args.calibrate:
        calibrate(rows, cache)
        return

    scale = math.exp(BIAS)
    out = []
    for r in rows:
        w = weather_at(cache, r["grid"], r["start"] + timedelta(seconds=r["elapsed"] / 2))
        p = r["p"]
        t_std = sim(p) * scale                                  # 無風、標準空氣
        rec = {"seg": r["seg"], "date": r["e"]["date"], "start_time": r["e"]["start_time"], "fit": r["fit"],
               "elapsed": round(r["elapsed"], 1), "avg_w": r["e"].get("avg_watts"),
               "t_equiv": round(t_std, 1), "ride_draft_pct": r["ride_draft_pct"]}
        if w:
            t_air = sim(p, 0.0, 0.0, w["rho"]) * scale            # 只換空氣密度
            t_cond = sim(p, w["ms"] * K_WIND, w["from"], w["rho"]) * scale
            resid = math.log(r["elapsed"] / t_cond)
            rec.update({
                "wind": {"ms": round(w["ms"], 1), "from": round(w["from"]), "head": round(mean_headwind(p, w), 1)},
                "temp": round(w["temp"], 1), "rho": round(w["rho"], 3),
                "air_s": round(t_air - t_std, 1), "wind_s": round(t_cond - t_air, 1),
                "draft_s": round(r["elapsed"] - t_cond, 1),
                "flag": ("group" if (r["ride_draft_pct"] or 0) >= DRAFT_RIDE_PCT and resid < -SD
                         else "fast" if resid < -2 * SD else None),
            })
        out.append(rec)
    out.sort(key=lambda x: (x["seg"], x["date"], x["start_time"]))

    segs = {}
    for rec in out:
        s = segs.setdefault(str(rec["seg"]), {"n": 0})
        s["n"] += 1
        key = f"{rec['date']} {rec['start_time']}"
        if not s.get("best_actual") or rec["elapsed"] < s["best_actual"]["elapsed"]:
            s["best_actual"] = {"at": key, "elapsed": rec["elapsed"], "flag": rec.get("flag")}
        if not s.get("best_equiv") or rec["t_equiv"] < s["best_equiv"]["t_equiv"]:
            s["best_equiv"] = {"at": key, "t_equiv": rec["t_equiv"], "elapsed": rec["elapsed"]}

    doc = {
        "_comment": "平路 ITT 條件校正。由 scripts/build-itt-conditions.py 產生，不要手改。"
                    "t_equiv＝同樣的逐秒功率、單騎、無風、rho 1.18 的換算秒數；實際 ＝ t_equiv ＋ air_s ＋ wind_s ＋ draft_s。",
        "generated": datetime.now(TPE).date().isoformat(),
        "model": {"mass": MASS, "cda": CDA, "crr": CRR, "eta": ETA, "rho_std": RHO_STD, "bias": BIAS, "sd": SD,
                  "k_wind": K_WIND, "draft_ride_pct": DRAFT_RIDE_PCT,
                  "weather": "Open-Meteo historical-forecast，" + "／".join(MODELS) + " 的 10 m 風向量平均（CC BY 4.0）"},
        "segments": segs,
        "efforts": out,
    }
    if args.verbose or args.dry_run:
        itt = {s["id"]: s for s in (load(os.path.join(ROOT, "data", "itt-segments.json"), []) or [])}
        for sid, s in sorted(segs.items(), key=lambda kv: -kv[1]["n"]):
            ba, be = s["best_actual"], s["best_equiv"]
            print(f"  {(itt.get(int(sid)) or {}).get('name', sid)[:22]:<22} n={s['n']:<3} 實際最快 {ba['at']} {ba['elapsed']:.0f}s"
                  f"{'（' + ba['flag'] + '）' if ba.get('flag') else ''} ｜ 換算最快 {be['at']} {be['t_equiv']:.0f}s")
        print(f"  團騎 {sum(1 for x in out if x.get('flag') == 'group')}、偏快 {sum(1 for x in out if x.get('flag') == 'fast')}／{len(out)} 筆")
    if args.dry_run:
        return
    io.open(OUT, "w", encoding="utf-8").write(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")
    print(f"✅ 寫入 {os.path.relpath(OUT, ROOT)}（{len(out)} 筆）")


if __name__ == "__main__":
    main()
