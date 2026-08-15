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

    # 版面語言跟 render_dashboard.py 的報告同一套：沒有卡片，靠細線與等寬字排出目錄感。
    def stat(r):
        # 每一格固定寬度靠右，才會像一張表而不是一串標籤；缺值的日子留白不塌陷。
        return ("".join([
            f'<span class="c1">{r["km"]} km</span>',
            f'<span class="c2">↑{r["elev"]:,}</span>',
            f'<span class="c3">{hm(r["moving_sec"])}</span>',
            f'<span class="c4">{"NP " + format(r["np"], ".0f") if r.get("np") else ""}</span>',
            f'<span class="c5">{"TSS " + str(r["tss"]) if r.get("tss") else ""}</span>',
        ]))

    def verdict(r):
        # 有處方的日子報課表對帳，沒有的才報 effective_pct。
        # 「有效 44.9%」對照表操課的一趟是誤導：熱身與恢復是處方寫死的低功率。
        if r.get("score"):
            return (f'<span class="vd"><b>{r["score"]["total"]}</b> '
                    f'{H.escape(str(r["score"]["grade"]))}</span>')
        if r.get("eff") is not None:
            return f'<span class="vd dim">有效 {r["eff"]}%</span>'
        return ""

    cards = "\n".join(
        f'''  <a class="row" href="{r['href']}">
    <div class="d"><b>{r['date']}</b><span>{r['weekday']} {r['time']}</span></div>
    <div class="t">{H.escape(r['title'])}</div>
    <div class="m">{stat(r)}</div>
    <div class="v">{verdict(r)}</div>
  </a>'''
        for r in rows)

    page = f'''<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>訓練報告 · Steve Chuang</title>
<style>
:root{{
  color-scheme:light;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans TC","PingFang TC",sans-serif;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
  --paper:#f6f5f1;--ink-1:#15150f;--ink-2:#55534b;--ink-3:#8a877c;
  --rule:#e2e0d6;--rule-2:#cdcabc;--hover:#efeee8;--s2:#c8541c;
}}
@media (prefers-color-scheme:dark){{:root{{
  color-scheme:dark;
  --paper:#121211;--ink-1:#f3f2ec;--ink-2:#a6a39a;--ink-3:#75726a;
  --rule:#282825;--rule-2:#3b3a36;--hover:#1b1b19;--s2:#dd6a35;
}}}}
*{{box-sizing:border-box;margin:0;padding:0}}
body{{background:var(--paper);color:var(--ink-1);font-family:var(--sans);
 line-height:1.6;font-size:14.5px;padding:0 0 80px;-webkit-font-smoothing:antialiased}}
.wrap{{max-width:900px;margin:0 auto;padding:0 34px}}
header{{padding:54px 0 30px}}
.eyebrow{{font-family:var(--mono);font-size:10.5px;letter-spacing:.17em;text-transform:uppercase;color:var(--ink-3)}}
h1{{font-size:32px;font-weight:700;letter-spacing:-.024em;margin:10px 0 14px}}
p.lede{{color:var(--ink-2);max-width:60ch;font-size:15px}}
.list{{border-top:1px solid var(--rule-2)}}
.row{{display:grid;grid-template-columns:9.5rem minmax(0,1fr) auto auto;gap:0 22px;align-items:baseline;
 text-decoration:none;color:inherit;padding:15px 8px 15px 0;border-bottom:1px solid var(--rule);
 margin:0 -8px 0 0}}
.row:hover{{background:var(--hover)}}
.d{{font-family:var(--mono);font-size:11.5px;color:var(--ink-3);font-variant-numeric:tabular-nums;
 white-space:nowrap}}
.d b{{color:var(--ink-1);font-weight:500;margin-right:9px}}
.t{{font-size:15.5px;font-weight:650;letter-spacing:-.01em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}}
.m{{display:flex;gap:14px;font-family:var(--mono);font-size:11.5px;color:var(--ink-2);
 font-variant-numeric:tabular-nums;white-space:nowrap}}
.m span{{text-align:right}}
.m .c1{{width:5.6em}} .m .c2{{width:4.2em}} .m .c3{{width:3.2em}}
.m .c4{{width:4.6em}} .m .c5{{width:4.8em}}
.v{{min-width:5.4rem;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}}
.vd{{font-family:var(--mono);font-size:11.5px;color:var(--s2)}}
.vd b{{font-family:var(--sans);font-size:15px;font-weight:650;letter-spacing:-.02em}}
.vd.dim{{color:var(--ink-3)}}
footer{{color:var(--ink-3);font-size:11.5px;margin-top:34px;padding-top:18px;border-top:1px solid var(--rule)}}
footer a{{color:var(--ink-2)}}
@media(max-width:760px){{
  .wrap{{padding:0 20px}}
  .row{{grid-template-columns:1fr auto;gap:2px 14px;padding:14px 0}}
  .d{{order:1}} .v{{order:2;min-width:0}} .t{{order:3;grid-column:1/-1;white-space:normal}}
  .m{{order:4;grid-column:1/-1;flex-wrap:wrap;gap:12px;margin-top:2px}}
}}
</style>
</head>
<body><div class="wrap">
<header>
  <div class="eyebrow">Training reports</div>
  <h1>訓練報告</h1>
  <p class="lede">每一趟騎乘自動產生的分析頁：課表對帳、逐段功率、區間分布、爬坡與停等判讀。
    右側是當天的結論 —— 有處方的日子是課表分數，沒有的是有效訓練佔比。</p>
</header>
<div class="list">
{cards}
</div>
<footer>由 <code>tcx-training-report</code> 產生 · <a href="../strava.html">← 回 Strava 總覽</a> · <a href="../linkTreeIndex.html">Link Tree</a></footer>
</div></body></html>'''
    with open(os.path.join(d, "index.html"), "w", encoding="utf-8") as f:
        f.write(page)
    print(f"已重建 {d}/index.html 與 {d}/index.json（{len(rows)} 筆）")


if __name__ == "__main__":
    main()
