#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build-pacing.py —— 每一條計時段的「最佳配速」與「照今天的體能會騎幾分」→ data/pacing.json

給誰用：strava_pelican 第 05 章的配速圖、計時賽的「最佳配速」影子；10/13 中社後測前看功率怎麼分。

模型：
  ‧ 體能：最近 90 天騎乘 FIT 的最大平均功率曲線，擬合兩參數臨界功率 P = CP + W′/t（5–20 分鐘）。
    2026-09-24：3–20 分鐘擬合得 CP 243／W′ 11.3 kJ，但 20 分鐘會高估 9 W（模型 252、實際最佳 243）；
    改 5–20 分鐘，20 分鐘對得上。對照 intervals：eFTP 239、它對 9/15 那趟的擬合 CP 234／W′ 20 kJ。
  ‧ 路：data/segment-grades.json 的 25 m 坡度（FIT 高度算的），±50 m 平滑。
  ‧ 物理：跟 analyze_tcx.solo_watts 同一組（人車 88 kg、Crr 0.005、傳動 3%、rho 1.18），
    CdA 平路 0.36、坡度 > 3% 的路段 0.38（爬坡握上把）。每 25 m 用穩態速度 —— 坡上速度慢，動能項很小。
  ‧ W′bal：Skiba 微分模型（高於 CP 線性消耗、低於 CP 依剩下的比例回充）。
最佳化：功率隨坡度線性變化 P(x) = P0 + β·(坡度 − 平均坡度)，限制在 0.6–1.6 CP；
  每個 β 用二分法找 P0，讓 W′ 剛好在終點用完；β 取時間最短的那個。β = 0 就是「同一個功率騎到底」。
校準：同一段過去的努力，把實際的逐 25 m 功率丟進同一個模型 → 模型時間；實際 ÷ 模型的中位數，
  用來把最佳配速的模型時間換成「實際會看到的秒數」（彎道、路面、紅綠燈每條不一樣）。
  平路段排除團騎（data/itt-conditions.json 的 flag），不然會被團騎拉快。

用法：
  python3 scripts/build-pacing.py          # 寫 data/pacing.json
  python3 scripts/build-pacing.py -v       # 每條路段印預估時間與配速
  python3 scripts/build-pacing.py --only 1761462
