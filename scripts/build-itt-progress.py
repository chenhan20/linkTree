#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""build-itt-progress.py —— 爬坡路段的「同功率換算時間」→ data/itt-progress.json

問題：同一條坡，這次 27:46／210W、上次 25:35／229W，到底有沒有進步？時間跟功率
一起變，原始時間看不出來。做法：用物理模型把每一次的成績換算成「如果用同一個
參考功率（該路段近一年均瓦的中位數，取整到 5W）會騎多久」，再看這條線往哪走。

模型（跟配速預估同一組參數，tools/tcx/analyze_tcx.solo_watts）：
  給定均坡 g、人車 88 kg、CdA 0.38（爬坡）、Crr 0.005、傳動 3%，
  解出功率 P 對應的穩態速度 v(P)；換算時間 = 實測時間 × v(P) ÷ v(P_ref)。
  只做 CLIMB 類路段（pacing.json 的 type）：平路有跟車與風，時間不跟功率成反比。

這是估計，不是量測，有四個前提寫在輸出的 caveats 裡：
  ‧ 體重不變（沒有逐日體重資料）
  ‧ 沒有風與氣溫修正（爬坡速度 8–14 km/h，空氣阻力只佔 1–3%，所以影響小，但熱天心率與功率都吃虧）
  ‧ 用整段均坡，不看段內形狀
  ‧ 換算時間不看配速：U 型（前面衝、中段垮）的趟會偏慢，早期有這種趟時進步會被高估
    （2026-10-06 實測：露營場 6 趟，中位數法 −6.5%，只看 7/21 之後的乾淨趟是 −1.8%）
  ‧ 單趟有 ±2–3% 的日間雜訊（配速、當天狀態），所以趨勢看「最近 3 趟中位 vs 前 3 趟中位」，
    不看兩點相減

趨勢判定（n≥6）：最近 3 趟換算時間中位 vs 前 3 趟中位，差 ≥1.5% 才說變快／變慢，否則持平。
n 在 4–5 之間：最近 1 趟 vs 前面的中位。n<4 不判。

用法：python3 scripts/build-itt-progress.py
排在 build-pacing.py 之後（讀它的 CLIMB 清單與 100 m 坡度）。純本機、不到一秒。
"""
import json
import os
import statistics as st
import sys
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools", "tcx"))
import analyze_tcx as A  # noqa: E402

ITT = os.path.join(ROOT, "data", "itt-segments.json")
PACING = os.path.join(ROOT, "data", "pacing.json")
OUT = os.path.join(ROOT, "data", "itt-progress.json")

MASS, CDA, CRR = 88.0, 0.38, 0.005
MIN_N = 4
FLAT_PCT = 1.5          # 判變快／變慢的門檻（%）


def speed(p_w, grade):
    """功率 → 穩態爬坡速度（m/s），二分逼近。"""
    lo, hi = 0.3, 25.0
    for _ in range(50):
        mid = (lo + hi) / 2
        if A.solo_watts(mid, grade, MASS, CDA, CRR) < p_w:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def fmt(sec):
    s = int(round(sec))
    return f"{s // 60}:{s % 60:02d}"


def main():
    itt = json.load(open(ITT, encoding="utf-8"))
    itt = itt if isinstance(itt, list) else itt["segments"]
    by_name = {s["name"]: s for s in itt}
    pacing = json.load(open(PACING, encoding="utf-8"))
    segs = pacing["segments"] if isinstance(pacing["segments"], list) else list(pacing["segments"].values())

    since = (datetime.now(timezone.utc) - timedelta(days=365)).strftime("%Y-%m-%d")
    out = []
    for p in segs:
        if p.get("type") != "CLIMB":
            continue
        s = by_name.get(p["name"])
        if not s:
            continue
        g100 = p.get("g100") or []
        if not g100:
            continue
        grade = st.mean(g100) / 100.0
        rows = [e for e in s.get("efforts", []) if (e.get("avg_watts") or 0) > 0 and (e.get("elapsed_sec") or 0) > 0]
        rows.sort(key=lambda e: (str(e["date"])[:10], e.get("start_time") or ""))
        if len(rows) < MIN_N:
            continue
        recent_w = [e["avg_watts"] for e in rows if str(e["date"])[:10] >= since] or [e["avg_watts"] for e in rows]
        ref = int(round(st.median(recent_w) / 5.0) * 5)
        v_ref = speed(ref, grade)
        series = []
        for e in rows:
            v = speed(e["avg_watts"], grade)
            eq = e["elapsed_sec"] * v / v_ref
            hr = e.get("avg_heartrate")
            series.append({
                "date": str(e["date"])[:10], "start_time": e.get("start_time"),
                "sec": round(e["elapsed_sec"], 1), "str": e.get("elapsed_str") or fmt(e["elapsed_sec"]),
                "w": e["avg_watts"], "hr": hr, "w_hr": round(e["avg_watts"] / hr, 2) if hr else None,
                "eq_sec": round(eq, 1), "eq_str": fmt(eq),
            })
        n = len(series)
        eqs = [x["eq_sec"] for x in series]
        recent = None
        if n >= 6:
            a, b = st.median(eqs[-3:]), st.median(eqs[-6:-3])
            basis = "最近 3 趟中位 vs 前 3 趟中位"
        else:
            a, b = eqs[-1], st.median(eqs[:-1])
            basis = "最近 1 趟 vs 前面的中位"
        pct = (a - b) / b * 100.0
        verdict = "faster" if pct <= -FLAT_PCT else "slower" if pct >= FLAT_PCT else "flat"
        recent = {"basis": basis, "low_sample": n < 10, "now_sec": round(a, 1), "now_str": fmt(a), "before_sec": round(b, 1),
                  "before_str": fmt(b), "delta_sec": round(a - b, 1), "delta_pct": round(pct, 1), "verdict": verdict}
        best = min(series, key=lambda x: x["eq_sec"])
        out.append({
            "id": s["id"], "name": s["name"], "length_m": p.get("L"), "grade_pct": round(grade * 100, 1),
            "ref_w": ref, "n": n, "series": series, "recent": recent,
            "best_eq": {"date": best["date"], "eq_str": best["eq_str"]},
        })

    doc = {
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "method": "同功率換算時間：用均坡與人車 88 kg／CdA 0.38／Crr 0.005 解穩態速度，把每次成績換算成參考功率下的時間",
        "caveats": [
            "估計不是量測：假設體重不變、沒有風與氣溫修正、用整段均坡",
            "單趟有 ±2–3% 的日間雜訊，趨勢看最近 3 趟中位 vs 前 3 趟中位，差 1.5% 以上才算變快／變慢",
            "換算時間不懲罰配速：前面衝、中段垮的那幾趟（U 型）會讓早期顯得慢，進步幅度可能被高估；樣本少於 10 趟的路段標 low_sample，只當方向",
            "只做爬坡路段（均坡大、速度低，時間大致跟功率成反比）；平路有跟車與風，不適用",
        ],
        "threshold_pct": FLAT_PCT,
        "segments": sorted(out, key=lambda x: -x["n"]),
    }
    try:
        old = json.load(open(OUT, encoding="utf-8"))
        if {k: v for k, v in old.items() if k != "updated_at"} == {k: v for k, v in doc.items() if k != "updated_at"}:
            doc["updated_at"] = old.get("updated_at", doc["updated_at"])
    except (OSError, json.JSONDecodeError):
        pass
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=1)
    print(f"✅ 寫入 data/itt-progress.json：{len(out)} 條爬坡路段")


if __name__ == "__main__":
    main()
