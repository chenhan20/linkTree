"""Playful time-lapse of one ride: colour-coded trail, spinning bike, lap stickers,
a snack-stop bubble, a generated beat, and a confetti summary card.

usage: python3 make_ride_bike.py <in.fit> <out.mp4> <title> <dateline>   （通常由 batch_fast.py 呼叫）
"""
import math
import random
import subprocess
import sys
import wave

import fitdecode
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

FIT, OUT = sys.argv[1], sys.argv[2]
TITLE = sys.argv[3]
DATE_LINE = sys.argv[4]
INTRO_TAG = ''  # set from the distance once the FIT is parsed
W, H = 1280, 720
FPS = 30
INTRO_S, DUR, OUTRO_S = 2.0, 86.0, 3.0
TOTAL_S = INTRO_S + DUR + OUTRO_S
CJK = '/System/Library/Fonts/STHeiti Medium.ttc'
BOLD = '/System/Library/Fonts/Supplemental/Arial Black.ttf'
AUDIO = OUT.rsplit('.', 1)[0] + '_beat.wav'

BG_TOP, BG_BOT = (30, 16, 58), (8, 10, 24)
CARD = (27, 23, 50)
MAP_BG = (22, 19, 42)
PINK = (255, 94, 162)
YELLOW = (255, 214, 79)
MINT = (88, 230, 180)
CYAN = (80, 200, 255)
WHITE = (255, 255, 255)
MUTED = (170, 164, 204)
ROUTE_FAINT = (62, 54, 100)
CHART_FILL = (34, 70, 110)


def font(path, size):
    return ImageFont.truetype(path, size, index=0)


F_INTRO = font(CJK, 74)
F_TAG = font(CJK, 30)
F_TITLE = font(CJK, 26)
F_SUB = font(CJK, 15)
F_LABEL = font(CJK, 16)
F_SMALL = font(CJK, 14)
F_FOOT = font(CJK, 16)
F_BIG = font(BOLD, 46)
F_NUM_M = font(BOLD, 36)
F_PILL = font(CJK, 20)
F_BUBBLE = font(CJK, 18)
F_CARD_H = font(CJK, 30)


def speed_color(v):
    if v < 8:
        return CYAN
    if v < 20:
        return MINT
    if v < 30:
        return YELLOW
    return PINK


def hr_color(v):
    if v < 120:
        return CYAN
    if v < 145:
        return MINT
    if v < 160:
        return YELLOW
    return PINK


def fmt_ms(sec):
    sec = int(sec)
    return f'{sec // 60}:{sec % 60:02d}'


def fmt_hms(sec):
    sec = int(sec)
    return f'{sec // 3600}:{sec % 3600 // 60:02d}:{sec % 60:02d}'


# ---------- 1. parse FIT ----------
recs, laps = [], []
moving_s = sess_avg_hr = sess_max_hr = None
with fitdecode.FitReader(FIT) as r:
    for fr in r:
        if not isinstance(fr, fitdecode.FitDataMessage):
            continue
        if fr.name == 'record':
            recs.append({f.name: f.value for f in fr.fields})
        elif fr.name == 'lap':
            laps.append((float(fr.get_value('total_elapsed_time')), float(fr.get_value('total_distance'))))
        elif fr.name == 'session' and moving_s is None and fr.has_field('total_timer_time'):
            moving_s = float(fr.get_value('total_timer_time'))
            sess_avg_hr = fr.get_value('avg_heart_rate') if fr.has_field('avg_heart_rate') else None
            sess_max_hr = fr.get_value('max_heart_rate') if fr.has_field('max_heart_rate') else None

ts = np.array([d['timestamp'].timestamp() for d in recs])
order = np.argsort(ts, kind='stable')
recs = [recs[i] for i in order]
ts = ts[order]
t = ts - ts[0]


def arr(name, scale=1.0):
    return np.array([np.nan if d.get(name) is None else float(d[name]) * scale for d in recs])


lat = arr('position_lat', 180 / 2 ** 31)
lon = arr('position_long', 180 / 2 ** 31)
spd = arr('enhanced_speed')
hr = arr('heart_rate')
dist = arr('distance')

T = int(math.floor(t[-1]))
grid = np.arange(0, T + 1, 1.0)


