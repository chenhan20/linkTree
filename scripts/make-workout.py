#!/usr/bin/env python3
"""把 data/plan.json 的逐段處方輸出成訓練台 App 吃得下的課表檔。

    python3 scripts/make-workout.py 2026-08-20 --offset 3 --adjust -5 --warmup 12 --cooldown 8

產生三種格式（不同 App 支援度不同，一次都給）：
  .erg  絕對瓦數（CompuTrainer 格式，Rouvy / TrainerRoad / Golden Cheetah 都吃）
  .mrc  同上但用 FTP 百分比
  .zwo  Zwift workout XML，部分 App（含 Rouvy 的匯入）走這個

**為什麼要 --offset**：這個區塊所有的數字都是**曲柄功率計**量的（FTP 238、8/13 前測、
9/10 後測）。直驅訓練台量的是鏈條之後，天生比曲柄低 2–3%（傳動損失）。
所以「戶外處方 185W」在訓練台上要設 185 × (1 − offset) 才是同一個努力。
量到實際差值之前，預設 3%。

--adjust 是當天的臨時修正（例如痠痛或 HRV 掉了就 -5），只作用在 work / allout 段，
熱身與收操不動。
"""
import json, argparse, os, sys, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def watts(seg, adjust):
    """回傳 (起瓦, 迄瓦)。熱身收操用區間當斜坡，主課表用標稱值。"""
    t = seg.get('target_w') or {}
    role = seg.get('role')
    lo, hi, about = t.get('lo'), t.get('hi'), t.get('about')
    if role == 'warmup' and lo and hi:
        return lo, hi
    if role == 'cooldown':
        v = about or lo or 130
        return v, v
    if t.get('allout'):
        v = about or hi or 250
        return v, v
    v = about or (lo + hi) / 2 if (lo and hi) else (about or lo or hi or 150)
    if role in ('work', 'allout'):
        v += adjust
    return v, v


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('date', help='plan.json 裡的日期 YYYY-MM-DD')
    ap.add_argument('--offset', type=float, default=3.0, help='訓練台比曲柄低幾 %%（預設 3）')
    ap.add_argument('--adjust', type=float, default=0, help='主課表段的當天修正瓦數（例如 -5）')
    ap.add_argument('--warmup', type=float, help='覆寫熱身分鐘數')
    ap.add_argument('--cooldown', type=float, help='覆寫收操分鐘數')
    ap.add_argument('--out', default='athlete/workouts', help='輸出資料夾')
    ap.add_argument('--name', help='課表名稱（預設取 plan.json 的 label）')
    a = ap.parse_args()

    plan = json.load(open(os.path.join(ROOT, 'data', 'plan.json'), encoding='utf-8'))
    day = (plan.get('days') or {}).get(a.date)
    if not day:
        print(f'plan.json 裡沒有 {a.date}', file=sys.stderr)
        return 1
    ftp = (plan.get('baseline') or {}).get('ftp_w') or 238
    k = 1 - a.offset / 100.0

    segs = []
    for s in day.get('segments', []):
        mins = s['minutes']
        if s.get('role') == 'warmup' and a.warmup:
            mins = a.warmup
        if s.get('role') == 'cooldown' and a.cooldown:
            mins = a.cooldown
        w0, w1 = watts(s, a.adjust)
        segs.append({'name': s['name'], 'role': s.get('role'), 'min': mins,
                     'w0': round(w0 * k), 'w1': round(w1 * k),
                     'crank0': round(w0), 'crank1': round(w1),
                     'cad': s.get('target_cadence'), 'note': s.get('note')})

    name = a.name or day.get('label') or a.date
    total = sum(s['min'] for s in segs)
    desc = (f"{name}｜訓練台瓦數已扣掉傳動損失 {a.offset:.0f}%"
            + (f"、當天修正 {a.adjust:+.0f}W" if a.adjust else '')
            + f"；曲柄 FTP {ftp}W。"
            + ' '.join(r.get('label', '') for r in day.get('rules', [])))
    outdir = os.path.join(ROOT, a.out)
    os.makedirs(outdir, exist_ok=True)
    stem = f"{a.date}_{day.get('type', 'workout')}"
    base = os.path.join(outdir, stem)

    # ── .erg（絕對瓦數）與 .mrc（FTP 百分比）──
    for ext, unit, val in (('erg', 'MINUTES WATTS', lambda s, w: f'{w}'),
                           ('mrc', 'MINUTES PERCENT', lambda s, w: f'{w / ftp * 100:.1f}')):
        rows, t = [], 0.0
        for s in segs:
            rows.append((t, val(s, s['w0'])))
            t += s['min']
            rows.append((t, val(s, s['w1'])))
        body = '\n'.join(f'{m:.2f}\t{v}' for m, v in rows)
        open(f'{base}.{ext}', 'w', encoding='utf-8').write(
            '[COURSE HEADER]\nVERSION = 2\nUNITS = ENGLISH\n'
            f'DESCRIPTION = {desc}\nFILE NAME = {stem}.{ext}\nFTP = {ftp}\n'
            f'{unit}\n[END COURSE HEADER]\n[COURSE DATA]\n{body}\n[END COURSE DATA]\n')

    # ── .zwo（Zwift workout XML；瓦數以 FTP 的比例表示）──
    def frac(w):
        return f'{w / ftp:.4f}'
    xml = ['<workout_file>', '  <author>Claude coach</author>', f'  <name>{name}</name>',
           f'  <description>{desc}</description>', '  <sportType>bike</sportType>', '  <workout>']
    for s in segs:
        dur = int(round(s['min'] * 60))
        if s['role'] == 'warmup':
            xml.append(f'    <Warmup Duration="{dur}" PowerLow="{frac(s["w0"])}" PowerHigh="{frac(s["w1"])}"/>')
        elif s['role'] == 'cooldown':
            xml.append(f'    <Cooldown Duration="{dur}" PowerLow="{frac(s["w0"])}" PowerHigh="{frac(s["w1"])}"/>')
        else:
            cad = f' Cadence="{(s["cad"]["lo"] + s["cad"]["hi"]) // 2}"' if s.get('cad') else ''
            xml.append(f'    <SteadyState Duration="{dur}" Power="{frac(s["w0"])}"{cad}/>')
    xml += ['  </workout>', '</workout_file>', '']
    open(f'{base}.zwo', 'w', encoding='utf-8').write('\n'.join(xml))

    print(f'{name}　共 {total:.0f} 分')
    print(f"{'段':16}{'分':>5}{'訓練台':>8}{'曲柄':>8}")
    for s in segs:
        tw = f"{s['w0']}" if s['w0'] == s['w1'] else f"{s['w0']}→{s['w1']}"
        cw = f"{s['crank0']}" if s['crank0'] == s['crank1'] else f"{s['crank0']}→{s['crank1']}"
        print(f"{s['name']:16}{s['min']:>5.0f}{tw:>9}{cw:>9}")
    for r in day.get('rules', []):
        print(f"  規則 · {r.get('label')}")
    print('輸出：' + ', '.join(f'{stem}.{e}' for e in ('erg', 'mrc', 'zwo')) + f'　→ {a.out}/')
    return 0


if __name__ == '__main__':
    sys.exit(main())
