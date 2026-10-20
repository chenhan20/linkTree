"""畫騎士動畫的 64 格圖（火影風：橘色外套、金色尖髮、藍色護額、臉頰鬍鬚線）→ bike/frames/b000..b063.png

make_ride_bike.py 把這 64 格當「輪子轉一圈」的循環：frame k = 輪子轉了 k/64 圈，曲柄、雙腿、護額飄帶
同一個週期（所以循環首尾接得起來）。朝右；影片端遇到往左騎會自己水平翻轉。

版面約定（make_ride_bike.py 依賴，改了要一起改那邊的 BIKE_AX／BIKE_AY）：
  輸出 170×150 px；「貼在路線上的點」＝兩輪軸心中間偏上 (85, 118)；輪胎觸地線 y≈139。
先用 4 倍畫布畫、再縮小，邊緣才不會鋸齒。原創線條畫，不描摹任何官方圖。

用法：python3 tools/ride-video/make_bike_frames.py   （約 10 秒，產出放在這支旁邊的 bike/frames/）
"""
import math
import os

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "bike", "frames")
K = 64
SS = 4
W, H = 170, 150

ORANGE = (255, 138, 28)
ORANGE_D = (214, 98, 12)
BLACK = (28, 26, 40)
NAVY = (34, 52, 140)
BLUE = (52, 92, 200)
HAIR = (255, 212, 70)
HAIR_D = (226, 164, 30)
SKIN = (255, 218, 186)
SKIN_D = (226, 170, 134)
METAL = (214, 220, 232)
FRAME = (255, 94, 62)
TIRE = (24, 22, 36)
RIM = (240, 242, 250)


def P(x, y):
    return (x * SS, y * SS)


class Pen:
    def __init__(self, img):
        self.d = ImageDraw.Draw(img)

    def line(self, a, b, w, c):
        self.d.line([P(*a), P(*b)], fill=c, width=int(w * SS))
        r = w * SS / 2
        for x, y in (P(*a), P(*b)):
            self.d.ellipse((x - r, y - r, x + r, y + r), fill=c)

    def poly(self, pts, c):
        self.d.polygon([P(*p) for p in pts], fill=c)

    def dot(self, c0, r, c, outline=None, width=0):
        x, y = P(*c0)
        r *= SS
        self.d.ellipse((x - r, y - r, x + r, y + r), fill=c, outline=outline, width=int(width * SS))

    def ring(self, c0, r, w, c):
        x, y = P(*c0)
        r *= SS
        self.d.ellipse((x - r, y - r, x + r, y + r), outline=c, width=int(w * SS))


def ik(hip, foot, l1, l2, knee_fwd=True):
    """兩段腿：回傳膝蓋位置（膝蓋朝前＝+x）。"""
    dx, dy = foot[0] - hip[0], foot[1] - hip[1]
    d = min(math.hypot(dx, dy), l1 + l2 - 0.01)
    a = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
    h = math.sqrt(max(l1 * l1 - a * a, 0))
    ux, uy = dx / d, dy / d
    mx, my = hip[0] + ux * a, hip[1] + uy * a
    s = 1 if knee_fwd else -1
    # 垂直於大腿方向、取 x 為正（朝前）的那一側
    px, py = -uy * s, ux * s
    if px < 0:
        px, py = -px, -py
    return (mx + px * h, my + py * h)


