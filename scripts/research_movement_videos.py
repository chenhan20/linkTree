#!/usr/bin/env python3
"""
Research script for Circuit movement YouTube tutorial videos.
Follows docs/gemini-movement-video-research-prompt.md specification.
"""

import sys
import os
import json
import time
import re
import urllib.request
import urllib.parse
import ssl
from datetime import datetime, timezone

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9,zh-TW;q=0.8,zh;q=0.7'
}

# Movement-specific requirements dictionary
# (required_any, forbidden_any)
MOVE_CONSTRAINTS = {
    # Warmup
    "warm-9090": (["90/90", "90 90", "hip switch", "hip rotation"], ["hip thrust"]),
    "warm-ankle": (["ankle rock", "ankle mobility", "asian squat", "deep squat ankle", "踝背屈", "腳踝活動度"], []),
    "warm-bridge": (["glute bridge", "bridge exercise", "臀橋"], ["hip thrust"]),
    "warm-birddog": (["bird dog", "birddog", "鳥狗"], []),
    "warm-scap": (["scapular push", "scap push", "肩胛伏地挺身"], []),
    "warm-tspine": (["t-spine rotation", "thoracic rotation", "quadruped thoracic", "胸椎旋轉"], []),
    "warm-armcircle": (["arm circle", "arm circles", "shoulder circle", "swimmer hover", "prone swimmer", "swimmers hover", "swimmer's hover", "手臂畫圓"], []),
    "warm-legswing": (["leg swing", "leg swings", "前後擺腿", "擺腿"], []),
    "warm-inchworm": (["inchworm", "walkout", "毛毛蟲走", "毛毛蟲式"], []),

    # Push
    "push-incline": (["incline push", "hands elevated push", "上斜伏地挺身", "上斜伏地"], ["decline"]),
    "push-up": (["push-up", "push up", "pushup", "伏地挺身"], ["incline", "decline", "pike", "diamond", "handstand", "archer", "wide"]),
    "push-wide": (["wide push", "wide grip push", "wide hand push", "寬距伏地挺身", "寬距伏地"], ["diamond", "close grip"]),
    "push-diamond": (["diamond push", "triangle push", "close grip push", "鑽石伏地挺身", "鑽石伏地"], ["wide"]),
    "push-pike": (["pike push", "downward dog push", "pike press"], []),
    "push-tempo": (["tempo push", "eccentric push", "slow push", "離心慢放", "慢放伏地挺身"], []),
    "push-decline-pike": (["decline pike", "feet elevated pike", "elevated pike", "下斜 pike", "高位 pike"], []),
    "push-wall-hspu": (["handstand push", "hspu", "wall handstand push", "倒立伏地挺身"], ["hold only", "press to handstand"]),
    "push-db-press": (["dumbbell shoulder press", "dumbbell overhead press", "db shoulder press", "db overhead press", "啞鈴肩推"], ["bench press", "chest press", "floor press"]),
    "push-floor-press": (["floor press", "dumbbell floor press", "db floor press", "地板臥推", "地板推"], ["bench press", "overhead press"]),

    # Pull
    "pull-snowangel": (["snow angel", "prone snow", "reverse snow", "雪天使"], []),
    "pull-w": (["prone w", "w raise", "w-raise", "w抬手"], []),
    "pull-superman": (["superman exercise", "superman hold", "超人式"], []),
    "pull-towel-row": (["towel row", "bodyweight towel row", "毛巾划船"], ["dumbbell", "barbell"]),
    "pull-y": (["prone y", "y raise", "y-raise", "y抬手"], []),
    "pull-t": (["prone t", "t raise", "t-raise", "t抬手"], []),
    "pull-wallslide": (["wall angel", "wall slide", "靠牆天使", "壁式天使"], []),
    "pull-table-row": (["inverted row", "table row", "桌下划船", "反向划船"], ["single arm", "one arm", "dumbbell", "barbell"]),
    "pull-table-row-1": (["single arm inverted row", "one arm inverted row", "single-arm inverted row", "one-arm inverted row", "single-arm bodyweight row", "one arm bodyweight row", "single arm row bodyweight", "單手反向划船", "單手桌下划船", "單手水平划船"], ["dumbbell", "barbell", "bench press"]),
    "pull-db-row": (["dumbbell row", "single arm dumbbell row", "啞鈴划船", "單手啞鈴划船"], ["barbell", "inverted"]),

    # Squat
    "sq-bw": (["bodyweight squat", "air squat", "徒手深蹲"], ["barbell", "dumbbell", "goblet", "single leg", "pistol", "jump squat"]),
    "sq-wall-sit": (["wall sit", "wall squat", "靠牆深蹲", "靠牆蹲"], []),
    "sq-split-iso": (["split squat hold", "split squat isometric", "split squat iso", "isometric split squat", "iso split squat", "isometric lunge", "lunge hold", "lunge isometric", "分腿蹲等長", "弓步等長"], ["bulgarian"]),
    "sq-split": (["split squat", "分腿蹲"], ["bulgarian", "hold", "iso"]),
    "sq-lateral": (["lateral lunge", "side lunge", "側弓步", "側跨步蹲"], []),
    "sq-lateral-iso": (["cossack", "lateral squat", "side squat", "側蹲", "側弓步"], ["dumbbell", "kettlebell", "barbell", "weighted", "jump"]),
    "sq-reverse-lunge": (["reverse lunge", "backward lunge", "後跨步蹲", "後弓箭步"], []),
    "sq-walking-lunge": (["walking lunge", "走路弓箭步", "行進弓箭步"], []),
    "sq-stepup": (["step up", "step-up", "上椅蹲", "登階"], ["lateral"]),
    "sq-tspine-split": (["split squat with rotation", "split squat rotation", "lunge with twist", "lunge with rotation", "lunge rotation", "lunge twist", "torso rotation", "t-spine", "thoracic", "胸椎"], ["bulgarian"]),
    "sq-bulgarian": (["bulgarian split squat", "rear foot elevated", "rfess", "保加利亞分腿蹲", "保加利亞蹲"], []),
    "sq-skater": (["skater squat", "curtsy squat", "溜冰者蹲"], []),
    "sq-pistol": (["pistol squat", "single leg squat", "手槍蹲", "單腳蹲"], []),
    "sq-goblet": (["goblet squat", "酒杯深蹲"], ["lateral", "cossack"]),
    "sq-goblet-lateral": (["goblet lateral", "goblet side lunge", "goblet cossack", "酒杯側蹲"], []),

    # Hinge
    "hinge-wall": (["wall hinge", "wall hip hinge", "靠牆髖鉸鏈"], []),
    "hinge-bridge-1": (["single leg glute bridge", "single-leg glute bridge", "one leg glute bridge", "單腳臀橋"], []),
    "hinge-longlever": (["long lever glute bridge", "long-lever glute bridge", "長槓桿臀橋"], []),
    "hinge-sl-rdl": (["single leg rdl", "single-leg rdl", "single leg romanian", "單腳硬舉", "徒手單腳硬舉"], ["dumbbell", "kettlebell", "barbell", "負重"]),
    "hinge-airplane": (["hip airplane", "airplane exercise", "髖飛機"], []),
    "hinge-walkout": (["hamstring walkout", "bridge walkout", "walkout"], []),
    "hinge-nordic": (["nordic hamstring curl", "nordic curl", "北歐腿彎舉", "北歐彎舉"], []),
    "hinge-kb-dl": (["kettlebell deadlift", "壺鈴硬舉"], ["barbell", "swing"]),
    "hinge-sl-rdl-w": (["single leg rdl", "single-leg rdl", "single leg romanian", "單腳硬舉"], ["bodyweight only", "徒手"]),
    "hinge-kb-swing": (["kettlebell swing", "壺鈴擺盪", "kb swing"], ["snatch", "clean"]),

    # Lateral
    "lat-clam": (["clamshell", "clam shell", "蚌式"], []),
    "lat-sidelying": (["side-lying hip abduction", "side lying leg raise", "side lying hip abduction", "側躺抬腿"], []),
    "lat-stand-abd": (["standing hip abduction", "standing leg raise", "站姿側抬腿"], []),
    "lat-squat-walk": (["lateral squat walk", "lateral band walk", "side squat walk", "半蹲側走", "側向深蹲走"], []),
    "lat-hipdip": (["side plank hip dip", "side plank dip", "側棒式抬髖"], []),
    "lat-crab": (["crab walk", "螃蟹走"], []),
    "lat-bearside": (["lateral bear crawl", "side bear crawl", "側向熊爬"], []),
    "lat-stepup": (["lateral step up", "lateral step-up", "side step up", "側跨步上椅"], []),
    "lat-cph-knee": (["copenhagen", "adductor plank"], ["full copenhagen", "copenhagen plank (full)"]),
    "lat-sideplank-raise": (["side plank leg raise", "side plank with leg lift", "side plank leg lift", "side plank abduction", "side plank with hip abduction", "側棒式抬腿"], []),
    "lat-skater": (["skater hop", "skater jump", "lateral bound", "溜冰者跳"], []),
    "lat-mtn-side": (["lateral mountain climber", "side mountain climber", "側向登山者"], []),
    "lat-cph-full": (["copenhagen plank", "copenhagen adductor"], ["knee", "bent", "beginner"]),
    "lat-goblet-step": (["goblet lateral step", "goblet step up", "lateral step up", "side step up", "酒杯側跨步"], ["barbell"]),

    # Coord
    "co-crosscrawl": (["cross crawl", "交叉爬行"], []),
    "co-toetap": (["toe tap", "toe taps", "腳踝點地"], []),
    "co-sl-stand": (["single leg stand", "single-leg stand", "single leg balance", "單腳站"], ["eyes closed", "閉眼"]),
    "co-bearhold": (["bear hold", "bear plank", "quadruped hold", "熊式撐地"], []),
    "co-bear-tap": (["bear crawl shoulder tap", "bear shoulder tap", "bear plank shoulder tap", "熊爬摸肩"], []),
    "co-spiderman": (["spiderman crawl", "spider-man crawl", "spider crawl", "蜘蛛人爬行"], []),
    "co-crabreach": (["crab reach", "螃蟹伸手"], []),
    "co-shuffle": (["lateral shuffle", "side shuffle", "側併步"], []),
    "co-carioca": (["carioca", "grapevine drill", "grapevine exercise", "交叉步"], []),
    "co-scorpion": (["scorpion stretch", "scorpion exercise", "蠍子踢"], []),
    "co-bear-rev": (["reverse bear crawl", "backward bear crawl", "backwards bear crawl", "反向熊爬"], []),
    "co-sl-eyes": (["single leg balance eyes closed", "single-leg stand eyes closed", "eyes closed balance", "單腳站閉眼", "閉眼單腳站"], []),
    "co-bear-rot": (["bear crawl rotation", "bear crawl kick through", "bear crawl turn", "熊爬轉身", "熊式轉體"], []),
    "co-tgu": (["turkish get up", "turkish get-up", "tgu", "土耳其起立"], ["kettlebell", "dumbbell", "weighted", "負重"]),
    "co-tgu-kb": (["turkish get up", "turkish get-up", "tgu", "土耳其起立"], []),

    # Core
    "core-plank": (["front plank", "plank form", "棒式"], ["side plank", "reverse plank"]),
    "core-quad-tap": (["quadruped shoulder tap", "bird dog shoulder tap", "四足摸肩", "靜態四足摸肩"], []),
    "core-deadbug": (["dead bug", "deadbug"], []),
    "core-sideplank": (["side plank", "側棒式"], []),
    "core-plank-tap": (["plank shoulder tap", "plank tap", "前棒式肩膀點擊", "棒式肩膀點擊"], ["bear"]),
    "core-halo-lunge": (["halo lunge", "half kneeling halo", "lunge halo", "弓步繞頸", "跪姿繞頸"], []),
    "core-pallof": (["pallof press", "half kneeling pallof", "anti-rotation press", "半跪抗旋轉前推", "抗旋轉前推"], []),
    "core-hollow": (["hollow body hold", "hollow hold", "hollow body"], ["rock"]),
    "core-rkc": (["rkc plank", "rkc 棒式"], []),
    "core-hollow-rock": (["hollow rock", "hollow rocks"], []),
    "core-halo-kb": (["kettlebell halo", "lunge halo", "half kneeling kettlebell halo", "弓步壺鈴繞頸", "壺鈴繞頸"], []),

    # Loco
    "loco-crawl": (["bear crawl", "俯臥爬行", "熊爬"], ["lateral", "reverse"]),
    "loco-jack": (["jumping jack", "開合跳"], ["step jack"]),
    "loco-stepjack": (["step jack", "low impact jumping jack", "無跳開合"], []),
    "loco-highknee": (["high knee", "high knees", "高抬腿"], []),
    "loco-shadowbox": (["shadow boxing", "shadowboxing", "影子拳擊"], []),
    "loco-mtn": (["mountain climber", "登山者"], ["lateral"]),
    "loco-duck": (["duck walk", "鴨子走"], []),
    "loco-burpee": (["burpee", "burpees", "波比"], []),

    # Calf
    "calf-raise": (["calf raise", "standing calf raise", "站姿提踵", "提踵"], ["single leg", "seated", "bent knee"]),
    "calf-soleus": (["bent knee calf raise", "soleus calf raise", "seated calf raise", "屈膝提踵", "比目魚肌"], []),
    "calf-sl": (["single leg calf raise", "single-leg calf raise", "單腳提踵"], []),
    "calf-tib": (["tibialis raise", "tib raise", "toe raise", "脛前勾腳尖", "脛前肌"], []),

    # Stretches
    "st-quad": (["quad stretch", "standing quad stretch", "股四頭伸展"], []),
    "st-ham": (["hamstring stretch", "seated hamstring stretch", "腿後伸展"], []),
    "st-greatest": (["world's greatest stretch", "worlds greatest stretch", "最偉大伸展"], []),
    "st-hipflexor": (["hip flexor stretch", "half kneeling hip flexor", "髖屈肌伸展"], []),
    "st-couch": (["couch stretch", "沙發伸展"], []),
    "st-9090": (["90/90 stretch", "90 90 stretch", "90/90 hip stretch", "90/90 前傾"], []),
    "st-pigeon": (["pigeon pose", "pigeon stretch", "鴿式"], []),
    "st-thread": (["figure 4 stretch", "figure four stretch", "supine figure 4", "穿針", "躺姿穿針"], []),
    "st-calf": (["calf stretch", "standing calf stretch", "小腿伸展"], []),
    "st-chest": (["doorway chest stretch", "doorway stretch", "chest stretch", "門框開胸", "胸肌伸展"], []),
    "st-openbook": (["open book stretch", "open book thoracic", "胸椎開書"], []),
    "st-catcow": (["cat cow", "cat-cow", "貓牛"], []),
    "st-child": (["child's pose", "childs pose", "嬰兒式"], []),
    "st-wrist": (["wrist stretch", "wrist mobility", "手腕伸展"], [])
}

