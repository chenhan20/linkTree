#!/usr/bin/env python3
"""
sync-intervals.py — 透過 intervals.icu 取得 Garmin 活動的「原始」FIT 檔。

這支補上 docs/ride-report-pipeline.md 第六節「尚未完成 → FIT 同步腳本」那一格，
並推翻該文件第四節的結論：Garmin 自動匯入其實有第四條路，而且能放進 GitHub Action。
詳見 docs/fit-pipeline.md。

為什麼走這條而不是直接打 Garmin:
  intervals.icu 是 Garmin 官方核准的 partner,Garmin 會主動 push 活動給它。
  所以這裡:
    ‧ 不需要你的 Garmin 帳密,也不存任何 Garmin token
    ‧ 沒有 Cloudflare、沒有 429、沒有鎖帳號風險
    ‧ 不挑 IP —— 機房、雲端、GitHub Actions 都能跑,你的電腦不用開
    ‧ 2026/3 打掉 garth 那次認證變動完全影響不到這條路

重點:要抓 /file(原始檔),不要抓 /fit-file。
  /file      → 你手錶產出的原始 FIT,原封不動(gzip 壓縮過)
  /fit-file  → intervals.icu 用處理過的資料「重新生成」的 FIT,會掉東西

用法:
    export INTERVALS_API_KEY=xxxxx        # 設定頁最下方拿
    python intervals_sync.py              # 增量同步
    python intervals_sync.py --backfill 90
    python intervals_sync.py --status
"""

from __future__ import annotations

import argparse
import base64
import gzip
import json
import logging
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import date, timedelta
from pathlib import Path

# ---------------------------------------------------------------- 設定 ----

API_BASE = "https://intervals.icu/api/v1"
API_KEY = os.getenv("INTERVALS_API_KEY", "").strip()
USER_AGENT = os.getenv(
    "INTERVALS_UA", "linkTree-fit-sync/1.0 (+https://github.com/chenhan20/linkTree)"
)
ATHLETE = os.getenv("INTERVALS_ATHLETE_ID", "0").strip()  # 0 = 我自己

OUT_DIR = Path(os.getenv("FIT_DIR", "data/fit")).expanduser()
STATE_FILE = Path(os.getenv("INTERVALS_STATE", str(OUT_DIR / "_state.json"))).expanduser()
LOG_FILE = OUT_DIR / "_sync.log"

MAX_PER_RUN = int(os.getenv("FIT_MAX_PER_RUN", "50"))
OVERLAP_DAYS = int(os.getenv("FIT_OVERLAP_DAYS", "14"))
DOWNLOAD_DELAY = float(os.getenv("FIT_DOWNLOAD_DELAY", "0.3"))  # 限制是 10 req/s
POST_HOOK = os.getenv("FIT_POST_HOOK", "").strip()

# intervals.icu 個人 API key 限制:5000/日、2500/15分、10/秒
# --------------------------------------------------------------------------

log = logging.getLogger("intervals_sync")


def setup_logging(verbose: bool = False) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    fmt = logging.Formatter("%(asctime)s %(levelname)-7s %(message)s", "%Y-%m-%d %H:%M:%S")
    log.setLevel(logging.DEBUG if verbose else logging.INFO)
    sh = logging.StreamHandler(sys.stdout)
    sh.setFormatter(fmt)
    log.addHandler(sh)
    fh = logging.FileHandler(LOG_FILE, encoding="utf-8")
    fh.setFormatter(fmt)
    log.addHandler(fh)


# --------------------------------------------------------------- HTTP ----


class ApiError(RuntimeError):
    def __init__(self, status: int, msg: str):
        super().__init__(f"HTTP {status}: {msg}")
        self.status = status


