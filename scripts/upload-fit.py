#!/usr/bin/env python3
"""把本機的 FIT／TCX／GPX 上傳到 intervals.icu。

    python3 scripts/upload-fit.py ~/Desktop/activity_export_fit_260819110510.fit \
        --name "ROUVY - Des Plaines River Trail"

**什麼時候需要它**：室內騎乘忘了用手錶錄的時候。Rouvy 的活動走兩條路都進不了我們的管線
（Garmin 的合作夥伴 API 只推裝置錄的活動；Strava 來源的活動 intervals 不會經由 API 吐出來），
但 Rouvy 的活動頁可以匯出 FIT —— 匯出來丟給這支，就變成 intervals 的原生活動，
`sync-intervals.py` 下一輪就抓得到，CTL/ATL 也算得進去。

⚠️ 重複上傳會產生重複活動，intervals 那邊不會自動合併。上傳前先確認那一趟還沒進去。
⚠️ 這支要帶 User-Agent，否則 Cloudflare 會回 403 error code 1010（實際踩過）。
"""
import argparse, base64, os, sys, urllib.request, uuid

API = "https://intervals.icu/api/v1"
UA = os.getenv("INTERVALS_UA", "linkTree-fit-sync/1.0 (+https://github.com/chenhan20/linkTree)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("path", help=".fit / .tcx / .gpx")
    ap.add_argument("--name", help="活動名稱（不給就用 intervals 的預設）")
    ap.add_argument("--description", default="")
    a = ap.parse_args()

    key = os.getenv("INTERVALS_API_KEY", "").strip()
    ath = os.getenv("INTERVALS_ATHLETE_ID", "0").strip()
    if not key:
        print("沒有 INTERVALS_API_KEY —— 先 source scripts/.env", file=sys.stderr)
        return 1
    path = os.path.expanduser(a.path)
    data = open(path, "rb").read()

    bnd = "----icu" + uuid.uuid4().hex
    def part(n, v):
        return f'--{bnd}\r\nContent-Disposition: form-data; name="{n}"\r\n\r\n{v}\r\n'.encode()
    body = b""
    if a.name:
        body += part("name", a.name)
    if a.description:
        body += part("description", a.description)
    body += (f'--{bnd}\r\nContent-Disposition: form-data; name="file"; '
             f'filename="{os.path.basename(path)}"\r\n'
             "Content-Type: application/octet-stream\r\n\r\n").encode() + data + b"\r\n"
    body += f"--{bnd}--\r\n".encode()

    req = urllib.request.Request(f"{API}/athlete/{ath}/activities", data=body, method="POST")
    req.add_header("Authorization", "Basic " + base64.b64encode(f"API_KEY:{key}".encode()).decode())
    req.add_header("Content-Type", f"multipart/form-data; boundary={bnd}")
    req.add_header("User-Agent", UA)      # 沒有這行 Cloudflare 直接 403（error code 1010）
    try:
        resp = urllib.request.urlopen(req)
    except Exception as e:  # noqa: BLE001
        print("上傳失敗:", getattr(e, "code", ""), e, file=sys.stderr)
        try:
            print(e.read().decode()[:300], file=sys.stderr)
        except Exception:  # noqa: BLE001
            pass
        return 2
    print(f"✅ HTTP {resp.status}　{os.path.basename(path)}（{len(data) / 1024:.1f} KB）")
    print(resp.read().decode()[:200])
    print("下一步：python3 scripts/sync-intervals.py　把它拉進 data/fit")
    return 0


if __name__ == "__main__":
    sys.exit(main())