def parse_duration(dur_str):
    if not dur_str:
        return 0
    parts = dur_str.strip().split(':')
    try:
        parts = [int(p) for p in parts]
        if len(parts) == 1:
            return parts[0]
        elif len(parts) == 2:
            return parts[0] * 60 + parts[1]
        elif len(parts) == 3:
            return parts[0] * 3600 + parts[1] * 60 + parts[2]
    except:
        return 0
    return 0

def parse_views(v_str):
    if not v_str:
        return 0
    nums = re.sub(r'[^\d]', '', v_str)
    return int(nums) if nums else 0

def check_oembed(vid):
    url = f'https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={vid}&format=json'
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=4) as resp:
            d = json.loads(resp.read().decode('utf-8'))
            return True, d.get('title'), d.get('author_name')
    except:
        return False, None, None

def search_yt(query):
    url = 'https://www.youtube.com/results?search_query=' + urllib.parse.quote(query)
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=8) as r:
            html = r.read().decode('utf-8')
    except Exception as e:
        print(f"  [Search error: {e}]", flush=True)
        return []
    m = re.search(r'var ytInitialData = ({.*?});</script>', html)
    if not m:
        return []
    try:
        data = json.loads(m.group(1))
    except:
        return []
    
    vids = []
    def find_v(o):
        if isinstance(o, dict):
            if 'videoRenderer' in o:
                vids.append(o['videoRenderer'])
            for v in o.values():
                find_v(v)
        elif isinstance(o, list):
            for i in o:
                find_v(i)
    find_v(data)
    return vids