def _request(path: str, *, raw: bool = False):
    """Basic auth,使用者名稱是字面上的 'API_KEY',密碼才是你的金鑰。"""
    if not API_KEY:
        sys.exit("未設定 INTERVALS_API_KEY。到 intervals.icu 設定頁最下方複製個人 API key。")

    token = base64.b64encode(f"API_KEY:{API_KEY}".encode()).decode()
    req = urllib.request.Request(
        f"{API_BASE}{path}",
        headers={
            "Authorization": f"Basic {token}",
            "Accept": "*/*",
            # intervals.icu 在 Cloudflare 後面,urllib 預設的 "Python-urllib/3.x"
            # 會被當機器人擋掉 —— 金鑰完全正確也是 403,而且回的是 HTML 錯誤頁
            # 不是 JSON,很容易誤判成金鑰壞掉。給一個具名 UA 就過。
            "User-Agent": USER_AGENT,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            body = r.read()
    except urllib.error.HTTPError as e:
        detail = (e.read()[:300] or b"").decode("utf-8", "replace")
        if e.code == 401:
            detail += "  ← 401 通常是把金鑰填到使用者名稱了。使用者名稱必須是字面上的 API_KEY。"
        raise ApiError(e.code, detail) from None
    except urllib.error.URLError as e:
        raise RuntimeError(f"連線失敗: {e.reason}") from None

    return body if raw else json.loads(body)


def list_activities(oldest: str, newest: str) -> list[dict]:
    return _request(f"/athlete/{ATHLETE}/activities?oldest={oldest}&newest={newest}")


def fetch_original(activity_id: str) -> tuple[bytes, str]:
    """
    抓原始檔。回傳 (解壓後的 bytes, 副檔名)。
    /file 是 gzip 壓縮的原始上傳檔 —— 可能是 fit / gpx / tcx。
    """
    blob = _request(f"/activity/{activity_id}/file", raw=True)

    if blob[:2] == b"\x1f\x8b":  # gzip magic
        blob = gzip.decompress(blob)

    if len(blob) >= 12 and blob[8:12] == b".FIT":  # FIT header 的 data type
        return blob, ".fit"
    head = blob[:200].lstrip()
    if head[:5] == b"<?xml" or head[:1] == b"<":
        return blob, ".tcx" if b"TrainingCenterDatabase" in blob[:2000] else ".gpx"
    return blob, ".bin"


# -------------------------------------------------------------- 狀態 ----


# intervals.icu 活動物件共 183 欄。這裡挑的是「我們自己也在算、可以互相對帳」
# 以及「FIT 算不出來、只有 intervals 有」的兩類。全部來自既有的活動列表 call。
ACTIVITY_FIELDS = (
    # 負荷與強度（對帳我們自算的 TSS / IF / NP / VI）
    "icu_training_load", "icu_intensity", "icu_weighted_avg_watts",
    "icu_variability_index", "icu_efficiency_factor", "decoupling",
    "polarization_index", "trimp", "icu_atl", "icu_ctl",
    # 區間時間與當時的區間定義（報告的「強度分布」可以拿官方版對帳）
    "icu_zone_times", "icu_hr_zone_times", "icu_power_zones", "icu_hr_zones",
    "icu_ftp", "lthr",
    # 功率模型／eFTP。FTP 目前是手抄在 plan.json baseline，這是自動化的替代源。
    "icu_pm_cp", "icu_pm_w_prime", "icu_pm_p_max", "icu_pm_ftp",
    "icu_pm_ftp_secs", "icu_pm_ftp_watts", "icu_rolling_ftp", "icu_rolling_ftp_delta",
    # 裝置（報告的「裝置原始數據」目前只有 FIT 裡的欄位）
    "device_name", "power_meter", "power_meter_serial", "power_meter_battery",
    "crank_length", "file_type",
    # 只有 intervals 有、FIT 算不出來的
    "icu_joules_above_ftp", "icu_max_wbal_depletion", "icu_hrr", "coasting_time",
)

# wellness 想要的欄位。用 fields= 過濾，回傳小一點也少踩到 schema 變動。
WELLNESS_FIELDS = (
    "id", "ctl", "atl", "rampRate", "sportInfo",
    "weight", "restingHR", "hrv", "hrvSDNN", "vo2max",
    "sleepSecs", "sleepScore", "sleepQuality", "avgSleepingHR",
    "spO2", "respiration", "readiness", "steps", "bodyFat",
    "soreness", "fatigue", "stress", "mood", "motivation", "injury",
)


def load_state() -> dict:
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            log.warning("狀態檔壞掉,重新開始")
    return {"downloaded": []}


def save_activities(acts: list[dict]) -> None:
    """
    把活動的 metadata 存成 _activities.json。

    為什麼要這個檔:**FIT 格式裡沒有「活動名稱」這個欄位**,名稱只存在於
    intervals.icu 的活動物件。以前它只被 safe_name() 拿去組檔名,產報告時就
    拿不到了,所以標題唯一來源是 Strava(docs/fit-pipeline.md 問題 B)。

    刻意對「查詢區間內的全部活動」更新,而不是只對這次新下載的 ——
    已下載的活動在 sync() 迴圈裡會被 continue 掉,只寫新下載的話,
    你在 Garmin 或 intervals.icu 改了名字就永遠傳不進來。
    """
    path = OUT_DIR / "_activities.json"
    data = {}
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            log.warning("_activities.json 壞掉,重建")
    renamed = 0
    for a in acts:
        aid = str(a.get("id") or "")
        if not aid:
            continue
        name = a.get("name") or ""
        prev = (data.get(aid) or {}).get("name")
        if prev and name and prev != name:
            log.info("  改名: %s 「%s」→「%s」", aid, prev, name)
            renamed += 1
        rec = {
            "name": name,
            "type": a.get("type") or "",
            "start_date_local": a.get("start_date_local") or "",
        }
        # intervals.icu 已經替你算好的欄位。這一整包在同一個 call 裡本來就回傳了,
        # 以前只挑了 name/type/date 三欄,其餘直接丟掉 —— 額外成本是 0 個 API call。
        # 用途是「官方對帳源」:報告的 IF / NP / 區間時間全是我們自己從 FIT 算的,
        # 有這些就能兩邊對照,算錯了看得出來。詳見 docs/intervals-api-survey.md 第 2 節。
        for k in ACTIVITY_FIELDS:
            v = a.get(k)
            if v not in (None, "", [], {}):
                rec[k] = v
        data[aid] = rec
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1, sort_keys=True),
                   encoding="utf-8")
    tmp.replace(path)
    log.info("活動 metadata %d 筆 → %s%s", len(data), path.name,
             f"(其中 {renamed} 筆改名)" if renamed else "")


