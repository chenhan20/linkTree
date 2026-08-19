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
    ap.add_argument('date', nargs='?', help='plan.json 裡的日期 YYYY-MM-DD（給 --all 時可省略）')
    ap.add_argument('--all', action='store_true', help='產生 plan.json 裡今天（含）以後的每一堂')
    ap.add_argument('--offset', type=float, default=3.0, help='訓練台比曲柄低幾 %%（預設 3）')
    ap.add_argument('--adjust', type=float, default=0, help='主課表段的當天修正瓦數（例如 -5）')
    ap.add_argument('--warmup', type=float, help='覆寫熱身分鐘數')
    ap.add_argument('--cooldown', type=float, help='覆寫收操分鐘數')
    ap.add_argument('--out', default='athlete/workouts', help='輸出資料夾')
    ap.add_argument('--name', help='課表名稱（預設取 plan.json 的 label）')
    ap.add_argument('--stem', help='輸出檔名（不含副檔名）；預設 <日期>_<type>')
    a = ap.parse_args()

    plan = json.load(open(os.path.join(ROOT, 'data', 'plan.json'), encoding='utf-8'))
    if a.all:
        today = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).strftime('%Y-%m-%d')
        dates = [d for d in sorted(plan.get('days') or {}) if d >= today]
        if not dates:
            print('plan.json 裡沒有今天以後的課表', file=sys.stderr)
            return 1
        rc = 0
        for d in dates:
            rc |= emit(plan, d, a)
            print()
        return rc
    if not a.date:
        print('要給日期，或用 --all', file=sys.stderr)
        return 1
    return emit(plan, a.date, a)


def emit(plan, date, a):
    day = (plan.get('days') or {}).get(date)
    if not day:
        print(f'plan.json 裡沒有 {date}', file=sys.stderr)
        return 1
    ftp = (plan.get('baseline') or {}).get('ftp_w') or 238
    k = 1 - a.offset / 100.0
    allout = any(s.get('role') == 'allout' for s in day.get('segments', []))

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

    name = a.name or day.get('label') or date
    total = sum(s['min'] for s in segs)
    # 檔案內容一律 ASCII —— 這幾個檔是餵訓練台 App 的，不是給人讀的。
    # 中文檔頭有些匯入器會卡住或顯示成亂碼（實測 Rouvy 吃得下的那個檔名也是純 ASCII）。
    work = next((x for x in segs if x['role'] == 'work'), segs[0])
    desc = (f"{date} target {work['w0']}W on trainer = {work['crank0']}W at crank "
            f"(-{a.offset:.0f}% drivetrain"
            + (f", {a.adjust:+.0f}W same-day adjust" if a.adjust else '') + f"). Crank FTP {ftp}W. "
            "Hold the watts, do not drop. Indoor HR runs 5-10bpm higher, that is heat not fitness.")
    outdir = os.path.join(ROOT, a.out)
    os.makedirs(outdir, exist_ok=True)
    stem = a.stem or f"{date}_{day.get('type', 'workout')}"
    base = os.path.join(outdir, stem)

    # ── .erg（絕對瓦數）與 .mrc（FTP 百分比）──
    # 有全力段的日子不產 erg/mrc：那兩種格式只能寫死瓦數，ERG 會把「全力」鎖成一個固定值，
    # 測驗就毀了。那種日子只給 .zwo（FreeRide），或乾脆改用 slope 模式手動跑。
    for ext, unit, val in (() if allout else
                           (('erg', 'MINUTES WATTS', lambda s, w: f'{w}'),
                            ('mrc', 'MINUTES PERCENT', lambda s, w: f'{w / ftp * 100:.1f}'))):
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
    xml = ['<workout_file>', '  <author>Claude coach</author>', f'  <name>{stem}</name>',
           f'  <description>{desc}</description>', '  <sportType>bike</sportType>', '  <workout>']
    for s in segs:
        dur = int(round(s['min'] * 60))
        if s['role'] == 'warmup':
            xml.append(f'    <Warmup Duration="{dur}" PowerLow="{frac(s["w0"])}" PowerHigh="{frac(s["w1"])}"/>')
        elif s['role'] == 'cooldown':
            xml.append(f'    <Cooldown Duration="{dur}" PowerLow="{frac(s["w0"])}" PowerHigh="{frac(s["w1"])}"/>')
        elif s['role'] == 'allout':
            xml.append(f'    <FreeRide Duration="{dur}" FlatRoad="1"/>')
        else:
            cad = f' Cadence="{(s["cad"]["lo"] + s["cad"]["hi"]) // 2}"' if s.get('cad') else ''
            xml.append(f'    <SteadyState Duration="{dur}" Power="{frac(s["w0"])}"{cad}/>')
    xml += ['  </workout>', '</workout_file>', '']
    open(f'{base}.zwo', 'w', encoding='utf-8').write('\n'.join(xml))

    print(f'{name}　共 {total:.0f} 分')
    print(f"{'段':16}{'分':>5}{'訓練台':>8}{'曲柄':>8}")
    for s in segs:
        if s['role'] == 'allout':
            tw = cw = '全力'          # 全力段沒有目標瓦數，印數字會被誤讀成處方
        else:
            tw = f"{s['w0']}" if s['w0'] == s['w1'] else f"{s['w0']}→{s['w1']}"
            cw = f"{s['crank0']}" if s['crank0'] == s['crank1'] else f"{s['crank0']}→{s['crank1']}"
        print(f"{s['name']:16}{s['min']:>5.0f}{tw:>9}{cw:>9}")
    for r in day.get('rules', []):
        print(f"  規則 · {r.get('label')}")
    exts = ('zwo',) if allout else ('erg', 'mrc', 'zwo')
    print('輸出：' + ', '.join(f'{stem}.{e}' for e in exts) + f'　→ {a.out}/')
    if allout:
        print('  ⚠️ 這一天有全力段：只給 .zwo（FreeRide）。**不要用 ERG 模式跑全力段** ——'
              ' ERG 會把它鎖成固定瓦數，測驗值就沒了。全力段改 slope／level 模式自己踩。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