"""
import argparse
import io
import json
import math
import os
import re
import statistics as st
import sys
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools", "tcx"))

import analyze_tcx as A                              # noqa: E402
from segments import _match_efforts, load_segments  # noqa: E402

FIT_DIR = os.path.join(ROOT, "data", "fit")
OUT = os.path.join(ROOT, "data", "pacing.json")
TPE = timezone(timedelta(hours=8))
RIDE_RE = re.compile(r"(公路車|自行車)\.fit$")

MASS, CRR, ETA, G, RHO = 88.0, 0.005, 0.97, 9.81, 1.18
CDA_FLAT, CDA_CLIMB, CLIMB_GRADE = 0.36, 0.38, 0.03
MMP_DAYS = 90
MMP_D = [60, 120, 180, 300, 480, 600, 720, 900, 1200, 1800, 2400, 3600]
FIT_D = [300, 480, 600, 720, 900, 1200]               # 兩參數模型只信 5–20 分鐘（計時段多半 8–30 分）
STEP = 25.0


def load(path, default=None):
    try:
        return json.loads(io.open(path, encoding="utf-8").read())
    except Exception:
        return default


# ---------------------------------------------------------------- 體能：MMP → CP／W′
def ride_mmp(path):
    import fitdecode
    ts, pw = [], []
    with fitdecode.FitReader(path) as fr:
        for fm in fr:
            if isinstance(fm, fitdecode.FitDataMessage) and fm.name == "record":
                t = fm.get_value("timestamp", fallback=None)
                if t is not None:
                    ts.append(t); pw.append(fm.get_value("power", fallback=None) or 0)
    if len(ts) < 60:
        return {}
    t0 = ts[0]; n = int((ts[-1] - t0).total_seconds()) + 1
    s = [0] * n
    for t, p in zip(ts, pw):
        i = int((t - t0).total_seconds())
        if 0 <= i < n:
            s[i] = p
    ps = [0]
    for v in s:
        ps.append(ps[-1] + v)
    return {str(d): round(max(ps[i + d] - ps[i] for i in range(n - d + 1)) / d, 1) for d in MMP_D if n >= d}


def fit_cp(mmp):
    pts = [(1 / d, mmp[str(d)]) for d in FIT_D if mmp.get(str(d))]
    if len(pts) < 4:
        return None
    mx = st.mean(x for x, _ in pts); my = st.mean(y for _, y in pts)
    b = sum((x - mx) * (y - my) for x, y in pts) / sum((x - mx) ** 2 for x, _ in pts)
    return {"cp": round(my - b * mx, 1), "wp": round(b)}


# ---------------------------------------------------------------- 物理
def speed(p, g):
    """穩態速度：0.5ρCdA v³ + m g (crr + g) v = ηP。上坡／平路用卡當公式，下坡用牛頓法。"""
    cda = CDA_CLIMB if g > CLIMB_GRADE else CDA_FLAT
    a = 0.5 * RHO * cda; b = MASS * G * (CRR + g); c = max(p, 1.0) * ETA
    if b >= 0:
        q = c / (2 * a); r = math.sqrt(q * q + (b / (3 * a)) ** 3)
        return max(0.5, math.copysign(abs(q + r) ** (1 / 3), q + r) + math.copysign(abs(q - r) ** (1 / 3), q - r))
    v = 12.0
    for _ in range(30):
        f = a * v ** 3 + b * v - c; df = 3 * a * v * v + b
        v = max(0.5, v - f / df) if df > 0 else v * 1.2
    return max(0.5, v)


def ride_plan(powers, grades, cp, wp):
    """每 25 m 一格：回傳 (總秒數, 最低 W′bal, 逐格累積秒數)。"""
    wbal, t, lo, cum = wp, 0.0, wp, []
    for p, g in zip(powers, grades):
        dt = STEP / speed(p, g)
        if p > cp:
            wbal -= (p - cp) * dt
        else:
            wbal += (cp - p) * dt * (wp - wbal) / wp
        lo = min(lo, wbal); t += dt; cum.append(t)
    return t, lo, cum


def smooth(xs, k=2):
    return [st.mean(xs[max(0, i - k):i + k + 1]) for i in range(len(xs))]


def optimize(grades, cp, wp):
    """P(x) = P0 + β·(g − ḡ)，W′ 剛好用完。回傳最快的那組與 β=0（平均功率）那組。"""
    gm = st.mean(grades)
    lo_w, hi_w = 0.6 * cp, 1.6 * cp

    def best_p0(beta):
        a, b = 0.6 * cp, 1.6 * cp
        for _ in range(28):
            m = (a + b) / 2
            pw = [min(hi_w, max(lo_w, m + beta * (g - gm) * 100)) for g in grades]
            _, low, _ = ride_plan(pw, grades, cp, wp)
            if low >= 0:
                a = m
            else:
                b = m
        pw = [min(hi_w, max(lo_w, a + beta * (g - gm) * 100)) for g in grades]
        t, low, cum = ride_plan(pw, grades, cp, wp)
        return {"beta": beta, "p0": a, "t": t, "pw": pw, "cum": cum}
    even = best_p0(0.0)
    if max(grades) - min(grades) < 0.02:          # 平路：坡度沒什麼變化，平均功率就是最佳
        return even, even
    runs = [best_p0(float(b)) for b in range(0, 31, 2)]
    return min(runs, key=lambda r: r["t"]), even


# ---------------------------------------------------------------- 實際的努力
def effort_bins(pts, st0, elapsed, n):
    """effort 的逐秒功率 → 以距離分成 n 格（FIT 距離縮放到路段長），每格時間加權平均功率。"""
    seg = [q for q in pts if st0 <= q["t"] <= st0 + timedelta(seconds=elapsed)]
    if len(seg) < 30 or seg[0].get("dist") is None:
        return None
    d0 = seg[0]["dist"]; span = (seg[-1]["dist"] or d0) - d0
    if span < n * STEP * 0.5:
        return None
    k = n * STEP / span
    acc = [[0.0, 0] for _ in range(n)]
    for q in seg:
        i = min(n - 1, int(((q.get("dist") or d0) - d0) * k / STEP))
        acc[i][0] += q.get("w") or 0; acc[i][1] += 1
    out, last = [], None
    for s, c in acc:
        v = s / c if c else last
        out.append(v if v is not None else 0.0); last = out[-1]
    return out


def wbal_min_time(pts, st0, elapsed, cp, wp):
    w, lo = wp, wp
    for q in pts:
        if not (st0 <= q["t"] <= st0 + timedelta(seconds=elapsed)):
            continue
        p = q.get("w") or 0
        if p > cp:
            w -= p - cp
        else:
            w += (cp - p) * (wp - w) / wp
        lo = min(lo, w)
    return lo


def per100(xs, n, nd=0):
    """每 25 m 的序列 → 每 100 m 一個值（給畫面，檔案小）。"""
    return [round(st.mean(xs[i:i + 4]), nd) if nd else round(st.mean(xs[i:i + 4])) for i in range(0, n, 4)]


def main(argv=None):
    ap = argparse.ArgumentParser(description="計時段最佳配速與預估成績")
    ap.add_argument("-v", "--verbose", action="store_true")
    ap.add_argument("--only", nargs="*")
    args = ap.parse_args(argv)

    old = load(OUT, {}) or {}
    mmp_cache = dict(old.get("_mmp") or {})
    today = datetime.now(TPE).date()
    cut = (today - timedelta(days=MMP_DAYS)).isoformat()
    files = sorted(f for f in os.listdir(FIT_DIR) if RIDE_RE.search(f) and f[:10] >= cut)
    for f in files:
        if f not in mmp_cache:
            try:
                mmp_cache[f] = ride_mmp(os.path.join(FIT_DIR, f))
            except Exception as e:
                print(f"  ⚠️  跳過 {f}：{str(e).splitlines()[-1][:80]}")
    mmp_cache = {f: v for f, v in mmp_cache.items() if f[:10] >= cut}
    mmp, mmp_from = {}, {}
    for f, v in mmp_cache.items():
        for d, w in v.items():
            if w > mmp.get(d, 0):
                mmp[d] = w; mmp_from[d] = f[:10]
    cpw = fit_cp(mmp)
    if not cpw or cpw["cp"] > (mmp.get("1200") or 9e9) * 1.03 or not (5000 <= cpw["wp"] <= 35000):
        acts = load(os.path.join(ROOT, "data", "fit", "_activities.json"), {}) or {}
        eftp = max((a.get("icu_rolling_ftp") or 0) for a in acts.values())
        cpw = {"cp": float(eftp), "wp": round(max(6000, (mmp.get("300", eftp) - eftp) * 300)), "fallback": "eFTP"}
    cp, wp = cpw["cp"], cpw["wp"]
    print(f"  體能：CP {cp:.0f} W、W′ {wp / 1000:.1f} kJ（{len(mmp_cache)} 趟、{MMP_DAYS} 天）")

    grades = load(os.path.join(ROOT, "data", "segment-grades.json"), {}) or {}
    cfg = load(os.path.join(ROOT, "data", "itt-config.json"), {}) or {}
    typ = {s["id"]: s.get("type") for s in cfg.get("segments") or []}
    itt = {s["id"]: s for s in (load(os.path.join(ROOT, "data", "itt-segments.json"), []) or [])}
    cond = load(os.path.join(ROOT, "data", "itt-conditions.json"), {}) or {}
    flag = {(e["seg"], e["date"], e["start_time"]): e.get("flag") for e in cond.get("efforts") or []}
    segdefs = load_segments()

    segs = {}
    want = [int(x) for x in args.only] if args.only else [int(k) for k in grades if k.isdigit()]
    by_fit = {}
    for sid in want:
        gr = grades.get(str(sid))
        if not gr or not gr.get("grade") or sid not in itt:
            continue
        g = smooth([x / 100 for x in gr["grade"]])
        n = len(g)
        opt, even = optimize(g, cp, wp)
        segs[sid] = {"name": itt[sid].get("name"), "type": typ.get(sid), "L": round(n * STEP), "n": n, "g": g,
                     "opt": opt, "even": even, "efforts": []}
        for e in itt[sid].get("efforts") or []:
            if e.get("fit") and e.get("start_time"):
                by_fit.setdefault(e["fit"], []).append((sid, e))
    # 實際努力：每個 FIT 只解一次
    for fit, lst in sorted(by_fit.items()):
        path = os.path.join(FIT_DIR, fit)
        if not os.path.exists(path):
            continue
        try:
            _, _, pts = A.parse_ride(path)
        except Exception:
            continue
        gps = [q for q in pts if q.get("lat") is not None and q.get("lon") is not None]
        sids = {sid for sid, _ in lst}
        det = [x for sd in segdefs.values() if sd["id"] in sids for x in _match_efforts(sd, gps, path)]
        for sid, e in lst:
            cand = [x for x in det if x["segment_id"] == sid and x["start_time"][11:16] == e["start_time"]]
            if not cand:
                continue
            st0 = datetime.fromisoformat(cand[0]["start_time"]); el = cand[0]["elapsed_sec"]
            s = segs[sid]
            pw = effort_bins(pts, st0, el, s["n"])
            if not pw:
                continue
            t_model, _, _ = ride_plan(pw, s["g"], cp, wp)
            # 同一個平均功率、平均騎（時間加權平均＝這段的平均功率）：差值就是「忽快忽慢」本身的代價
            t_step = [STEP / speed(p, g) for p, g in zip(pw, s["g"])]
            avg_t = sum(p * t for p, t in zip(pw, t_step)) / sum(t_step)
            t_even_same, _, _ = ride_plan([avg_t] * s["n"], s["g"], cp, wp)
            s["efforts"].append({"date": e["date"], "start_time": e["start_time"], "elapsed": round(el, 1),
                                 "avg_w": e.get("avg_watts"), "pw": pw, "t_model": t_model, "t_even_same": t_even_same,
                                 "tw": t_step,
                                 "wbal_min": round(wbal_min_time(pts, st0, el, cp, wp)),
                                 "flag": flag.get((sid, e["date"], e["start_time"]))})

    out = {}
    for sid, s in segs.items():
        efs = sorted(s["efforts"], key=lambda x: (x["date"], x["start_time"]))
        clean = [x for x in efs if not x.get("flag")]
        ratios = [x["elapsed"] / x["t_model"] for x in clean if x["t_model"] > 0]
        # 單騎的努力不到 4 筆就不信這條路自己的校準（河濱段幾乎都是團騎）：
        # 平路用 build-itt-conditions.py 36 筆單騎量到的 +1.8%，爬坡用各條爬坡校準的中位 1.04
        cal = st.median(ratios) if len(ratios) >= 4 else (1.018 if s["type"] == "ENDURANCE" else 1.04)
        n = s["n"]
        opt, even = s["opt"], s["even"]
        rec = {
            "name": s["name"], "type": s["type"], "L": s["L"],
            "cal": {"ratio": round(cal, 3), "n": len(ratios)},
            "opt": {"t": round(opt["t"] * cal, 1), "avg": round(sum(opt["pw"]) / n), "beta": opt["beta"],
                    "w100": per100(opt["pw"], n), "t100": [round(opt["cum"][min(n - 1, i + 3)] * cal, 1) for i in range(0, n, 4)]},
            "even": {"t": round(even["t"] * cal, 1), "w": round(even["p0"])},
            "g100": per100([x * 100 for x in s["g"]], n, 1),
        }
        pick = {}
        if efs:
            pick["last"] = efs[-1]
            pick["best"] = min(efs, key=lambda x: x["elapsed"])
        for k, x in pick.items():
            # 開頭 20% 與最後 30%（以距離切）的時間加權平均功率，對全程平均的比例
            def seg_avg(a, b):
                idx = range(int(a * n), max(int(a * n) + 1, int(b * n)))
                tt = sum(x["tw"][i] for i in idx)
                return sum(x["pw"][i] * x["tw"][i] for i in idx) / tt if tt else None
            whole = seg_avg(0, 1)
            rec[k] = {"date": x["date"], "start_time": x["start_time"], "elapsed": x["elapsed"], "avg_w": x["avg_w"],
                      "w100": per100(x["pw"], n), "wbal_min": x["wbal_min"], "flag": x.get("flag"),
                      "start_w": round(seg_avg(0, 0.2)), "end_w": round(seg_avg(0.7, 1)), "avg_tw": round(whole),
                      "uneven_s": round((x["t_model"] - x["t_even_same"]) * cal, 1)}
        out[str(sid)] = rec
        if args.verbose and s["type"] == "CLIMB" and efs:
            b, l = rec.get("best") or {}, rec.get("last") or {}
            print(f"  {str(s['name'])[:18]:<18} 同功率到底 {rec['even']['w']} W → {rec['even']['t'] / 60:5.2f} 分（最佳配速 {rec['opt']['t'] / 60:5.2f}）"
                  f"｜PR {b.get('elapsed', 0) / 60:5.2f} 分 {b.get('avg_w')} W｜最近 {l.get('date')} {l.get('elapsed', 0) / 60:5.2f} 分 "
                  f"開頭 {l.get('start_w')} → 結尾 {l.get('end_w')} W、忽快忽慢 {l.get('uneven_s')} 秒｜校準 {cal:.3f}（{len(ratios)}）")
    doc = {
        "_comment": "計時段最佳配速與今天體能的預估。由 scripts/build-pacing.py 產生，不要手改；模型說明在那支的檔頭。"
                    "w100／g100／t100 是每 100 m 一格（功率 W、坡度 %、累積秒數）。",
        "generated": today.isoformat(),
        "athlete": {"cp": cp, "wp": wp, **({"fallback": cpw["fallback"]} if cpw.get("fallback") else {}),
                    "mmp": {d: [mmp[d], mmp_from[d]] for d in sorted(mmp, key=int)}, "days": MMP_DAYS, "rides": len(mmp_cache)},
        "model": {"mass": MASS, "crr": CRR, "eta": ETA, "rho": RHO, "cda_flat": CDA_FLAT, "cda_climb": CDA_CLIMB, "step": STEP},
        "segments": out,
        "_mmp": dict(sorted(mmp_cache.items())),
    }
    # 一條路段一行：檔案小（~70 KB），git diff 也看得出是哪一條變了
    comp = lambda v: json.dumps(v, ensure_ascii=False, separators=(",", ":"))
    body = ",\n".join(f"{comp(k)}:{comp(v)}" for k, v in doc.items() if k not in ("segments", "_mmp"))
    segs_txt = ",\n".join(f" {comp(k)}:{comp(v)}" for k, v in doc["segments"].items())
    mmp_txt = ",\n".join(f" {comp(k)}:{comp(v)}" for k, v in doc["_mmp"].items())
    io.open(OUT, "w", encoding="utf-8").write("{" + body + ',\n"segments":{\n' + segs_txt + '\n},\n"_mmp":{\n' + mmp_txt + "\n}}\n")
    print(f"✅ 寫入 {os.path.relpath(OUT, ROOT)}（{len(out)} 條路段）")


if __name__ == "__main__":
    main()