def interp(y):
    m = ~np.isnan(y)
    return np.interp(grid, t[m], y[m])


latg, long_g = interp(lat), interp(lon)
spd_g, hr_g, dist_g = interp(spd), interp(hr), interp(dist)


def smooth(y, w):
    k = np.ones(w) / w
    yp = np.pad(y, (w // 2, w - 1 - w // 2), mode='edge')
    return np.convolve(yp, k, mode='valid')


speed_kmh = smooth(spd_g, 10) * 3.6
hr_s = smooth(hr_g, 10)
total_km = dist_g[-1] / 1000
hr_valid = hr[~np.isnan(hr)]
if moving_s is None:
    moving_s = float(np.sum(spd_g > 0.5))
avg_moving = total_km / (moving_s / 3600)
avg_hr = float(sess_avg_hr) if sess_avg_hr is not None else float(np.mean(hr_valid))
max_hr = float(sess_max_hr) if sess_max_hr is not None else float(np.max(hr_valid))
RIDE_PER_VIDEO = T / DUR   # ride seconds per video second

# longest stop: records stay within 60 m of where the stretch began (the 阿婆壽司 break)
rd = ~np.isnan(dist)
rt, rdist = t[rd], dist[rd]
best_stop = (0.0, 0.0)
i, n = 0, len(rt)
while i < n:
    j = i
    while j + 1 < n and abs(rdist[j + 1] - rdist[i]) < 60:
        j += 1
    if rt[j] - rt[i] > best_stop[1] - best_stop[0]:
        best_stop = (rt[i], rt[j])
    i = j + 1
STOP_S0, STOP_S1 = int(best_stop[0]), int(best_stop[1])
STOP_LEN = STOP_S1 - STOP_S0
STOP_OK = STOP_LEN >= 600
INTRO_TAG = f'一趟 {total_km:.1f} 公里的騎乘'
if STOP_OK:
    speed_kmh[(grid >= STOP_S0) & (grid <= STOP_S1)] = 0.0
STOP_MID = (STOP_S0 + STOP_S1) // 2
BIG_LAPS = [(e, dm) for e, dm in laps if dm >= 3000]          # only real-distance laps get stickers/bars
LAP_STOP_THRESH = 2 * float(np.median([e for e, _ in BIG_LAPS])) if BIG_LAPS else 1e9

# lap stickers: first second where cumulative distance passes each lap boundary
lap_events = []
cum_d = 0.0
for elapsed, d_m in laps[:-1]:
    cum_d += d_m
    if d_m < 3000:
        continue
    idx = int(np.searchsorted(dist_g, cum_d))
    lap_events.append((min(idx, T), int(round(cum_d / 1000)), elapsed))

# ---------- 2. projection ----------
la0, lo0 = float(np.mean(latg)), float(np.mean(long_g))
X = (long_g - lo0) * 111320 * math.cos(math.radians(la0))
Y = (latg - la0) * 110574
MX0, MY0, MX1, MY1 = 58, 126, 728, 650
span_x, span_y = X.max() - X.min(), Y.max() - Y.min()
S = min((MX1 - MX0) / span_x, (MY1 - MY0) / span_y)
ox = MX0 + ((MX1 - MX0) - span_x * S) / 2
oy = MY1 - ((MY1 - MY0) - span_y * S) / 2
PX = ox + (X - X.min()) * S
PY = oy - (Y - Y.min()) * S
ROUTE_LOOP = math.hypot(PX[-1] - PX[0], PY[-1] - PY[0]) < 12

# ---------- 3. chart geometry ----------
SP_RECT = (784, 326, 1256, 478)
HR_RECT = (784, 494, 1256, 644)
PL_X0, PL_X1 = 836, 1236
SP_Y0, SP_Y1 = 372, 456
HR_Y0, HR_Y1 = 534, 618
SP_MAX = max(40, math.ceil(np.nanmax(speed_kmh) / 10) * 10)
HR_MIN, HR_MAX = 60, 200


def x_of_t(sec):
    return PL_X0 + (sec / T) * (PL_X1 - PL_X0)


def y_sp(v):
    v = min(max(v, 0), SP_MAX)
    return SP_Y1 - v / SP_MAX * (SP_Y1 - SP_Y0)


def y_hr(v):
    v = min(max(v, HR_MIN), HR_MAX)
    return HR_Y1 - (v - HR_MIN) / (HR_MAX - HR_MIN) * (HR_Y1 - HR_Y0)


CH_STEP = 8
ch_t = np.arange(0, T + 1, CH_STEP)
sp_pts = [(x_of_t(s), y_sp(speed_kmh[int(s)])) for s in ch_t]
hr_pts = [(x_of_t(s), y_hr(hr_s[int(s)])) for s in ch_t]

# ---------- 4. static background ----------
def gradient_bg():
    img = Image.new('RGB', (W, H), BG_BOT)
    d = ImageDraw.Draw(img)
    for y in range(H):
        f = y / (H - 1)
        c = tuple(int(BG_TOP[i] * (1 - f) + BG_BOT[i] * f) for i in range(3))
        d.line((0, y, W, y), fill=c)
    rnd = random.Random(3)
    for _ in range(90):   # faint sparkles
        x, y, r = rnd.randrange(W), rnd.randrange(H), rnd.choice((1, 1, 2))
        d.ellipse((x - r, y - r, x + r, y + r), fill=(70, 62, 110))
    return img


bg = gradient_bg()
d = ImageDraw.Draw(bg)


def sticker(x, y, text, fill, fg=(20, 14, 40), f=F_TITLE, pad=12):
    tw = d.textlength(text, font=f)
    box = (x, y, x + tw + pad * 2, y + f.size + pad)
    d.rounded_rectangle(box, 12, fill=fill)
    d.text((x + pad, y + pad // 2 - 2), text, font=f, fill=fg)
    return box


sticker(24, 16, TITLE, PINK, fg=WHITE)
d.text((28, 58), DATE_LINE + f' · 回放 ×{RIDE_PER_VIDEO:.0f}', font=F_SUB, fill=MUTED)

d.rounded_rectangle((24, 88, 760, 698), 18, fill=MAP_BG)
d.text((48, 104), '路線', font=F_LABEL, fill=MUTED)
route_pts_1hz = list(zip(PX, PY))
d.line(route_pts_1hz[::3], fill=ROUTE_FAINT, width=3, joint='curve')
bar_px = 1000 * S
d.rounded_rectangle((56, 668, 56 + bar_px, 674), 3, fill=MUTED)
d.text((56, 646), '1 km', font=F_SMALL, fill=MUTED)
d.text((700, 102), 'N ↑', font=F_SMALL, fill=MUTED)

CARDS = [
    (784, 72, 1006, 180, '速度 km/h', CYAN),
    (1026, 72, 1256, 180, '心率 bpm', PINK),
    (784, 196, 1006, 304, '距離 km', YELLOW),
    (1026, 196, 1256, 304, '騎乘時間', MINT),
]
for x0, y0, x1, y1, label, col in CARDS:
    d.rounded_rectangle((x0, y0, x1, y1), 16, fill=CARD)
    d.rounded_rectangle((x0 + 14, y0 + 10, x0 + 44, y0 + 15), 3, fill=col)
    d.text((x0 + 16, y0 + 22), label, font=F_LABEL, fill=MUTED)

d.rounded_rectangle(SP_RECT, 16, fill=CARD)
d.text((800, 336), '時速', font=F_LABEL, fill=MUTED)
for v in range(0, int(SP_MAX) + 1, 10):
    y = y_sp(v)
    d.line((PL_X0, y, PL_X1, y), fill=(46, 42, 74), width=1)
    d.text((PL_X0 - 34, y - 8), str(v), font=F_SMALL, fill=MUTED)
d.line(sp_pts, fill=(52, 76, 104), width=2, joint='curve')

d.rounded_rectangle(HR_RECT, 16, fill=CARD)
d.text((800, 502), '心率', font=F_LABEL, fill=MUTED)
for v in (80, 120, 160):
    y = y_hr(v)
    d.line((PL_X0, y, PL_X1, y), fill=(46, 42, 74), width=1)
    d.text((PL_X0 - 34, y - 8), str(v), font=F_SMALL, fill=MUTED)
d.line(hr_pts, fill=(96, 48, 70), width=2, joint='curve')
d.text((PL_X0, 624), '藍 <120 ｜ 綠 120–145 ｜ 黃 145–160 ｜ 粉 ≥160', font=F_SMALL, fill=MUTED)

foot = (f'全程 {total_km:.1f} km ｜ 移動 {fmt_hms(moving_s)} ｜ 移動平均 {avg_moving:.1f} km/h ｜ '
        f'平均心率 {avg_hr:.0f} ｜ 最高心率 {max_hr:.0f}')
d.text((24, 706), foot, font=F_FOOT, fill=MUTED)

# ---------- 5. sprites / helpers ----------
def bike_sprite(wheel_ang):
    s = Image.new('RGBA', (60, 42), (0, 0, 0, 0))
    g = ImageDraw.Draw(s)
    rw = 12
    rear, front = (13, 29), (47, 29)
    for c in (rear, front):
        g.ellipse((c[0] - rw, c[1] - rw, c[0] + rw, c[1] + rw), outline=WHITE, width=3)
        for k in range(3):
            a = wheel_ang + k * 2 * math.pi / 3
            g.line((c[0], c[1], c[0] + (rw - 2) * math.cos(a), c[1] + (rw - 2) * math.sin(a)),
                   fill=(255, 255, 255, 150), width=1)
    bb, seat, head = (28, 29), (24, 14), (42, 14)
    frame = PINK + (255,)
    for a, b in ((rear, bb), (bb, seat), (seat, rear), (seat, head), (head, bb), (head, front)):
        g.line((a, b), fill=frame, width=3)
    g.line((head, (45, 9)), fill=frame, width=3)
    g.line(((20, 10), (27, 10)), fill=frame, width=3)  # saddle
    g.ellipse((30, 2, 38, 10), fill=YELLOW)  # rider head
    g.line((34, 10, 27, 18), fill=YELLOW, width=3)  # rider torso
    return s


def paste_rgba(base, sprite, cx, cy):
    base.paste(sprite, (int(cx - sprite.width / 2), int(cy - sprite.height / 2)), sprite)


def draw_pill(img_draw, x, y, text, fill, fg=(20, 14, 40), f=F_PILL, max_x=None):
    tw = img_draw.textlength(text, font=f)
    if max_x is not None:
        x = min(x, max_x - tw - 26)
    box = (x, y, x + tw + 26, y + 36)
    img_draw.rounded_rectangle(box, 18, fill=fill)
    img_draw.text((x + 13, y + 6), text, font=f, fill=fg)


def draw_bubble(img_draw, px, py, lines, fill=YELLOW):
    w = max(img_draw.textlength(s, font=F_BUBBLE) for s in lines) + 30
    h = 30 * len(lines) + 10
    bx = min(max(px - w / 2, 40), 760 - w - 14)
    by = py - h - 26
    img_draw.rounded_rectangle((bx, by, bx + w, by + h), 14, fill=fill)
    img_draw.polygon([(px - 9, by + h - 1), (px + 9, by + h - 1), (px, py - 8)], fill=fill)
    for i, s in enumerate(lines):
        img_draw.text((bx + 15, by + 8 + i * 30), s, font=F_BUBBLE, fill=(20, 14, 40))


# incremental coloured trail (1 Hz points, colour = 10 s smoothed speed)
trail = Image.new('RGBA', (W, H), (0, 0, 0, 0))
trail_d = ImageDraw.Draw(trail)
drawn = {'k': 0}


def advance_trail(k):
    for j in range(max(drawn['k'], 1), k + 1):
        col = speed_color(speed_kmh[j]) + (255,)
        trail_d.line([route_pts_1hz[j - 1], route_pts_1hz[j]], fill=col, width=6)
        trail_d.ellipse((PX[j] - 3, PY[j] - 3, PX[j] + 3, PY[j] + 3), fill=col)
    drawn['k'] = max(drawn['k'], k)


# confetti for the outro
rng = random.Random(7)
CONFETTI = []
for _ in range(150):
    CONFETTI.append((rng.uniform(0, W), rng.uniform(-260, -10), rng.uniform(120, 260),
                     rng.uniform(-30, 30), rng.uniform(0, 6.28),
                     rng.choice([PINK, YELLOW, MINT, CYAN, WHITE]), rng.uniform(5, 9)))

bg_rgba = bg.convert('RGBA')
bike_cache = {}
BIKE_DIR = 'bike/frames'
BIKE_K, BIKE_SC = 64, 2
BIKE_X0, BIKE_Y0 = -160, -262
BIKE_W = 170
_probe = Image.open(f'{BIKE_DIR}/b000.png')
BIKE_S = BIKE_W / _probe.width
bike_frames = []
for k in range(BIKE_K):
    im = Image.open(f'{BIKE_DIR}/b{k:03d}.png').convert('RGBA')
    bike_frames.append(im.resize((BIKE_W, round(im.height * BIKE_S)), Image.LANCZOS))
# the point on the bike that sits on the route: mid-body, between the wheels
BIKE_AX = (0 - BIKE_X0) * BIKE_SC * BIKE_S
BIKE_AY = (-40 - BIKE_Y0) * BIKE_SC * BIKE_S
bike_state = {'phi': 0.0}
# facing with hysteresis: judge direction over +-300 ride-seconds and only flip after a clear
# reversal, so the bike turns around once at the far end instead of twitching on every wobble
FACING_LEFT = np.zeros(T + 1, dtype=bool)
_left = False
for _i in range(T + 1):
    _dx = PX[min(_i + 300, T)] - PX[max(_i - 300, 0)]
    if _dx < -40:
        _left = True
    elif _dx > 40:
        _left = False
    FACING_LEFT[_i] = _left
print('facing flips:', int(np.sum(np.diff(FACING_LEFT.astype(int)) != 0)))
def bike_index(phi):
    return int(round((phi % (2 * math.pi)) / (2 * math.pi) * BIKE_K)) % BIKE_K


def frame_for(i):
    ti = i / FPS
    if ti < INTRO_S:
        img = gradient_bg()
        dd = ImageDraw.Draw(img)
        p = min(ti / 0.7, 1.0)
        ease = 1 - (1 - p) ** 3
        y0 = 210 + (1 - ease) * 60
        dd.text((W / 2 - dd.textlength(TITLE, font=F_INTRO) / 2, y0), TITLE, font=F_INTRO, fill=WHITE)
        dd.text((W / 2 - dd.textlength(INTRO_TAG, font=F_TAG) / 2, y0 + 120), INTRO_TAG,
                font=F_TAG, fill=PINK)
        dd.text((W / 2 - dd.textlength(DATE_LINE, font=F_SUB) / 2, y0 + 185), DATE_LINE,
                font=F_SUB, fill=MUTED)
        bx = -140 + (ti / INTRO_S) * (W + 280)
        ib = bike_frames[bike_index(ti * 16)]
        img.paste(ib, (int(bx - ib.width / 2), 560 - ib.height // 2), ib)
        return img

    in_ride = ti < INTRO_S + DUR
    r = ((ti - INTRO_S) / DUR) * T if in_ride else T
    r = min(max(r, 0.0), T)
    idx = int(round(r))
    video_t = ti - INTRO_S  # seconds since the ride started (video time)

    advance_trail(idx)
    glow = trail.resize((W // 2, H // 2), Image.BILINEAR).filter(ImageFilter.GaussianBlur(5))
    glow = glow.resize((W, H), Image.BILINEAR)
    img = Image.alpha_composite(bg_rgba, glow)
    img = Image.alpha_composite(img, trail).convert('RGB')
    dd = ImageDraw.Draw(img)

    # start / end markers
    sx, sy, ex, ey = PX[0], PY[0], PX[-1], PY[-1]
    dd.ellipse((sx - 8, sy - 8, sx + 8, sy + 8), fill=MINT, outline=WHITE, width=2)
    if ROUTE_LOOP:
        dd.text((sx - 50, sy - 44), '起＝終', font=F_SMALL, fill=WHITE)
    else:
        dd.ellipse((ex - 8, ey - 8, ex + 8, ey + 8), fill=PINK, outline=WHITE, width=2)
        dd.text((sx + 12, sy - 9), '起', font=F_SMALL, fill=WHITE)
        dd.text((ex + 12, ey - 9), '終', font=F_SMALL, fill=WHITE)

    # snack stop bubble
    if STOP_OK and STOP_S0 <= r <= STOP_S1:
        mins = (r - STOP_S0)
        draw_bubble(dd, PX[STOP_MID], PY[STOP_MID], ['休息一下', f'已停 {fmt_ms(mins)}'])

    # bike at the current position, pointing along the route
    a0, a1 = max(idx - 4, 0), min(idx + 4, T)
    dx, dy = PX[a1] - PX[a0], PY[a1] - PY[a0]
    facing_left = FACING_LEFT[idx]
    if in_ride:   # wheels turn at their real rate in video time (the map runs fast, the wheels don't)
        bike_state['phi'] += (speed_kmh[idx] / 3.6) / 0.335 / FPS
    sprite = bike_frames[bike_index(bike_state['phi'])]
    if facing_left:
        sprite = sprite.transpose(Image.FLIP_LEFT_RIGHT)
    img.paste(sprite, (int(PX[idx] - BIKE_AX), int(PY[idx] - BIKE_AY)), sprite)
    dd = ImageDraw.Draw(img)

    # lap stickers (about 2.2 s of video time)
    for r_k, km, lap_elapsed in lap_events:
        age = (r - r_k) / RIDE_PER_VIDEO
        if 0 <= age < 2.2:
            slide = max(0.0, 1 - age / 0.25) * 14
            text = f'{km} km · {fmt_ms(lap_elapsed)}'
            if lap_elapsed > LAP_STOP_THRESH:
                text += '　停住了'
            draw_pill(dd, PX[r_k] + 16, PY[r_k] - 112 + slide, text, YELLOW, max_x=748)

    # KPI numbers
    sp_now, hr_now = speed_kmh[idx], hr_s[idx]
    dd.text((800, 104), f'{sp_now:4.1f}', font=F_BIG, fill=CYAN)
    dd.text((1042, 104), f'{hr_now:3.0f}', font=F_BIG, fill=hr_color(hr_now))
    dd.text((800, 228), f'{dist_g[idx] / 1000:.2f}', font=F_BIG, fill=YELLOW)
    dd.text((1042, 228), fmt_hms(r), font=F_NUM_M, fill=MINT)
    if sp_now < 1.0 and in_ride:
        draw_pill(dd, 596, 98, '停留中', (255, 180, 84))

    # charts: filled traveled part + cursor
    kc = int(round(idx / CH_STEP)) + 1
    if kc >= 2:
        pts = sp_pts[:kc]
        poly = pts + [(pts[-1][0], SP_Y1), (pts[0][0], SP_Y1)]
        dd.polygon(poly, fill=CHART_FILL)
        dd.line(pts, fill=CYAN, width=2, joint='curve')
        dd.line(hr_pts[:kc], fill=PINK, width=2, joint='curve')
    xc = x_of_t(r)
    dd.line((xc, SP_Y0 - 6, xc, SP_Y1), fill=WHITE, width=1)
    dd.line((xc, HR_Y0 - 6, xc, HR_Y1), fill=WHITE, width=1)
    dd.ellipse((xc - 5, y_sp(sp_now) - 5, xc + 5, y_sp(sp_now) + 5), fill=CYAN, outline=WHITE)
    dd.ellipse((xc - 5, y_hr(hr_now) - 5, xc + 5, y_hr(hr_now) + 5), fill=hr_color(hr_now), outline=WHITE)

    # outro: confetti + summary card
    if not in_ride:
        tau = ti - INTRO_S - DUR
        img = img.filter(ImageFilter.GaussianBlur(5))
        dd = ImageDraw.Draw(img)
        for x0, y0, vy, sway, ph, col, sz in CONFETTI:
            y = y0 + vy * tau * 0.9
            if y > H:
                continue
            x = x0 + sway * math.sin(tau * 3 + ph)
            dd.rectangle((x, y, x + sz, y + sz * 1.6), fill=col)
        dd.rounded_rectangle((250, 150, 1030, 570), 26, fill=(16, 12, 34), outline=PINK, width=3)
        head = '今天的成績單'
        dd.text((W / 2 - dd.textlength(head, font=F_CARD_H) / 2, 182), head, font=F_CARD_H, fill=WHITE)
        stats = [
            (f'{total_km:.1f}', 'km', CYAN),
            (fmt_hms(moving_s), '移動時間', MINT),
            (f'{avg_moving:.1f}', '移動平均 km/h', YELLOW),
            (f'{avg_hr:.0f}', '平均心率', PINK),
        ]
        for j, (num, unit, col) in enumerate(stats):
            cx = 290 + j * 180 + 80
            nw = dd.textlength(num, font=F_NUM_M)
            dd.text((cx - nw / 2, 262), num, font=F_NUM_M, fill=col)
            uw = dd.textlength(unit, font=F_SMALL)
            dd.text((cx - uw / 2, 318), unit, font=F_SMALL, fill=MUTED)
        tag = '下次再騎！'
        dd.text((W / 2 - dd.textlength(tag, font=F_TAG) / 2, 388), tag, font=F_TAG, fill=PINK)
        cap = '每圈平均時速'
        dd.text((W / 2 - dd.textlength(cap, font=F_SMALL) / 2, 438), cap, font=F_SMALL, fill=MUTED)
        bars = BIG_LAPS
        if bars:
            vmax = max(dm / el * 3.6 for el, dm in bars)
            n = len(bars)
            bw = min(46, 700 / n - 4)
            gap = (700 - n * bw) / (n - 1) if n > 1 else 0
        for j, (el, dm) in enumerate(bars):
            kmh = dm / el * 3.6
            x = 290 + j * (bw + gap)
            hgt = max(6, kmh / vmax * 70)
            stop = el > LAP_STOP_THRESH
            dd.rounded_rectangle((x, 540 - hgt, x + bw, 540), 6, fill=PINK if stop else YELLOW)
            if stop:
                lab = fmt_ms(el)
                dd.text((x + bw / 2 - dd.textlength(lab, font=F_SMALL) / 2, 540 - hgt - 20), lab,
                        font=F_SMALL, fill=PINK)
            num = str(j + 1) if len(bars) <= 20 else ''
            dd.text((x + bw / 2 - dd.textlength(num, font=F_SMALL) / 2, 546), num, font=F_SMALL, fill=MUTED)
    return img


# ---------- 6. beat (generated, no samples) ----------
SR = 44100


def make_beat(path, seconds, bpm=120):
    n = int(SR * seconds)
    buf = np.zeros(n)
    beat = 60 / bpm
    rs = np.random.default_rng(11)
    kick_t = np.arange(int(SR * 0.35)) / SR
    kick = np.sin(2 * np.pi * (50 * kick_t + 100 * (1 - np.exp(-30 * kick_t)) / 30)) * np.exp(-kick_t * 12)
    hat_len = int(SR * 0.05)
    hat_t = np.arange(hat_len) / SR
    hat = (rs.standard_normal(hat_len) * np.exp(-hat_t * 90)) * 0.18
    bass_notes = [110.0, 110.0, 130.81, 98.0]   # A2 A2 C3 G2
    bass_len = int(SR * beat * 0.45)
    bass_t = np.arange(bass_len) / SR
    k = 0
    b = 0
    while b * beat < seconds:
        s = int(b * beat * SR)
        if s + len(kick) < n:
            buf[s:s + len(kick)] += kick * 0.9
        f = bass_notes[b % 4]
        bass = np.sign(np.sin(2 * np.pi * f * bass_t)) * np.exp(-bass_t * 5) * 0.13
        if s + bass_len < n:
            buf[s:s + bass_len] += bass
        h = s + int(SR * beat / 2)
        if h + hat_len < n:
            buf[h:h + hat_len] += hat
        b += 1
    fade_in = np.linspace(0, 1, int(SR * 0.6))
    buf[:len(fade_in)] *= fade_in
    fade_out = np.linspace(1, 0, int(SR * 2.5))
    buf[-len(fade_out):] *= fade_out
    buf = buf / max(1e-9, np.max(np.abs(buf))) * 0.8
    pcm = (buf * 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


make_beat(AUDIO, TOTAL_S)

# ---------- 7. render ----------
ff = subprocess.Popen(
    ['ffmpeg', '-y', '-loglevel', 'error',
     '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
     '-i', AUDIO, '-map', '0:v', '-map', '1:a',
     '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-preset', 'medium',
     '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', OUT],
    stdin=subprocess.PIPE)

N = int(round(FPS * TOTAL_S))
for i in range(N):
    ff.stdin.write(frame_for(i).tobytes())
ff.stdin.close()
ff.wait()
print('done', OUT, 'frames', N, 'stop', (STOP_LEN, STOP_OK), 'laps', lap_events[:3], '...',
      'sp_max', round(float(np.nanmax(speed_kmh)), 1))