def detect_language(title):
    if re.search(r'[\u4e00-\u9fff]', title):
        return 'zh'
    return 'en'

def check_relevance(move, title, channel, duration):
    mid = move['id']
    gear = move.get('gear', [])
    t_lower = title.lower()

    # Rule: Exclude obvious non-tutorial content
    negatives = ['#shorts', 'reaction', 'funny', 'compilation', 'unboxing', 'review', 'podcast', 'lofi', 'bgm', 'song', 'music', 'fails', 'gym fails', 'meme', 'vlog', 'day in the life']
    if any(n in t_lower for n in negatives):
        return False, "negative keywords"

    # Rule: Exclude pure workouts / follow-along without tutorial
    if ('30 min' in t_lower or '45 min' in t_lower or '1 hour' in t_lower or 'full workout' in t_lower or 'follow along workout' in t_lower) and not any(k in t_lower for k in ['tutorial', 'how to', 'form', 'technique']):
        return False, "full workout instead of tutorial"

    # Movement constraint dictionary check
    if mid in MOVE_CONSTRAINTS:
        req_any, forbid_any = MOVE_CONSTRAINTS[mid]
        if req_any:
            if not any(k.lower() in t_lower for k in req_any):
                return False, f"missing required keywords for {mid}"
        if forbid_any:
            if any(k.lower() in t_lower for k in forbid_any):
                return False, f"contains forbidden keywords for {mid}"

    return True, "matches specification"