def sync_wellness(oldest: str, newest: str) -> int:
    """抓 wellness（每日 HRV / 靜息心率 / 睡眠 / 體重 / CTL-ATL / 每日 eFTP 快照）。

    為什麼值得：這些數字目前是手抄在 athlete/ 底下的，而 Garmin 本來就會自動
    餵給 intervals.icu（官方 wellness 功能頁列了 Garmin 在內的自動同步來源）。
    成本是每班 1 個 call，對 5000/日的額度是零頭。

    **刻意設計成不會讓整班失敗。** FIT 下載才是這支腳本的本業；wellness 是加值，
    端點回什麼、帳號實際啟用哪些欄位都還沒實地驗過（docs/intervals-api-survey.md
    的「待驗清單」），所以任何例外都只記一行 warning 就算了。
    """
    path = OUT_DIR / "_wellness.json"
    try:
        rows = _request(
            f"/athlete/{ATHLETE}/wellness?oldest={oldest}&newest={newest}"
            f"&fields={','.join(WELLNESS_FIELDS)}"
        )
    except Exception as e:                      # noqa: BLE001 —— 見上面的說明
        log.warning("wellness 抓取失敗(不影響 FIT 同步): %s", e)
        return 0
    if not isinstance(rows, list):
        log.warning("wellness 回傳的不是陣列(%s),跳過", type(rows).__name__)
        return 0

    data = {}
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            log.warning("_wellness.json 壞掉,重建")
    added = 0
    for r in rows:
        if not isinstance(r, dict):
            continue
        day = str(r.get("id") or "")           # wellness 的 id 就是日期
        if not day:
            continue
        rec = {k: v for k, v in r.items() if k != "id" and v not in (None, "", [], {})}
        if not rec:                            # 整天空白就不要佔一列
            continue
        if day not in data:
            added += 1
        data[day] = rec

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1, sort_keys=True),
                   encoding="utf-8")
    tmp.replace(path)
    log.info("wellness %d 天 → %s%s", len(data), path.name, f"(新增 {added})" if added else "")
    return added


def save_state(state: dict) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    state["downloaded"] = state.get("downloaded", [])[-5000:]
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(STATE_FILE)


def run_post_hook(path: Path) -> None:
    if not POST_HOOK:
        return
    cmd = POST_HOOK.replace("{fit}", str(path))
    log.info("  → hook: %s", cmd)
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=600)
        if r.returncode != 0:
            log.error("  hook 失敗 (exit %s): %s", r.returncode, (r.stderr or "").strip()[:500])
        elif r.stdout.strip():
            log.info("  hook 輸出: %s", r.stdout.strip()[:500])
    except subprocess.TimeoutExpired:
        log.error("  hook 逾時 (600s)")


def safe_name(activity: dict) -> str:
    aid = str(activity["id"])
    day = (activity.get("start_date_local") or "")[:10] or "nodate"
    raw = (activity.get("name") or activity.get("type") or "activity")[:40]
    slug = "".join(c if (c.isalnum() or c in "-_") else "-" for c in raw).strip("-") or "activity"
    return f"{day}_{aid}_{slug}"


# ------------------------------------------------------------ 主流程 ----


