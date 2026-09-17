#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""build-route-signatures.py —— 每趟戶外騎乘的路線簽章與跟車指標 → data/fit/_routes.json

為什麼需要這支：
  報告的「同一條路線」章要列出以前騎過同一圈的日子（起點、距離、路段組合相同），
  還要每趟的 NP／心率／EF／跟車比例才比得起來。這些都要解析 FIT，在產報告時逐趟
  重算太慢（一趟 2–3 秒 × 一百多趟），所以先算好快取；增量更新，只算沒算過的檔。

跟管線的關係：
  排在 build-ride-reports.py **之前**（新報告要查得到歷史；本趟自己那列缺的話
  render_dashboard 會拿 FIT 現算，但歷史一定得從這裡來）。CI 的 fit-sync.yml 同順序。

用法：
  python3 scripts/build-route-signatures.py            # 增量
  python3 scripts/build-route-signatures.py --rebuild  # 全部重算（改了單騎模型之後）
"""
import argparse
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools", "tcx"))
import route_sig  # noqa: E402

FIT_DIR = os.path.join(ROOT, "data", "fit")


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--rebuild", action="store_true")
    ap.add_argument("--weight", type=float, default=float(os.environ.get("ATHLETE_WEIGHT") or 80.0))
    ap.add_argument("-q", "--quiet", action="store_true")
    a = ap.parse_args(argv)

    routes = {} if a.rebuild else route_sig.load_routes()
    fits = sorted(f for f in os.listdir(FIT_DIR) if f.lower().endswith(".fit") and not f.startswith("_"))
    todo = [f for f in fits if f not in routes]
    added = skipped = 0
    for f in todo:
        sig = route_sig.signature(os.path.join(FIT_DIR, f), a.weight)
        # 室內／沒 GPS 也記一個 null，下次才不會再解析一遍
        routes[f] = sig
        if sig:
            added += 1
            if not a.quiet:
                d = sig["draft"] or {}
                print(f"  {f[:10]} {sig['km']:6.1f} km  NP {sig['np_w']}  跟車 {d.get('draft_pct', '—')}%")
        else:
            skipped += 1
    # 已經不存在的 FIT（來源刪掉、改名）順手清掉
    stale = [k for k in routes if k not in fits]
    for k in stale:
        del routes[k]
    route_sig.save_routes(routes)
    have = sum(1 for v in routes.values() if v)
    print(f"✅ _routes.json：新增 {added}、略過（室內／無 GPS）{skipped}、清掉 {len(stale)}；共 {have} 趟戶外簽章")
    return 0


if __name__ == "__main__":
    sys.exit(main())
