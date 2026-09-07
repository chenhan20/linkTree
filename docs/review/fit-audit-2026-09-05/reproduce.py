"""Read-only audit of the repository's two power-curve calculation paths.

Run from any directory: python3 docs/review/fit-audit-2026-09-05/reproduce.py
Requires the same fitdecode dependency as the existing FIT pipeline.
Prints JSON; does not rebuild reports, plans, scores, or source FIT files.
"""
import datetime as dt
import importlib.util
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools/tcx"))
import analyze_tcx as analysis

spec = importlib.util.spec_from_file_location("power_curve", ROOT / "scripts/build-power-curve.py")
curve = importlib.util.module_from_spec(spec)
spec.loader.exec_module(curve)

start = dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc)
points = [dict(t=start + dt.timedelta(seconds=i),
               w=300 if i < 600 or i >= 900 else 0,
               spd=5 if i < 600 or i >= 900 else 0)
          for i in range(1500)]
compressed = analysis.rolling_best([p["w"] for p in points if p["spd"] > .5], [1200])[1200]
continuous = curve.best_mean(curve.power_segments(points), 1200)
assert compressed == 300 and continuous == 225
gap_points = analysis.resample_1hz([
    dict(t=start, w=300, spd=5),
    dict(t=start + dt.timedelta(seconds=300), w=0, spd=0),
])
assert sum(p["w"] for p in gap_points) == 90000
drift = analysis.decoupling([dict(w=200, hr=140)] * 120 + [dict(w=200, hr=154)] * 120)
assert drift["pct"] == -9.1

out = {"as_of": "2026-09-05", "synthetic": {
    "protocol": "10min at 300W, 5min stopped at 0W, 10min at 300W",
    "compressed_20min_w": compressed, "elapsed_20min_w": continuous,
    "300sec_gap_forward_filled_kj": sum(p["w"] for p in gap_points) / 1000,
    "efficiency_change_with_hr_140_to_154_at_200w": drift,
}, "rides": []}
dates = ("2025-10-14", "2026-04-28", "2026-08-06", "2026-08-11",
         "2026-08-13", "2026-08-25", "2026-09-01", "2026-09-03")
for date in dates:
    for fit in sorted((ROOT / "data/fit").glob(date + "*.fit")):
        meta, laps, raw = analysis.parse_ride(str(fit))
        if not any(p.get("w") is not None for p in raw):
            continue
        resampled = analysis.resample_1hz(raw)
        moving = [p.get("w") or 0 for p in resampled if (p.get("spd") or 0) > .5]
        moving = moving or [p.get("w") or 0 for p in resampled]
        segments = curve.power_segments(raw)
        best = {n: curve.best_mean(segments, n) for n in (1200, 3600)}
        out["rides"].append({
            "date": date, "file": fit.name, "raw_points": len(raw),
            "resampled_points": len(resampled),
            "max_record_gap_sec": max((b["t"] - a["t"]).total_seconds()
                                      for a, b in zip(raw, raw[1:])),
            "filled_points": sum(bool(p.get("_gap")) for p in resampled),
            "missing_power_points": sum(p.get("w") is None for p in raw),
            "report_curve_w": analysis.rolling_best(moving, [1200, 3600]),
            "gap_split_curve_w": {n: round(w, 1) if w is not None else None for n, w in best.items()},
            "device_ftp_w": meta.get("fit", {}).get("threshold_power"),
        })
print(json.dumps(out, ensure_ascii=False, indent=2))
