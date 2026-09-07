# 風櫃嘴山線背景生成規格

## 最終成品

- 建議給 Gemini／Flow 的 Start Frame：`09-fengguizui-mountain-background-v1.png`
- 山路與光線來源：`environment-source/current-hero-frame-08.jpg`
- 路面字樣參考：`environment-source/fengguizui-road-marking-reference.png`

> 路面參考圖只用來辨識白色上坡箭頭與「風櫃嘴」三字，不得沿用它的樹林、人物、直式構圖、道路形狀或晴天色彩。

## 可重複使用的圖片生成 Prompt

```text
Use case: photorealistic-natural
Asset type: clean 16:9 master environment / start-frame background for AI cycling-video generation.

Input images:
- Image 1 is the primary visual and cinematic environment reference. Preserve its misty Taiwan mountain scale, layered valley, wet asphalt mood, silver grass, guardrail, subdued low-contrast grading, overcast sky and soft light breaking through clouds. Reconstruct the road cleanly with no cyclist.
- Image 2 is a reference ONLY for the painted road-direction arrow and the vertically arranged Traditional Chinese asphalt marking "風櫃嘴". Do not use Image 2's forest canopy, cyclists, portrait composition, daylight, road shape, colors or scenery.

Primary request:
Generate a highly photorealistic empty Taiwan mountain-climb road based on the atmosphere and wide composition of Image 1. The finished image must function as a clean background plate that Gemini/Flow can later combine with a separate cyclist character reference.

Scene/backdrop:
A quiet high-elevation Taiwan mountain road climbing continuously forward through humid cloud country. On the left, a metal guardrail follows a deep layered mountain valley filled with natural drifting mist. On the right, a dark green hillside carries dense subtropical vegetation and silver grass. The asphalt is damp after rain, realistically mottled and slightly reflective, but there is no active rainfall and no puddle exaggeration.

Road geometry:
A single narrow paved road enters from the bottom center and climbs toward the upper-right-middle distance through one broad gentle right bend. The road has a stable forward vanishing point and unmistakably continues uphill. It must not form a hairpin, switchback, U-turn, fork, intersection or route reversal. Use crisp white edge lines on both sides. Do not add a center line.

Road marking:
Paint exactly one large white forward-pointing arrow in the lane, followed beneath it by exactly three large Traditional Chinese characters arranged vertically in road perspective: "風櫃嘴". From the distant end toward the foreground the visible order is arrow, "風", "櫃", "嘴", matching how the supplied marking reference is painted. The characters must be correct, legible Traditional Chinese, centered within the lane, foreshortened naturally by perspective, and integrated as slightly weathered matte road paint. No other words, numbers, symbols, bicycle icons or markings.

Composition/framing:
Wide cinematic 16:9 landscape. Low forward-facing tracking-camera viewpoint around 1.2 meters above the asphalt, as if mounted on a camera vehicle moving uphill. Keep the road and future cyclist placement primarily in the right half/right third. Preserve generous visually quiet misty mountain and sky negative space across the left 50–55% for website training data. The lane remains broad and unobstructed enough to insert one full cyclist later. No subject currently present.

Lighting/weather:
Stable heavy-but-natural layered cloud cover for the entire imagined scene, with a soft pale opening in the clouds and diffused late-afternoon light. No lightning, no storm flash, no clear blue sky, no sunset color jump. Authentic humid Taiwan atmosphere.

Style/medium:
Photorealistic cinematic location photography, natural optical depth, realistic asphalt and vegetation texture, restrained Eterna-like low contrast, cool gray-green shadows, gentle warm-gray highlights, subtle fine film grain, no synthetic fantasy look.

Constraints:
Empty clean background plate. Preserve believable Taiwan mountain-road scale and physical perspective. Road marking must read exactly "風櫃嘴". Keep all future rider space unobstructed.

Avoid:
No cyclist, person, bicycle, car, scooter, traffic cone, road sign, building, utility pole, tourist landmark, temple, lantern, giant TAIWAN lettering, race signage, camera UI, AF box, HUD, caption, watermark, logos, extra road text, lightning, dramatic sunbeam, cyberpunk color, illustration, CGI or matte-painting appearance.
```

## 給 Flow 製作影片時

1. 將 `09-fengguizui-mountain-background-v1.png` 設為固定 Start Frame／場景基準。
2. 另外加入 Steve 車手模組圖；不要再上傳路面參考照，避免場景被帶回原本的森林照片。
3. 要求單一連續鏡頭、一路穩定上坡；不得轉場、回頭、迴轉或突然換天氣。
4. 影片中的「風櫃嘴」路面字樣必須保持固定於地面，只能因鏡頭前進而自然通過畫面，不能漂移或重新生成。
