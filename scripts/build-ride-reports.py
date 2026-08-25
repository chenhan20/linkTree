#!/usr/bin/env python3
"""
build-ride-reports.py — 掃 data/fit/，把夠格的活動產成 rides/<date>.html。

回答 docs/ride-report-pipeline.md 第七節第 3 點「自動產報告的門檻」：
一年 150+ 趟全出會讓 rides/ 變垃圾場，所以預設門檻是
**有功率 且 TSS ≥ 100**。例外的範圍（2026-08-13 修過，見 docs/fit-pipeline.md 問題 A）：
  ‧ 這天已經有 rides/notes/<date>.json（你花時間寫了評語，就是想要這頁）→ 完全豁免
  ‧ 這天有 ITT 成績（data/itt-segments.json 裡有該日期的 effort）
    → **只豁免 TSS 門檻，沒有功率資料仍然不合格**
  ‧ --force → 全豁免

另外同一次執行內做**同日去重**：同一天有多個 FIT（例：騎乘＋肌力訓練共用
rides/<date>.html）時，第一個產出（或 dry-run 判定會產出）的檔案勝出，
其餘同日檔案一律跳過並標 [同日]。這連 --overwrite / --force（workflow 的
rebuild:true）下「排序在後的肌力訓練覆蓋掉騎乘報告」的事故一起堵掉。

第七節第 2 點「評語留在哪」的答案：**在 repo 裡**，rides/notes/<date>.json。
2026-08-06 和 08-11 兩份都在。所以重生不會洗掉評語 —— 這支會自動帶 --notes。

用法:
    python3 scripts/build-ride-reports.py
    python3 scripts/build-ride-reports.py --force --only 2026-08-11
    python3 scripts/build-ride-reports.py --min-tss 80 --dry-run
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIT_DIR = Path(os.getenv("FIT_DIR", ROOT / "data/fit"))
RIDES = ROOT / "rides"
NOTES = RIDES / "notes"
TOOLS = ROOT / "tools/tcx"
ITT = ROOT / "data/itt-segments.json"
PLAN = ROOT / "data/plan.json"
BLOCK = ROOT / "data/training-block.json"

# 個人參數；CLI 沒給時 analyze_tcx.py 會優先讀 FIT 裡錶上的設定值
WEIGHT = os.getenv("ATHLETE_WEIGHT", "80")
HEIGHT = os.getenv("ATHLETE_HEIGHT", "173")
STRAVA_URL = os.getenv(
    "STRAVA_JSON_URL",
    "https://raw.githubusercontent.com/chenhan20/linkTree/master/data/strava.json",
)

DATE_RE = re.compile(r"(\d{4}-\d{2}-\d{2})")


def log(*a):
    print(*a, flush=True)


def itt_dates() -> set[str]:
    """有 ITT 成績的日期。這種活動一定要出報告，不管 TSS 多少。"""
    if not ITT.exists():
        return set()
    try:
        data = json.loads(ITT.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        log("⚠️ itt-segments.json 解析失敗，略過 ITT 判斷")
        return set()
    segs = data if isinstance(data, list) else data.get("segments", [])
    out = set()
    for s in segs:
        for e in (s or {}).get("efforts", []):
            d = str(e.get("date", ""))[:10]
            if DATE_RE.fullmatch(d):
                out.add(d)
    return out


def plan_dates() -> set[str]:
    """data/plan.json 裡有處方的日期。只有這些日子才會叫 score.py 去對帳 ——
    沒有處方的自由騎不套課表標準，也不必白跑一次評分。"""
    if not PLAN.exists():
        return set()
    try:
        data = json.loads(PLAN.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        log("⚠️ plan.json 解析失敗，這批全部不做課表對帳")
        return set()
    return {d for d in (data.get("days") or {}) if DATE_RE.fullmatch(str(d))}


def score(fit: Path, date: str, tmp: Path) -> Path | None:
    """跑 tools/tcx/score.py，回傳評分 JSON 的路徑；對不上或失敗就回 None。

    評分失敗絕不能拖垮報告：這裡吞掉所有錯誤，只記一行 log，報告照常產出
    （只是沒有「課表對帳」那一張卡）。
    """
    out = tmp / "score.json"
    cmd = [sys.executable, str(TOOLS / "score.py"), str(fit),
           "--date", date, "--json", str(out), "--quiet"]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if r.returncode != 0 or not out.exists():
        log(f"[評分] {date} 失敗，報告照常產出：{(r.stderr or r.stdout or '').strip()[:160]}")
        return None
    try:
        res = json.loads(out.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        log(f"[評分] {date} 輸出不是合法 JSON，略過")
        return None
    if not res.get("scored"):
        log(f"[評分] {date} 不評分：{res.get('reason')}")
        return None
    t = res.get("total") or {}
    log(f"[評分] {date} {res['plan'].get('label')} → {t.get('score')} 分（{t.get('grade')}）")
    return out


def fill_training_block(date: str, score_path: Path) -> None:
    """
    把評分結果回填進 data/training-block.json 的 sessions[].actual。

    那個檔的 _howToUse 寫著「實際值(actual)在 FIT 進來後回填」，但一直沒有
    任何東西做這件事 —— 所以 strava.html 的週期章永遠顯示「0 / 9 完成」、
    前後測永遠是「待 08/13 建立」，即使那天早就騎完、報告也產出來了。

    strava.html:3237-3311 讀的欄位契約：
        actual = {if, tss, vi, ride, note}，CAL/POST 另加 test（前後測數值）
    if/tss/vi 是**整趟**的數字（週期章看的是當天課表的整體強度），
    跟報告裡逐段對帳的分數是兩回事，兩個都要有才看得出全貌。
    """
    if not BLOCK.exists():
        return
    try:
        res = json.loads(score_path.read_text(encoding="utf-8"))
        blk = json.loads(BLOCK.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        log(f"[週期] {date} 回填略過：{e}")
        return

    sess = next((s for s in blk.get("sessions", []) if s.get("date") == date), None)
    if sess is None:
        return

    ride = res.get("ride") or {}
    total = res.get("total") or {}
    # note 會取代週期章的預設副標。這裡必須把「整趟強度」與「主課表執行」的
    # 落差講清楚 —— IF/TSS/VI 是整趟的數字，會被熱身、恢復、收操稀釋，
    # 所以可能三項全掛（顯示 UNDER）但主課表其實執行得很好。
    # 不寫的話又會變成用戶抱怨過的那種「看起來像在混」的誤導。
    wt = res.get("work_time") or {}
    pct = wt.get("pct")
    note = f"主課表對帳 {total.get('score')} 分（{total.get('grade')}）"
    if isinstance(pct, (int, float)):
        note += f" · 主課表做到處方的 {pct:.0f}%"
    # 只覆寫這支算得出來的欄位，其餘原封不動。actual 裡還住著手寫的東西：
    # coach[]（教練評語）、substituted / sub_name / sub_metrics（替代課表）。
    # 先前這裡是整顆 actual 直接指派，於是重生一次報告就把當天的評語洗掉 ——
    # 全量 --overwrite 會把整個區塊的評語一次清空。實測撞過（2026-08-25）。
    prev = sess.get("actual") or {}
    # note 的慣例是「自動前綴（對帳分數 · 處方百分比）＋ 人工補的尾巴」，
    # 尾巴用 ' · ' 接在後面。分數會隨演算法改變，所以前綴每次重生，尾巴留著。
    auto_n = 2 if isinstance(pct, (int, float)) else 1
    prev_note = prev.get("note") or ""
    if prev_note.startswith("主課表對帳"):
        tail = " · ".join(prev_note.split(" · ")[auto_n:])
    else:
        tail = prev_note          # 整句都是人寫的，全部當尾巴留下
    if tail:
        note += " · " + tail
    actual = {
        **prev,
        "if": ride.get("if"),
        "tss": ride.get("tss"),
        "vi": ride.get("vi"),
        "ride": date,                      # 週期章靠這個連到 rides/<date>.html
        "note": note,
    }

    # 前後測：只有校準日與驗收日有。取「疲勞後 20 分功率」。
    cal = res.get("calibration") or {}
    f20 = (cal.get("fatigued_20min") or {}).get("watts_20min")
    if f20 is not None and sess.get("code") in ("CAL", "POST"):
        actual["test"] = round(f20)

    if sess.get("actual") == actual:
        return
    sess["actual"] = actual
    tmp = BLOCK.with_suffix(".tmp")
    tmp.write_text(json.dumps(blk, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(BLOCK)
    log(f"[週期] {date} 回填：IF {actual['if']} · TSS {actual['tss']} · VI {actual['vi']}"
        + (f" · 前後測 {actual['test']}W" if "test" in actual else ""))


def date_of(fit: Path) -> str | None:
    """檔名是 sync-intervals.py 產的 YYYY-MM-DD_iNNN_slug.fit。"""
    m = DATE_RE.match(fit.name)
    return m.group(1) if m else None


AID_RE = re.compile(r"^\d{4}-\d{2}-\d{2}_([^_]+)_")


def aid_of(fit: Path) -> str:
    """從檔名取 intervals.icu 的活動 id。"""
    m = AID_RE.match(fit.name)
    return m.group(1) if m else ""


def activity_names() -> dict[str, str]:
    """
    _activities.json 是 sync-intervals.py 存的活動 metadata。
    **FIT 格式沒有活動名稱欄位**，所以這是 Strava 以外唯一的標題來源。
    檔案不在（還沒跑過新版 sync）時回空 dict，標題就沿用舊行為。
    """
    path = FIT_DIR / "_activities.json"
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        log("⚠️ _activities.json 解析失敗，標題退回預設")
        return {}
    return {aid: (v or {}).get("name") or "" for aid, v in data.items()}


def desired_title(date: str, fit: Path, names: dict[str, str]) -> str | None:
    """
    要傳給 render_dashboard 的 --title，None = 不傳（讓它用 notes 或日期預設）。

    優先序：教練評語的標題 > intervals.icu 活動名稱 > render 自己的日期預設。
    render_dashboard.py:612 是 `a.title or notes.get("title") or 預設`，
    --title 會壓過 notes，所以評語有標題時這裡必須回 None，
    否則「劍 中中中中 劍」會被「內湖區 公路車」蓋掉。
    """
    note = NOTES / f"{date}.json"
    if note.exists():
        try:
            if (json.loads(note.read_text(encoding="utf-8")) or {}).get("title"):
                return None
        except json.JSONDecodeError:
            pass
    return (names.get(aid_of(fit)) or "").strip() or None


def analyze(fit: Path, tmp: Path) -> tuple[Path, Path, dict]:
    rj, cj = tmp / "ride.json", tmp / "chart.json"
    cmd = [sys.executable, str(TOOLS / "analyze_tcx.py"), str(fit),
           "--weight", WEIGHT, "--height", HEIGHT,
           "--json", str(rj), "--charts", str(cj)]
    if STRAVA_URL:
        cmd += ["--strava", STRAVA_URL]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if r.returncode != 0:
        raise RuntimeError((r.stderr or r.stdout or "").strip()[:400])
    return rj, cj, json.loads(rj.read_text(encoding="utf-8"))


def report_date(summary: dict, fit: Path) -> str:
    """
    以 analyze 算出的**當地日期**為準（summary["when"]["date"]），
    檔名日期只是備援。兩者可能差一天：檔名來自 intervals.icu 的 start_date_local，
    when.date 來自 analyze 自己的時區換算，跨午夜的活動會不一致。
    用 when.date 才會跟既有的 rides/*.html 命名與 build_index.py 對齊。
    """
    d = str((summary.get("when") or {}).get("date") or "")[:10]
    return d if DATE_RE.fullmatch(d) else (date_of(fit) or "")


def qualifies(summary: dict, date: str, args, itt: set[str]) -> tuple[bool, str]:
    if args.force:
        return True, "--force"
    if (NOTES / f"{date}.json").exists():
        return True, "有教練評語"

    # 沒有功率資料一律不合格 —— ITT 例外只豁免 TSS，不豁免這條。
    # 不然同一天的肌力訓練（無功率、0 km）會因為那天有 ITT 成績而「合格」，
    # 在 --overwrite 下覆蓋掉真正的騎乘報告（docs/fit-pipeline.md 問題 A）。
    pw = summary.get("power") or {}
    if not pw.get("has_power"):
        return False, "沒有功率資料"

    if date in itt:
        return True, "當天有 ITT 成績"

    tss = pw.get("tss")
    if not isinstance(tss, (int, float)):
        return False, "算不出 TSS"
    if tss < args.min_tss:
        return False, f"TSS {tss:.0f} < {args.min_tss}"
    return True, f"TSS {tss:.0f}"


def main() -> int:
    ap = argparse.ArgumentParser(description="FIT → rides/<date>.html")
    ap.add_argument("--min-tss", type=float, default=100.0)
    ap.add_argument("--force", action="store_true", help="忽略門檻，全部產出")
    ap.add_argument("--only", help="只處理這個日期")
    ap.add_argument("--overwrite", action="store_true", help="已存在的報告也重生")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not FIT_DIR.exists():
        log(f"{FIT_DIR} 不存在，沒有東西可做。")
        return 0

    RIDES.mkdir(exist_ok=True)
    itt = itt_dates()
    if itt:
        log(f"ITT 日期 {len(itt)} 天")
    names = activity_names()
    if names:
        log(f"活動名稱 {len(names)} 筆")
    plans = plan_dates()
    if plans:
        log(f"課表處方 {len(plans)} 天")

    done_file = FIT_DIR / "_reports.json"
    done = {}
    if done_file.exists():
        try:
            done = json.loads(done_file.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass

    fits = sorted(FIT_DIR.glob("*.fit"))
    if args.only:
        fits = [f for f in fits if date_of(f) == args.only]
    if not fits:
        log("data/fit/ 裡沒有符合的 .fit")
        return 0

    made = skipped = failed = 0
    # 本次執行已產出（或 dry-run 判定會產出）的日期 → 勝出檔是否有功率。
    # 記 has_power 是因為 --force / notes 豁免下無功率檔（肌力訓練）可能先搶到
    # 當日，後到的騎乘檔必須能取代它 —— 騎乘優先於肌力，與檔名排序無關。
    made_dates: dict[str, bool] = {}
    for fit in fits:
        prev = done.get(fit.name)
        # 標題變了就要重做 —— 你在 Garmin / intervals.icu 改了活動名稱之後，
        # 沒有這條的話 _reports.json 會讓這支檔案永遠被跳過，報告停在舊標題。
        want_title = desired_title((prev or {}).get("date") or date_of(fit) or "",
                                   fit, names)
        title_stale = bool(prev) and prev.get("title") != want_title
        if prev and not (args.overwrite or args.force or args.dry_run or title_stale):
            # 之前處理過了。只有當它產出的報告被刪掉時才重做。
            if prev.get("skipped") or (RIDES / f"{prev['date']}.html").exists():
                skipped += 1
                continue

        try:
            with tempfile.TemporaryDirectory() as td:
                tmp = Path(td)
                rj, cj, summary = analyze(fit, tmp)
                date = report_date(summary, fit)
                if not date:
                    log(f"[跳過] {fit.name}：判斷不出日期")
                    skipped += 1
                    continue
                cur_power = bool((summary.get("power") or {}).get("has_power"))
                replacing = False
                if date in made_dates:
                    # 同日去重：一天只有一份 rides/<date>.html。原則上先產出者勝，
                    # 唯一例外是「有功率的檔取代無功率的先到者」—— 不然 --force 下
                    # 肌力訓練檔名排序在前時（如 07-30、08-05）會搶走騎乘的報告。
                    if cur_power and not made_dates[date]:
                        replacing = True
                        log(f"[同日] {fit.name}：以功率版取代先前的無功率版")
                    else:
                        log(f"[同日] {fit.name}：當日報告已由另一檔產出")
                        done[fit.name] = {"date": date, "skipped": True,
                                          "why": "同日報告已由另一檔產出"}
                        skipped += 1
                        continue
                # analyze 算出的日期才是最終的，用它重算一次標題
                # （prev 不存在、或跨午夜導致檔名日期與 when.date 差一天時會不同）。
                want_title = desired_title(date, fit, names)
                title_stale = bool(prev) and prev.get("title") != want_title
                out = RIDES / f"{date}.html"
                if out.exists() and not (args.overwrite or args.force
                                         or replacing or title_stale):
                    # skipped:False＝「不是不合格，只是這次沒重生」——
                    # 報告被刪掉時（見上面的 prev 判斷）仍會重做。
                    done[fit.name] = {"date": date, "skipped": False,
                                      "why": "already-exists", "title": want_title}
                    skipped += 1
                    continue
                if title_stale and out.exists():
                    log(f"[改名] {date}：標題改為「{want_title or '(預設)'}」，重生報告")
                ok, why = qualifies(summary, date, args, itt)
                if not ok:
                    log(f"[門檻] {date} 不產出：{why}")
                    done[fit.name] = {"date": date, "skipped": True, "why": why}
                    skipped += 1
                    continue
                if args.dry_run:
                    log(f"[dry-run] {date} 會產出（{why}）")
                    made += 1
                    made_dates[date] = cur_power
                    continue

                cmd = [sys.executable, str(TOOLS / "render_dashboard.py"),
                       str(rj), str(cj), "-o", str(out)]
                note = NOTES / f"{date}.json"
                if note.exists():
                    cmd += ["--notes", str(note)]      # 評語不會被洗掉
                if want_title:
                    cmd += ["--title", want_title]     # intervals.icu 的活動名稱
                if date in plans:
                    sj = score(fit, date, tmp)
                    if sj:
                        cmd += ["--score", str(sj)]    # 報告多一張「課表對帳」
                        fill_training_block(date, sj)  # 週期章的 actual 回填
                r = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
                if r.returncode != 0:
                    raise RuntimeError((r.stderr or r.stdout or "").strip()[:400])
            log(f"[產出] {date}.html（{why}{'，含評語' if note.exists() else ''}）")
            done[fit.name] = {"date": date, "skipped": False, "title": want_title}
            made += 1
            made_dates[date] = cur_power
        except Exception as e:  # noqa: BLE001 — 單一檔案失敗不該中斷整批
            # 用 fit.name 而不是 date：analyze() 就拋例外時 date 還沒賦值
            log(f"[失敗] {fit.name}: {e}")
            failed += 1
            # 把失敗也記進 _reports.json，否則壞檔會「每一次執行都重炸」——
            # 4 個跑步 FIT 就是這樣讓每班 CI 都帶著 4 個 traceback。
            # --overwrite / --force 會重試，修好解析器之後不必手動清這個檔。
            done[fit.name] = {"date": date_of(fit) or "", "skipped": True,
                              "why": f"解析失敗：{str(e).splitlines()[-1][:120]}"}

    if not args.dry_run:
        done_file.parent.mkdir(parents=True, exist_ok=True)
        done_file.write_text(json.dumps(done, ensure_ascii=False, indent=1), encoding="utf-8")

    if made and not args.dry_run:
        r = subprocess.run([sys.executable, str(TOOLS / "build_index.py"), str(RIDES)],
                           capture_output=True, text=True)
        log(r.stdout.strip() or r.stderr.strip())

    log(f"\n產出 {made} · 略過 {skipped} · 失敗 {failed}")
    return 1 if failed and not made else 0


if __name__ == "__main__":
    sys.exit(main())
