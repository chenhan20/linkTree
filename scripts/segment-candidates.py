#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""segment-candidates.py —— 把 harvest 的路段目錄整理成「可以直接圈選」的候選清單

為什麼需要合併同類項：
  Strava 上同一條山路往往有 6~10 個別人建立的重疊路段。中社路那條坡，
  光是「full climb / 過橋後→公車迴轉 / 全段過橋到迴轉前 / 中社橋路口→瞭望台 /
  上坡+下坡」就佔掉排行榜前六名的五個位置，看起來像五條不同的路，其實是同一段。
  直接看 --report 的排行會被這些變體洗版，真正不同的路線反而沉在下面。

怎麼判斷是同一條路：
  ① 「出現在哪些活動裡」的重疊度（Jaccard）。同一條坡的所有變體必然出現在
     完全相同的那幾趟騎乘裡 —— 你騎過那條坡，這些路段就全部一起被記錄。
     這比比對座標可靠：變體的起終點是刻意錯開的，座標比不出來，活動集合卻一模一樣。
  ② 再加距離護欄。光看活動集合會把「總是一起騎但確實不同」的路線錯併：
     劍中劍（9.55 km，劍南+中社）與中社路（3.94 km）永遠出現在同一批活動裡，
     Jaccard 是 1.0，但它們是兩條不同長度的挑戰。距離差超過 MAX_DIST_RATIO 倍就不併。

每一族選一個代表：合格次數最多者；同票取距離最長的那條（涵蓋最完整）。

用法：
  python3 scripts/segment-candidates.py                    # 印出來
  python3 scripts/segment-candidates.py --out docs/x.md    # 同時寫成 markdown
  python3 scripts/segment-candidates.py --jaccard 0.6      # 放寬合併（合成更少族）
"""
import argparse
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATALOG = os.path.join(ROOT, "data", "strava-archive", "segment-catalog.json")
ITT_CONFIG = os.path.join(ROOT, "data", "itt-config.json")


def fmt_sec(s):
    if s is None:
        return "—"
    s = int(round(s))
    h, rem = divmod(s, 3600)
    m, ss = divmod(rem, 60)
    return f"{h}:{m:02d}:{ss:02d}" if h else f"{m}:{ss:02d}"


def main(argv=None):
    ap = argparse.ArgumentParser(description="把路段目錄整理成候選清單")
    ap.add_argument("--jaccard", type=float, default=0.8,
                    help="活動集合重疊多少算同一條路（預設 0.8）")
    ap.add_argument("--max-dist-ratio", type=float, default=1.8,
                    help="距離差超過幾倍就不併，擋掉「總是一起騎但確實不同」的路線（預設 1.8）")
    ap.add_argument("--out", help="同時寫出 markdown")
    args = ap.parse_args(argv)

    if not os.path.exists(CATALOG):
        raise SystemExit("找不到 segment-catalog.json，先跑 node scripts/harvest-strava.js")
    cat = json.load(open(CATALOG, encoding="utf-8"))
    known = {s["id"]: s.get("nameZh") for s in json.load(open(ITT_CONFIG, encoding="utf-8"))["segments"]}

    hits = [s for s in cat["segments"] if s.get("qualifies")]
    acts = {s["id"]: {e["activity_id"] for e in s["efforts"]} for s in hits}

    # 合格次數多的先當種子，其餘往已成形的族靠
    hits.sort(key=lambda s: (-s["qualifying_efforts"], -(s["distance_km"] or 0)))
    families = []
    for s in hits:
        placed = False
        for fam in families:
            rep = fam[0]
            a, b = acts[s["id"]], acts[rep["id"]]
            inter = len(a & b)
            union = len(a | b) or 1
            if inter / union < args.jaccard:
                continue
            da, db = s.get("distance_km") or 0, rep.get("distance_km") or 0
            if da and db and max(da, db) / min(da, db) > args.max_dist_ratio:
                continue  # 總是一起騎，但長度差太多 = 不同的挑戰
            fam.append(s)
            placed = True
            break
        if not placed:
            families.append([s])

    families.sort(key=lambda f: -f[0]["qualifying_efforts"])

    lines = []
    w = lines.append
    w("# Strava 常騎路段候選清單")
    w("")
    w(f"來源：`data/strava-archive/segment-catalog.json`（掃過 {cat['scanned_activities']} 趟騎乘）")
    g = cat.get("generated_for", {})
    w(f"門檻：單次 ≥ {fmt_sec(g.get('min_sec'))}、平均 ≥ {g.get('min_watts')}W、"
      f"{'含估算功率' if g.get('allow_estimated') else '只採功率計實測'}、"
      f"至少 {g.get('min_rides')} 次")
    w(f"合格路段 {len(hits)} 條，依「出現在同一批活動裡」合併成 **{len(families)} 條實際路線**"
      f"（Jaccard ≥ {args.jaccard}）")
    w("")
    w("每一族只有代表值得設成 ITT —— 同族其他條是 Strava 上別人建立的重疊變體，")
    w("設進去只會讓儀表板出現好幾張同一條坡的卡片。")
    w("")

    for i, fam in enumerate(families, 1):
        rep = fam[0]
        tag = f"★ 已設定（{known[rep['id']]}）" if rep["id"] in known else "☐ 未設定"
        # 整族裡若有任何一條已在 itt-config，就標出來，避免重複加
        fam_known = [s for s in fam if s["id"] in known]
        if fam_known and rep["id"] not in known:
            tag = f"★ 同族已設定（{known[fam_known[0]['id']]}，id {fam_known[0]['id']}）"
        w(f"## {i}. {rep['name']}")
        w("")
        w(f"- **狀態**：{tag}")
        w(f"- **Strava id**：`{rep['id']}`　·　"
          f"[路段頁](https://www.strava.com/segments/{rep['id']})")
        w(f"- **騎過**：{rep['qualifying_efforts']} 次達門檻 / 共 {rep['total_efforts']} 次　·　"
          f"{rep['first_date']} → {rep['last_date']}")
        w(f"- **距離**：{rep['distance_km']} km　·　均坡 {rep['average_grade']}%　·　"
          f"爬升約 {rep['elevation_gain_m']} m")
        w(f"- **最佳／中位**：{fmt_sec(rep['best_sec'])} / {fmt_sec(rep['median_sec'])}　·　"
          f"中位功率 {rep['median_watts']}W")
        if len(fam) > 1:
            others = "、".join(f"{s['name']}（{s['distance_km']}km）" for s in fam[1:6])
            more = f" …另外 {len(fam) - 6} 條" if len(fam) > 6 else ""
            w(f"- **同族重疊路段 {len(fam) - 1} 條**（不用設）：{others}{more}")
        w("")

    text = "\n".join(lines)
    print(text)
    if args.out:
        path = args.out if os.path.isabs(args.out) else os.path.join(ROOT, args.out)
        with open(path, "w", encoding="utf-8") as f:
            f.write(text + "\n")
        print(f"\n📄 已寫入 {os.path.relpath(path, ROOT)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