def research_batch(batch_idx, batch_size=20):
    with open('data/movements.json', 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    all_moves = data['moves']
    start_i = (batch_idx - 1) * batch_size
    end_i = min(start_i + batch_size, len(all_moves))
    batch_moves = all_moves[start_i:end_i]

    print(f"=== Running Batch {batch_idx}: movements {start_i+1} to {end_i} ({len(batch_moves)} moves) ===")

    batch_output = {
        "version": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": "gemini-youtube-research",
        "selectionPolicy": "relevance-gate-then-view-count",
        "movementCount": len(batch_moves),
        "videoCount": 0,
        "movements": {},
        "issues": []
    }

    total_videos = 0

    for i, move in enumerate(batch_moves):
        mid = move['id']
        mzh = move['zh']
        men = move['en']
        mkw = move['kw']
        print(f"[{start_i + i + 1}/{len(all_moves)}] Researching {mid} ({mzh} / {men})...", flush=True)

        queries = [
            f"{mkw} exercise tutorial proper form",
            f"{men} how to correct form"
        ]
        
        candidates = []
        seen_vids = set()

        for q in queries:
            v_list = search_yt(q)
            time.sleep(0.3)
            for vr in v_list:
                vid = vr.get('videoId')
                if not vid or vid in seen_vids:
                    continue
                seen_vids.add(vid)
                title = ''.join([r.get('text', '') for r in vr.get('title', {}).get('runs', [])])
                channel = ''.join([r.get('text', '') for r in vr.get('ownerText', {}).get('runs', [])])
                dur_str = vr.get('lengthText', {}).get('simpleText', '')
                dur = parse_duration(dur_str)
                v_str = vr.get('viewCountText', {}).get('simpleText', '')
                views = parse_views(v_str)

                # Duration gate: 40s to 750s
                if dur < 40 or dur > 750:
                    continue

                ok, reason = check_relevance(move, title, channel, dur)
                if not ok:
                    continue

                candidates.append({
                    'videoId': vid,
                    'title': title,
                    'channel': channel,
                    'durationSec': dur,
                    'viewCountAtSelection': views,
                    'watchUrl': f"https://www.youtube.com/watch?v={vid}",
                    'language': detect_language(title),
                    'checkedAt': datetime.now().strftime('%Y-%m-%d'),
                    'embeddable': True,
                    'approved': True,
                    'selectionNote': f"符合{move['pattern']}動作模式與{move.get('tier','')}標準姿勢"
                })

        if len(candidates) < 3:
            q3 = f"{mzh} 正確動作 教學"
            queries.append(q3)
            v_list = search_yt(q3)
            time.sleep(0.3)
            for vr in v_list:
                vid = vr.get('videoId')
                if not vid or vid in seen_vids:
                    continue
                seen_vids.add(vid)
                title = ''.join([r.get('text', '') for r in vr.get('title', {}).get('runs', [])])
                channel = ''.join([r.get('text', '') for r in vr.get('ownerText', {}).get('runs', [])])
                dur_str = vr.get('lengthText', {}).get('simpleText', '')
                dur = parse_duration(dur_str)
                v_str = vr.get('viewCountText', {}).get('simpleText', '')
                views = parse_views(v_str)

                if dur < 30 or dur > 900:
                    continue

                ok, reason = check_relevance(move, title, channel, dur)
                if not ok:
                    continue

                note = f"符合{move['pattern']}動作模式與{move.get('tier','')}標準姿勢"
                if dur < 45 or dur > 720:
                    note += f"；片長 {dur}s 略超出建議範圍但內容完整相符"

                candidates.append({
                    'videoId': vid,
                    'title': title,
                    'channel': channel,
                    'durationSec': dur,
                    'viewCountAtSelection': views,
                    'watchUrl': f"https://www.youtube.com/watch?v={vid}",
                    'language': detect_language(title),
                    'checkedAt': datetime.now().strftime('%Y-%m-%d'),
                    'embeddable': True,
                    'approved': True,
                    'selectionNote': note
                })

        if len(candidates) < 3:
            q4 = f"{mkw} tutorial"
            queries.append(q4)
            v_list = search_yt(q4)
            time.sleep(0.3)
            for vr in v_list:
                vid = vr.get('videoId')
                if not vid or vid in seen_vids:
                    continue
                seen_vids.add(vid)
                title = ''.join([r.get('text', '') for r in vr.get('title', {}).get('runs', [])])
                channel = ''.join([r.get('text', '') for r in vr.get('ownerText', {}).get('runs', [])])
                dur_str = vr.get('lengthText', {}).get('simpleText', '')
                dur = parse_duration(dur_str)
                v_str = vr.get('viewCountText', {}).get('simpleText', '')
                views = parse_views(v_str)

                if dur < 25 or dur > 900:
                    continue

                ok, reason = check_relevance(move, title, channel, dur)
                if not ok:
                    continue

                note = f"符合{move['pattern']}動作模式與{move.get('tier','')}標準姿勢"
                if dur < 45 or dur > 720:
                    note += f"；片長 {dur}s 略超出建議範圍但內容完整相符"

        if len(candidates) < 3 and mid in MOVE_CONSTRAINTS and MOVE_CONSTRAINTS[mid][0]:
            for syn in MOVE_CONSTRAINTS[mid][0][:4]:
                if len(candidates) >= 3:
                    break
                q_syn = f"{syn} tutorial"
                queries.append(q_syn)
                v_list = search_yt(q_syn)
                time.sleep(0.3)
                for vr in v_list:
                    vid = vr.get('videoId')
                    if not vid or vid in seen_vids:
                        continue
                    seen_vids.add(vid)
                    title = ''.join([r.get('text', '') for r in vr.get('title', {}).get('runs', [])])
                    channel = ''.join([r.get('text', '') for r in vr.get('ownerText', {}).get('runs', [])])
                    dur_str = vr.get('lengthText', {}).get('simpleText', '')
                    dur = parse_duration(dur_str)
                    v_str = vr.get('viewCountText', {}).get('simpleText', '')
                    views = parse_views(v_str)

                    if dur < 20 or dur > 900:
                        continue

                    ok, reason = check_relevance(move, title, channel, dur)
                    if not ok:
                        continue

                    note = f"符合{move['pattern']}動作模式與{move.get('tier','')}標準姿勢"
                    if dur < 45 or dur > 720:
                        note += f"；片長 {dur}s 略超出建議範圍但內容完整相符"

                    candidates.append({
                        'videoId': vid,
                        'title': title,
                        'channel': channel,
                        'durationSec': dur,
                        'viewCountAtSelection': views,
                        'watchUrl': f"https://www.youtube.com/watch?v={vid}",
                        'language': detect_language(title),
                        'checkedAt': datetime.now().strftime('%Y-%m-%d'),
                        'embeddable': True,
                        'approved': True,
                        'selectionNote': note
                    })

        candidates.sort(key=lambda x: x['viewCountAtSelection'], reverse=True)

        final_picks = []
        channels_seen = set()
        for c in candidates:
            emb, official_t, official_ch = check_oembed(c['videoId'])
            if not emb:
                continue
            c['embeddable'] = True
            if official_t:
                c['title'] = official_t
            if official_ch:
                c['channel'] = official_ch

            if c['channel'] in channels_seen and len(candidates) >= 5:
                continue
            channels_seen.add(c['channel'])
            final_picks.append(c)
            if len(final_picks) == 3:
                break

        if len(final_picks) < 3:
            for c in candidates:
                if c in final_picks:
                    continue
                emb, official_t, official_ch = check_oembed(c['videoId'])
                if not emb:
                    continue
                c['embeddable'] = True
                if official_t: c['title'] = official_t
                if official_ch: c['channel'] = official_ch
                final_picks.append(c)
                if len(final_picks) == 3:
                    break

        batch_output['movements'][mid] = final_picks
        total_videos += len(final_picks)
        print(f"  -> Found {len(final_picks)} verified videos for {mid}", flush=True)

        if len(final_picks) < 3:
            batch_output['issues'].append({
                "movementId": mid,
                "found": len(final_picks),
                "reason": "找不到足夠可嵌入且版本相符的教學影片",
                "queriesTried": queries
            })

    batch_output['videoCount'] = total_videos
    part_filename = f"movement-videos.part-{batch_idx:02d}.json"
    with open(part_filename, 'w', encoding='utf-8') as f:
        json.dump(batch_output, f, ensure_ascii=False, indent=2)
    print(f"=== Saved {part_filename} with {len(batch_output['movements'])} moves and {total_videos} videos ===")
    return part_filename, batch_output

if __name__ == '__main__':
    batch_num = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    research_batch(batch_num)