def sync(backfill_days: int | None = None) -> int:
    days = backfill_days or OVERLAP_DAYS
    oldest = (date.today() - timedelta(days=days)).isoformat()
    newest = (date.today() + timedelta(days=1)).isoformat()

    log.info("查詢 %s ~ %s", oldest, newest)
    try:
        acts = list_activities(oldest, newest)
    except ApiError as e:
        log.error("列出活動失敗: %s", e)
        return 2

    # 先存 metadata：這一步跟「有沒有新檔要下載」無關，改名也要能傳進來。
    save_activities(acts)

    # 每日身體狀態。放在下載迴圈之前，同理：就算沒有新 FIT 也要更新。
    sync_wellness(oldest, newest)

    # DOMS 預估（data/fit/_doms.json）。純衍生資料，只讀 _activities.json，
    # 所以放在 metadata 存檔之後、不依賴這次有沒有下載到新 FIT。算壞了不該擋同步。
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        import doms
        doc = doms.compute()
        log.info("DOMS 預估 %d 趟 → _doms.json", len(doc.get("activities", {})))
    except Exception as e:  # noqa: BLE001
        log.warning("DOMS 預估失敗（不影響同步）: %s", e)

    state = load_state()
    seen = set(state.get("downloaded", []))

    todo = []
    for a in acts:
        aid = str(a.get("id", ""))
        if not aid or aid in seen:
            continue
        if list(OUT_DIR.glob(f"*_{aid}_*.fit")):
            seen.add(aid)
            state.setdefault("downloaded", []).append(aid)
            continue
        todo.append(a)

    todo.sort(key=lambda x: x.get("start_date_local") or "")

    if not todo:
        log.info("沒有新活動。(區間內共 %d 筆,都已下載)", len(acts))
        save_state(state)
        return 0

    if len(todo) > MAX_PER_RUN:
        log.info("找到 %d 筆新活動,本次處理前 %d 筆。", len(todo), MAX_PER_RUN)
        todo = todo[:MAX_PER_RUN]
    else:
        log.info("找到 %d 筆新活動。", len(todo))

    ok = 0
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for a in todo:
        aid = str(a["id"])
        log.info("[%s] %s | %s | %s", aid, (a.get("start_date_local") or "?")[:16],
                 a.get("type", "?"), a.get("name") or "(無名稱)")
        try:
            data, ext = fetch_original(aid)
        except ApiError as e:
            if e.status == 404:
                log.info("  沒有原始檔(手動建立的活動),略過")
                state.setdefault("downloaded", []).append(aid)
                save_state(state)
                continue
            if e.status == 429:
                log.error("  429 限流,中止本次同步。已完成 %d 筆。", ok)
                save_state(state)
                return 3
            log.error("  下載失敗: %s", e)
            continue
        except Exception as e:  # noqa: BLE001
            log.error("  下載失敗: %s", e)
            continue

        dest = OUT_DIR / f"{safe_name(a)}{ext}"
        dest.write_bytes(data)
        log.info("  ✅ %s (%.1f KB)", dest.name, len(data) / 1024)
        if ext != ".fit":
            log.warning("  註:這筆的原始檔不是 FIT(是 %s),可能不是 Garmin 裝置錄的", ext)

        run_post_hook(dest)
        state.setdefault("downloaded", []).append(aid)
        save_state(state)
        ok += 1
        time.sleep(DOWNLOAD_DELAY)

    log.info("完成:新增 %d 筆 → %s", ok, OUT_DIR)
    return 0


def show_status() -> int:
    state = load_state()
    fits = sorted(OUT_DIR.glob("*.fit")) if OUT_DIR.exists() else []
    print(f"API key    : {'✅ 已設定' if API_KEY else '❌ 未設定 INTERVALS_API_KEY'}")
    print(f"輸出資料夾  : {OUT_DIR}  ({len(fits)} 個 .fit)")
    print(f"已記錄活動  : {len(state.get('downloaded', []))}")
    print(f"Post hook  : {POST_HOOK or '(未設定)'}")
    if fits:
        print(f"最新檔案    : {fits[-1].name}")
    if not API_KEY:
        return 1
    try:
        me = _request(f"/athlete/{ATHLETE}/profile")
        ath = me.get("athlete", me)
        print(f"連線測試    : ✅ {ath.get('name') or ath.get('id')}")
    except Exception as e:  # noqa: BLE001
        print(f"連線測試    : ❌ {e}")
        return 1          # 讓 CI 能在金鑰錯誤時直接失敗
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description="從 intervals.icu 取得 Garmin 原始 FIT")
    p.add_argument("--backfill", type=int, metavar="DAYS", help="回補過去 N 天")
    p.add_argument("--status", action="store_true")
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args()

    setup_logging(args.verbose)
    if args.status:
        return show_status()
    return sync(backfill_days=args.backfill)


if __name__ == "__main__":
    sys.exit(main())
