#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_index.py — 掃描 rides/*.html，重建清單頁 index.html 與 index.json。

用法:  python3 tools/tcx/build_index.py rides

每份報告開頭都有一行 `<!-- ride-meta {...} -->`（由 render_dashboard.py 寫入），
這支腳本只讀那一行，不解析整份 HTML。
index.json 供 strava.html 判斷「這筆活動有沒有報告」用。
"""
import json
import os
import re
import sys
import html as H

META = re.compile(r"<!--\s*ride-meta\s*(\{.*?\})\s*-->")


def hm(s):
    return f"{s // 3600}:{s % 3600 // 60:02d}"


def main():
    d = sys.argv[1] if len(sys.argv) > 1 else "rides"
    rows = []
    for fn in sorted(os.listdir(d)):
        if not fn.endswith(".html") or fn == "index.html":
            continue
        with open(os.path.join(d, fn), encoding="utf-8") as f:
            head = f.read(4096)
        m = META.search(head)
        if not m:
            print(f"[skip] {fn} 沒有 ride-meta")
            continue
        r = json.loads(m.group(1))
        r["href"] = fn
        rows.append(r)
    rows.sort(key=lambda r: r["date"], reverse=True)

    with open(os.path.join(d, "index.json"), "w", encoding="utf-8") as f:
        json.dump({"rides": rows}, f, ensure_ascii=False, separators=(",", ":"))

    cards = "\n".join(
        f'''    <a class="row" href="{r['href']}">
      <div class="d"><b>{r['date']}</b><span>{r['weekday']} {r['time']}</span></div>
      <div class="t">{H.escape(r['title'])}</div>
      <div class="m"><span>{r['km']} km</span><span>↑{r['elev']:,} m</span><span>{hm(r['moving_sec'])}</span>'''
        + (f'<span>NP {r["np"]:.0f}</span>' if r.get("np") else "")
        + (f'<span>TSS {r["tss"]}</span>' if r.get("tss") else "")
        # 有處方的日子報課表對帳，沒有的才報 effective_pct。
        # 「有效 44.9%」對照表操課的一趟是誤導：熱身與恢復是處方寫死的低功率。
        + (f'<span class="eff">課表 {r["score"]["grade"]} · {r["score"]["total"]} 分</span>'
           if r.get("score") else
           (f'<span class="eff">有效 {r["eff"]}%</span>' if r.get("eff") is not None else ""))
        + "</div>\n    </a>"
        for r in rows)

    page = f'''<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>訓練報告 · Steve Chuang</title>
<style>
:root{{color-scheme:light;--surface-1:#fcfcfb;--page:#f9f9f7;--ink-1:#0b0b0b;--ink-2:#52514e;
 --ink-3:#898781;--ring:rgba(11,11,11,.10);--s2:#eb6834}}
@media (prefers-color-scheme:dark){{:root{{color-scheme:dark;--surface-1:#1a1a19;--page:#0d0d0d;
 --ink-1:#fff;--ink-2:#c3c2b7;--ink-3:#898781;--ring:rgba(255,255,255,.10);--s2:#d95926}}}}
*{{box-sizing:border-box;margin:0;padding:0}}
body{{background:var(--page);color:var(--ink-1);font-family:system-ui,-apple-system,"Noto Sans TC",sans-serif;
 line-height:1.6;font-size:15px;padding:0 0 64px}}
.wrap{{max-width:820px;margin:0 auto;padding:0 18px}}
header{{padding:44px 0 18px}}
.eyebrow{{color:var(--ink-3);font-size:12px;letter-spacing:.18em;text-transform:uppercase;font-weight:700}}
h1{{font-size:30px;font-weight:800;letter-spacing:-.02em;margin:6px 0 10px}}
p.lede{{color:var(--ink-2);max-width:620px}}
.row{{display:block;text-decoration:none;color:inherit;background:var(--surface-1);
 border:1px solid var(--ring);border-radius:12px;padding:16px 18px;margin:12px 0;transition:.12s}}
.row:hover{{border-color:var(--s2);transform:translateY(-1px)}}
.d{{display:flex;gap:10px;align-items:baseline;font-size:12.5px;color:var(--ink-3)}}
.d b{{color:var(--ink-1);font-size:14px;font-variant-numeric:tabular-nums}}
.t{{font-size:19px;font-weight:750;margin:3px 0 8px}}
.m{{display:flex;flex-wrap:wrap;gap:14px;font-size:13px;color:var(--ink-2);font-variant-numeric:tabular-nums}}
.eff{{color:var(--s2);font-weight:700}}
footer{{color:var(--ink-3);font-size:12px;margin-top:32px;text-align:center}}
footer a{{color:var(--ink-3)}}
</style>
</head>
<body><div class="wrap">
<header>
  <div class="eyebrow">Training Reports</div>
  <h1>訓練報告</h1>
  <p class="lede">每一趟 TCX 自動產生的分析頁：分圈、區間、爬坡、停等判讀與教練評語。點日期進去看細節。</p>
</header>
{cards}
<footer>由 <code>tcx-training-report</code> 產生 · <a href="../strava.html">← 回 Strava 總覽</a> · <a href="../linkTreeIndex.html">Link Tree</a></footer>
</div></body></html>'''
    with open(os.path.join(d, "index.html"), "w", encoding="utf-8") as f:
        f.write(page)
    print(f"已重建 {d}/index.html 與 {d}/index.json（{len(rows)} 筆）")


if __name__ == "__main__":
    main()