def frame(k):
    t = k / K
    ph = 2 * math.pi * t
    S = Image.new("RGBA", (W * SS, H * SS), (0, 0, 0, 0))
    g = Pen(S)

    rear, front = (46, 117), (124, 117)
    bb = (80, 113)
    bob = math.sin(ph * 2) * 0.8          # 每踩半圈上下一次
    seat = (66, 76)
    head = (112, 78)
    bar = (118, 72)
    crank = 12.0
    pedA = (bb[0] + crank * math.cos(ph), bb[1] + crank * math.sin(ph))          # 近側腳
    pedB = (bb[0] - crank * math.cos(ph), bb[1] - crank * math.sin(ph))          # 遠側腳
    hip = (66, 68 + bob)
    shoulder = (91, 46 + bob)

    def leg(ped, c_leg, c_shoe, w=7):
        knee = ik(hip, ped, 30, 31)
        g.line(hip, knee, w, c_leg)
        g.line(knee, ped, w - 1, c_leg)
        g.line((ped[0] - 3, ped[1] + 1), (ped[0] + 6, ped[1] + 1.5), 5, c_shoe)

    # ── 遠側：腿＋曲柄 ──
    g.line(bb, pedB, 2.5, (150, 150, 170))
    leg(pedB, ORANGE_D, (20, 28, 80))

    # ── 輪子 ──
    for cx, cy in (rear, front):
        g.ring((cx, cy), 22, 3.2, TIRE)
        g.ring((cx, cy), 19.2, 1.6, RIM)
        for s in range(6):
            a = ph + s * math.pi / 3
            g.line((cx, cy), (cx + 19 * math.cos(a), cy + 19 * math.sin(a)), 0.7, (210, 214, 230))
        g.dot((cx, cy), 2.4, RIM)

    # ── 車架（橘紅）──
    fr = FRAME
    for a, b in ((rear, bb), (bb, seat), (seat, rear), (seat, head), (head, bb)):
        g.line(a, b, 3.2, fr)
    g.line(head, front, 3.0, fr)
    g.line(head, bar, 3.0, fr)
    g.line((bar[0] - 2, bar[1]), (bar[0] + 7, bar[1] + 3), 2.6, (40, 40, 56))   # 下彎把手
    g.line((seat[0] - 8, seat[1] - 3), (seat[0] + 4, seat[1] - 3), 3.2, (40, 40, 56))  # 坐墊
    g.dot(bb, 4, (60, 60, 80))

    # ── 身體 ──
    # 護額飄帶（在身後、依週期擺動）
    hd = (shoulder[0] + 9, shoulder[1] - 17)
    for i, (dy0, amp) in enumerate(((-1.0, 1.0), (2.2, 1.3))):
        pts = []
        for j in range(8):
            u = j / 7
            x = hd[0] - 6 - u * 30
            y = hd[1] + dy0 + u * 2 + math.sin(ph * 2 - u * 5 + i * 1.3) * (1.0 + u * 3.4) * amp
            pts.append((x, y))
        for a, b in zip(pts, pts[1:]):
            g.line(a, b, 3.4 - i * 0.6, BLUE)

    # 背部（橘外套，肩線黑）
    g.line(hip, shoulder, 13, ORANGE)
    g.line((hip[0] + 2, hip[1] + 1), (shoulder[0] - 3, shoulder[1] + 3), 6, ORANGE_D)
    g.line((shoulder[0] - 4, shoulder[1] - 2), (shoulder[0] + 3, shoulder[1] + 1), 6, BLACK)  # 領口／肩
    g.line((hip[0] - 4, hip[1] + 2), (hip[0] + 6, hip[1] + 2), 6, NAVY)  # 腰帶

    # 近側腿
    leg(pedA, ORANGE, (24, 34, 96))
    g.line(bb, pedA, 2.8, (190, 190, 205))

    # 手臂（抓下把）
    elbow = (shoulder[0] + 10, shoulder[1] + 13)
    g.line(shoulder, elbow, 6, ORANGE_D)
    g.line(elbow, (bar[0] + 2, bar[1] + 1), 5.4, ORANGE)
    g.dot((bar[0] + 3, bar[1] + 2), 3.1, SKIN)

    # 頭
    hc = (shoulder[0] + 11, shoulder[1] - 15)
    # 後方尖髮
    for ang, ln in ((200, 13), (225, 15), (250, 14), (172, 11)):
        a = math.radians(ang)
        tip = (hc[0] + ln * math.cos(a), hc[1] + ln * math.sin(a) - 1)
        b1 = (hc[0] + 8 * math.cos(a - 0.55), hc[1] + 8 * math.sin(a - 0.55))
        b2 = (hc[0] + 8 * math.cos(a + 0.55), hc[1] + 8 * math.sin(a + 0.55))
        g.poly([b1, tip, b2], HAIR_D)
    g.dot(hc, 9.2, SKIN)
    # 上方／前方尖髮
    for ang, ln in ((262, 15), (284, 16), (306, 13), (328, 10)):
        a = math.radians(ang)
        tip = (hc[0] + ln * math.cos(a), hc[1] + ln * math.sin(a))
        b1 = (hc[0] + 8 * math.cos(a - 0.5), hc[1] + 8 * math.sin(a - 0.5))
        b2 = (hc[0] + 8 * math.cos(a + 0.5), hc[1] + 8 * math.sin(a + 0.5))
        g.poly([b1, tip, b2], HAIR)
    g.dot((hc[0] - 1, hc[1] - 4.5), 8.4, HAIR)
    # 護額（藍布＋金屬片＋漩渦）
    g.line((hc[0] - 8.5, hc[1] - 3.2), (hc[0] + 8.5, hc[1] - 4.6), 4.4, BLUE)
    g.poly([P_ for P_ in ((hc[0] + 1, hc[1] - 7.2), (hc[0] + 9, hc[1] - 7.8), (hc[0] + 8.6, hc[1] - 1.6),
                         (hc[0] + 1.4, hc[1] - 1.4))], METAL)
    g.ring((hc[0] + 5.2, hc[1] - 4.6), 1.9, 0.7, (70, 78, 110))
    g.dot((hc[0] + 5.2, hc[1] - 4.6), 0.55, (70, 78, 110))
    # 臉：眼、鬍鬚線、笑
    g.dot((hc[0] + 4.4, hc[1] + 1.6), 1.25, BLACK)
    for dy in (-0.2, 1.6, 3.4):
        g.line((hc[0] + 3.2, hc[1] + 3.3 + dy * 0.45), (hc[0] + 8.2, hc[1] + 2.9 + dy), 0.7, SKIN_D)
    g.line((hc[0] + 5.6, hc[1] + 6.1), (hc[0] + 8.4, hc[1] + 5.1), 0.9, (150, 70, 60))

    out = S.resize((W, H), Image.LANCZOS)
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    for k in range(K):
        frame(k).save(os.path.join(OUT, f"b{k:03d}.png"), optimize=True)
    print(f"✅ {K} 格 → {OUT}")


if __name__ == "__main__":
    main()
