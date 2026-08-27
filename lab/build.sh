#!/usr/bin/env bash
# 把外殼與各元件串成 lab.html。沒有 build step 這回事 —— 這裡字面上就是 cat。
# 元件順序即頁面順序；要換順序或加一張圖，改 PARTS 就好。
set -euo pipefail
cd "$(dirname "$0")/.."

PARTS=(${LAB_PARTS_OVERRIDE:-sleep quality splits cadence gears devladder tsbsim})

OUT=lab.html
{
  cat lab/_shell_head.html
  cat lab/_shell_body.html
  for p in "${PARTS[@]}"; do
    f="lab/parts/$p.html"
    if [ -f "$f" ]; then
      printf '\n<!-- ══ part: %s ══ -->\n' "$p"
      cat "$f"
    else
      printf '\n<!-- part %s 缺席 -->\n' "$p" >&2
      echo "  ⚠️  缺 $f" >&2
    fi
  done
  cat lab/_shell_tail.html
} > "$OUT"

echo "→ $OUT  ($(wc -c < "$OUT" | tr -d ' ') bytes, $(wc -l < "$OUT" | tr -d ' ') 行)"
