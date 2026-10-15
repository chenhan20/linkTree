"""把每趟超過一小時的戶外騎乘各渲染成一支 91 秒回放（呼叫 make_ride_bike.py，3 支並行，每支約 75 秒）。
產出 <OUTDIR>/<intervals id>.mp4 與 manifest.json，已有的跳過。渲染完跑 compress_all.sh 壓成 960×540，
再用 scripts/publish-ride-videos.py --src <OUTDIR>/small 上傳到 Release 並重建 data/ride-videos.json。
本機手動跑（macOS 字型：STHeiti／Arial Black），不進 CI。"""
import datetime as dt
import glob
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))          # tools/ride-video/ → repo 根目錄
OUTDIR = os.environ.get("RIDE_VIDEOS_OUT") or os.path.join(HERE, "ride_videos")   # 不要放進 repo，預設寫在這裡（.gitignore 有擋）
os.makedirs(OUTDIR, exist_ok=True)
MANIFEST = os.path.join(OUTDIR, "manifest.json")
DEADLINE = dt.datetime.now().replace(hour=16, minute=40, second=0, microsecond=0)

acts = json.load(open(f"{REPO}/data/fit/_activities.json", encoding="utf-8"))
ignore = set(json.load(open(f"{REPO}/data/fit/_ignore_activities.json", encoding="utf-8")).get("ids", []))
fits = glob.glob(f"{REPO}/data/fit/*.fit")
strava_idx = json.load(open(f"{REPO}/data/strava-archive/index.json", encoding="utf-8"))

def strava_for(start_local):
    t0 = dt.datetime.fromisoformat(start_local.replace("Z", ""))
    best = None
    for a in strava_idx:
        if a.get("type") != "Ride":
            continue
        t1 = dt.datetime.fromisoformat(a["start_date_local"].replace("Z", ""))
        gap = abs((t1 - t0).total_seconds())
        if gap <= 180 and (best is None or gap < best[0]):
            best = (gap, a["id"])
    return best[1] if best else None

rides = []
for iid, v in acts.items():
    if v.get("type") != "Ride" or iid in ignore or (v.get("moving_time") or 0) <= 3600:
        continue
    fit = [f for f in fits if f"_{iid}_" in os.path.basename(f)]
    if not fit:
        continue
    rides.append((v["start_date_local"], iid, v, fit[0]))
rides.sort()

manifest = json.load(open(MANIFEST, encoding="utf-8")) if os.path.exists(MANIFEST) else []
done = {m["id"] for m in manifest if m.get("status") == "ok"}
todo = [r for r in rides if r[1] not in done]
print(f"{len(rides)} rides, {len(todo)} to render, deadline {DEADLINE:%H:%M}", flush=True)

import concurrent.futures as cf
WORKERS = 3

def render(job):
    start, iid, v, fit = job
    d = dt.datetime.fromisoformat(start)
    area = v["name"]
    title = area
    dateline = f"{d:%Y.%m.%d %H:%M} · {area.split(' ')[0]} · {v.get('device_name') or ''}".strip(" ·")
    out = os.path.join(OUTDIR, f"{iid}.mp4")
    t0 = time.time()
    p = subprocess.run([sys.executable, os.path.join(HERE, "make_ride_bike.py"), fit, out, title, dateline],
                       capture_output=True, text=True)
    wav = out[:-4] + "_beat.wav"
    ok = p.returncode == 0 and os.path.exists(out)
    if os.path.exists(wav):
        os.remove(wav)
    return {
        "id": iid, "start": start, "name": area, "moving_s": v.get("moving_time"),
        "distance_km": round((v.get("distance") or 0) / 1000, 1),
        "video": out if ok else None, "status": "ok" if ok else "failed",
        "intervals_url": f"https://intervals.icu/activities/{iid}",
        "strava_url": (f"https://www.strava.com/activities/{sid}" if (sid := strava_for(start)) else None),
        "fit": os.path.basename(fit), "render_s": round(time.time() - t0),
        "error": None if ok else (p.stderr or p.stdout)[-400:],
    }

with cf.ThreadPoolExecutor(max_workers=WORKERS) as ex:
    futs = {ex.submit(render, job): job for job in todo}
    for n, f in enumerate(cf.as_completed(futs), 1):
        rec = f.result()
        manifest = [m for m in manifest if m["id"] != rec["id"]] + [rec]
        json.dump(manifest, open(MANIFEST, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print(f"[{n}/{len(todo)}] {dt.datetime.now():%H:%M} {rec['id']} {rec['status']} {rec['render_s']}s", flush=True)
print("ALL DONE", dt.datetime.now().strftime("%H:%M"), flush=True)
