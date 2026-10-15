#!/usr/bin/env python3
"""把騎乘回放影片丟上 GitHub Release，抽海報，重建 data/ride-videos.json。

影片本身不進 repo（.git 已經 400 MB，GitHub Pages 建議上限 1 GB；Release 附件不算容量）。
repo 裡只放兩樣輕的東西：每支一張海報 jpg（assets/ride-videos/posters/<id>.jpg，約 45 KB）
和 data/ride-videos.json（intervals ID → 下載網址、海報、長度、大小）。頁面永遠只讀這個 json，
將來換託管只要改 BASE_URL 重跑一次。

用法（本機手動，不進 CI；渲染器在 tools/ride-video/，產出 <id>.mp4 的資料夾當 --src）：

  python3 scripts/publish-ride-videos.py --src /path/to/ride_videos/small        # 上傳缺的、抽缺的海報、重建 json
  python3 scripts/publish-ride-videos.py --src ... --clobber i175154372 i175155403  # 指定 id 覆蓋重傳（海報也重抽）
  python3 scripts/publish-ride-videos.py                                          # 不帶 --src：只從 Release 現況重建 json

Release 附件的幾個特性（2026-10-15 實測）：下載網址會 302 到一個一小時過期的簽章網址、
沒有 CORS、沒有快取標頭、Content-Disposition 是 attachment。所以海報一定要在這裡抽好 commit 進去
（瀏覽器抽不到），播放端用 preload=auto 一次抓完 4 MB 免得拖進度條撞到過期簽章。
"""
import argparse
import datetime as dt
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = "chenhan20/linkTree"
TAG = "ride-videos"
BASE_URL = f"https://github.com/{REPO}/releases/download/{TAG}"
POSTER_DIR = os.path.join(ROOT, "assets", "ride-videos", "posters")
OUT_JSON = os.path.join(ROOT, "data", "ride-videos.json")
ACTIVITIES = os.path.join(ROOT, "data", "fit", "_activities.json")
POSTER_AT = 80.0   # 秒：路線幾乎畫滿、騎士還在圖上、還沒進片尾成績單（片長 91 s = 2 片頭 + 86 回放 + 3 片尾）


def sh(*cmd, check=True, capture=True):
    p = subprocess.run(cmd, text=True, capture_output=capture)
    if check and p.returncode != 0:
        sys.exit(f"失敗：{' '.join(cmd)}\n{p.stderr or p.stdout}")
    return p


def release_assets():
    p = sh("gh", "release", "view", TAG, "--repo", REPO, "--json", "assets")
    return {a["name"]: a for a in json.loads(p.stdout)["assets"]}


def probe(path):
    p = sh("ffprobe", "-v", "error", "-show_entries", "format=duration:stream=width,height",
           "-of", "json", path)
    j = json.loads(p.stdout)
    v = next((s for s in j.get("streams", []) if "width" in s), {})
    return round(float(j["format"]["duration"]), 1), v.get("width"), v.get("height")


def decode_ok(path):
    """整支解一遍，h264 噴 NAL 錯誤就當壞檔（8/12 和 5/27 那兩支就是這樣壞的）。"""
    p = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "null", "-"], text=True, capture_output=True)
    return p.returncode == 0 and "Invalid NAL" not in p.stderr


def make_poster(mp4, jpg):
    os.makedirs(POSTER_DIR, exist_ok=True)
    sh("ffmpeg", "-v", "error", "-y", "-ss", str(POSTER_AT), "-i", mp4, "-frames:v", "1", "-q:v", "4", jpg)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", help="放 <id>.mp4 的資料夾（960×540 播放版）")
    ap.add_argument("--clobber", nargs="*", default=[], help="這些 id 覆蓋重傳＋重抽海報")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    acts = json.load(open(ACTIVITIES, encoding="utf-8"))
    assets = release_assets()
    print(f"Release {TAG}：目前 {len(assets)} 個附件")

    local = {}
    if a.src:
        for f in sorted(os.listdir(a.src)):
            if f.endswith(".mp4") and f[:-4].startswith("i") and ".broken" not in f:
                local[f[:-4]] = os.path.join(a.src, f)
        print(f"本機 {len(local)} 支")

    # 1. 上傳缺的（或 --clobber 指定的）
    todo = [i for i, p in local.items() if f"{i}.mp4" not in assets or i in a.clobber]
    bad = [i for i in todo if not decode_ok(local[i])]
    if bad:
        sys.exit(f"這幾支解碼有錯，不上傳：{bad}（先用 tools/ride-video 重產）")
    if todo:
        print(f"上傳 {len(todo)} 支：{' '.join(todo)}")
        if not a.dry_run:
            sh("gh", "release", "upload", TAG, "--repo", REPO, "--clobber", *[local[i] for i in todo], capture=False)
            assets = release_assets()

    # 2. 海報：缺的或 --clobber 的重抽
    for i, p in local.items():
        jpg = os.path.join(POSTER_DIR, f"{i}.jpg")
        if not os.path.exists(jpg) or i in a.clobber:
            print(f"海報 {i}")
            if not a.dry_run:
                make_poster(p, jpg)

    # 3. 重建 json：以 Release 現況為準（本機沒有的影片也會列進去，海報則以 repo 裡有沒有為準）
    videos = {}
    for name, asset in sorted(assets.items()):
        if not name.endswith(".mp4"):
            continue
        i = name[:-4]
        v = acts.get(i, {})
        rec = {
            "date": (v.get("start_date_local") or "")[:10],
            "start": v.get("start_date_local"),
            "name": v.get("name"),
            "moving_s": v.get("moving_time"),
            "distance_km": round((v.get("distance") or 0) / 1000, 1),
            "url": f"{BASE_URL}/{name}",
            "bytes": asset.get("size"),
            "poster": f"assets/ride-videos/posters/{i}.jpg" if os.path.exists(os.path.join(POSTER_DIR, f"{i}.jpg")) else None,
        }
        if i in local:
            rec["duration_s"], rec["w"], rec["h"] = probe(local[i])
        else:
            rec["duration_s"], rec["w"], rec["h"] = 91.0, 960, 540   # 全部同規格；沒本機檔時用已知值
        videos[i] = rec
    out = {
        "generated_at": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
        "release": {"repo": REPO, "tag": TAG, "base_url": BASE_URL,
                    "note": "下載網址 302 到一小時過期的簽章網址；無 CORS、無快取；播放端 preload=auto"},
        "count": len(videos),
        "videos": dict(sorted(videos.items(), key=lambda kv: kv[1]["start"] or "")),
    }
    if a.dry_run:
        print(json.dumps({k: v for k, v in out.items() if k != "videos"}, ensure_ascii=False, indent=1))
        return
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")
    missing_poster = [i for i, r in videos.items() if not r["poster"]]
    print(f"寫出 {OUT_JSON}：{len(videos)} 支" + (f"，{len(missing_poster)} 支沒海報：{missing_poster}" if missing_poster else ""))


if __name__ == "__main__":
    main()
