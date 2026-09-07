# Gemini 騎行影片生成包

## 平台建議：改用 Google Flow

這組「山線／河濱／城市」建議放在同一個 Flow 專案中製作。Flow 可以保存人物與場景 Ingredients、重複使用素材、擷取首尾影格，並用 Scenebuilder 預覽三支片接在一起的節奏。

### 最省點數的第一輪設定

- 模式：`Video → Ingredients`
- 模型：`Gemini Omni Flash 1.1`
- 解析度：先用 `360p`
- 長度：`8s`
- 比例：`16:9 Landscape`
- 每次輸出：`1`
- 第一輪只放五張圖片，不放參考影片，避免被當成昂貴的 Video-to-Video edit。

各場景使用以下五張：

- 山線：`02 + 03 + 04 + 05 + 06`
- 河濱：`02 + 03 + 04 + 06 + 07`
- 城市：`02 + 03 + 04 + 06 + 08`

先各產一支草稿；只重做真正失敗的場景。挑中版本後再升至 `720p` 或 `1080p`。若 Flow 介面顯示目前模型／地區不支援某項功能，以介面當下提示為準。

`01-motion-reference-current-hero.mp4` 保留作肉眼比較，不在第一輪上傳。只有當人物和構圖已經正確、但動作仍需要精準修正時，才考慮改用 Omni 的 Video-to-Video editing。

## 上傳方式

在 Gemini 的「建立影片」中，一次上傳下列 **1 支影片＋5 張圖片**：

1. `docs/gemini-video-pack/01-motion-reference-current-hero.mp4`
2. `docs/gemini-video-pack/02-steve-face-outfit-front.png`
3. `docs/gemini-video-pack/03-steve-riding-dynamic-corner.png`
4. `docs/gemini-video-pack/04-steve-riding-side-profile.png`
5. `docs/gemini-video-pack/05-road-lightning-environment.jpg`
6. `docs/gemini-video-pack/06-ui-framing-reference.png`

一次只生成一支。三支影片都使用相同素材，但分別貼下面不同的提示詞。

### 素材用途

- `01`：只參考目前正確的騎乘節奏、運鏡速度與整體連續感。
- `02`：Steve 的臉、黃色車衣、灰色車褲、黑色安全帽、紅色眼鏡與紅鞋。
- `03`、`04`：Steve 的身形、騎姿、公路車比例及踩踏方式。
- `05`：台灣山路、雷雨雲、濕氣和光線。
- `06`：只參考網站需要的最終構圖、右側人物位置與左側留白；**不要把裡面的文字、按鈕、AF 框或 UI 畫進影片。**

## 今日生成順序

1. `EASE`：目前 TODAY 最需要，若只剩一次額度就先做它。
2. `GO`：有精神、可以訓練的狀態。
3. `REST`：疲勞／恢復狀態。

`NODATA` 先使用靜態 poster，不浪費一次影片額度。

---

## 影片一：EASE／保守騎行（最高優先）

```text
Use all uploaded files as clearly separated references, not as frames to transition between.

Create a single continuous 8-second cinematic landscape video, 16:9, with a natural 24 fps film-motion feeling. Preserve Steve's recognizable facial structure and real identity from the portrait references. Make him look slightly cleaner and more heroic through flattering natural light only; do not change his age, face shape, ethnicity, or body. Preserve the yellow cycling jersey, gray bib shorts, black helmet, red sports glasses, white gloves, white socks, red cycling shoes, and dark road bicycle. Simplify any tiny unreadable logos instead of inventing text.

SCENE: Steve is steadily climbing a real humid Taiwan mountain road after light rain. The grade is continuously uphill. The asphalt is damp, the vegetation is dense and natural, and soft mountain mist hangs in the valleys. The weather, cloud coverage, road surface, and time of day remain completely continuous from the first frame to the last frame. No sudden weather or exposure change.

RIDING: This is an EASE / conservative training day. Steve remains seated, shoulders relaxed, breathing controlled, hands naturally on the brake hoods, smooth medium-low cadence, visibly working uphill but never sprinting. Pedaling must be biomechanically correct: alternating crank rotation, synchronized knees and feet, both wheels rotating naturally, stable frame geometry, front wheel pointed along the road.

CAMERA: One uninterrupted front three-quarter tracking shot. The camera vehicle stays several meters ahead of Steve, travels uphill at exactly his speed, and looks backward toward him. Steve stays on the right third of frame. Keep generous clean negative space over the mountains and road on the left for website data. Use a restrained 50–70 mm equivalent lens look. Begin slightly wider and perform one extremely slow, smooth 5% optical push-in across the full clip, ending around helmet-to-knees framing. Never zoom back out.

ROAD DIRECTION: The bicycle and front wheel always travel forward and uphill along the road's stable vanishing point. Use only one broad gentle curve. No hairpin, no switchback, no U-turn impression, no sideways bicycle, and no camera orbit.

COLOR: Refined low-contrast cinematic color inspired by a restrained Eterna-style film mood: soft highlight roll-off, warm skin and yellow jersey, cool gray-green shadows, muted vegetation, realistic Taiwan humidity, very fine organic grain. Keep detail and dynamic range so a website can apply additional grading later.

ABSOLUTE CONTINUITY: single shot, no cut, no montage, no transition, no time jump, no location change, no weather jump, no lightning, no rack-focus loop, no speed ramp, no slow motion, no drone angle, no artificial camera shake.

OUTPUT MUST CONTAIN NO text, captions, numbers, race bib overlays, logos, watermark, camera HUD, focus box, website UI, music, or dialogue. Avoid extra people, vehicles, cones, malformed hands, extra limbs, warped bicycle parts, changing clothes, or changing face.
```

---

## 影片二：GO／狀態良好

```text
Use all uploaded files as clearly separated references, not as frames to transition between.

Create a single continuous 8-second cinematic landscape video, 16:9, with a natural 24 fps film-motion feeling. Preserve Steve's recognizable facial structure and real identity from the portrait references. Make him look slightly cleaner and more heroic through flattering natural light only; do not change his age, face shape, ethnicity, or body. Preserve the yellow cycling jersey, gray bib shorts, black helmet, red sports glasses, white gloves, white socks, red cycling shoes, and dark road bicycle. Simplify tiny unreadable logos instead of inventing text.

SCENE: Steve is climbing a real humid Taiwan mountain road during one continuous clearing thunderstorm. Dark layered clouds remain present for the entire shot, with subtle distant lightning illuminating the same cloud bank several times. The storm never turns into clear sky, sunset, a different road, or a different time of day. Damp asphalt reflects small amounts of warm light; wind moves nearby silver grass gently.

RIDING: This is a GO / ready-to-train day. Steve rides strongly but credibly, mostly seated with a powerful smooth cadence and a short controlled rise from the saddle near the final two seconds. His upper body remains stable and athletic. Pedaling must be biomechanically correct: alternating crank rotation, synchronized knees and feet, both wheels rotating naturally, hands remaining on the hoods, stable frame geometry, front wheel pointed along the road.

CAMERA: One uninterrupted front three-quarter tracking shot. The camera vehicle stays several meters ahead, travels uphill at Steve's speed, and looks backward toward him. Steve stays on the right third. Keep clean negative space over the mountain landscape on the left for website data. Use a restrained 50–70 mm equivalent lens look. Perform one extremely slow, smooth 5% optical push-in across the full clip, ending around helmet-to-knees framing. Never zoom back out.

ROAD DIRECTION: The bicycle always moves forward and uphill toward one stable vanishing direction. Use only one broad gentle bend. No hairpin, switchback, U-turn impression, lateral turn across the road, or orbiting camera.

COLOR: Dramatic but realistic low-contrast cinema color: warm highlights on Steve, cool slate storm shadows, restrained green vegetation, soft highlight roll-off, fine organic grain. Lightning should create brief natural illumination inside the existing clouds, not a white flash over the whole frame.

ABSOLUTE CONTINUITY: single shot, no cut, no montage, no transition, no time jump, no location change, no weather jump, no sky replacement, no looped zoom, no speed ramp, no slow motion, no drone angle, no artificial shake.

OUTPUT MUST CONTAIN NO text, captions, numbers, race bib overlays, logos, watermark, camera HUD, focus box, website UI, music, or dialogue. Avoid extra people, vehicles, cones, malformed hands, extra limbs, warped bicycle parts, changing clothes, or changing face.
```

---

## 影片三：REST／疲勞恢復

```text
Use all uploaded files as clearly separated references, not as frames to transition between.

Create a single continuous 8-second cinematic landscape video, 16:9, with a natural 24 fps film-motion feeling. Preserve Steve's recognizable facial structure and real identity from the portrait references. Do not beautify or alter his identity. Preserve the yellow cycling jersey, gray bib shorts, black helmet, red sports glasses, white gloves, white socks, red cycling shoes, and dark road bicycle. Simplify tiny unreadable logos instead of inventing text.

SCENE: Steve is making a very gentle recovery climb on a quiet Taiwan mountain road at cool misty dawn. Fine drizzle, low cloud, damp asphalt, deep green roadside plants and soft fog remain stable for the entire clip. The atmosphere is calm, humid and reflective, never dangerous or gloomy. No weather, location, daylight, or exposure change.

RIDING: This is a REST / fatigued recovery day. Steve stays seated for the whole shot, pedals lightly at an easy cadence, shoulders and hands relaxed, expression calm but slightly tired. No attack, sprint, standing effort or dramatic body rocking. Pedaling must remain biomechanically correct: alternating crank rotation, synchronized knees and feet, natural wheel rotation, stable bicycle geometry, front wheel following the road.

CAMERA: One uninterrupted front three-quarter tracking shot. A camera vehicle several meters ahead travels uphill at the same slow speed and looks backward toward Steve. Steve remains on the right third, with generous soft mountain and road negative space on the left for website data. Use a natural 50–70 mm equivalent lens look. Add only a very subtle 3% push-in over the full clip, then hold; never pull back.

ROAD DIRECTION: The road climbs continuously in one direction through a single broad gentle curve. The bicycle follows a stable vanishing point. No hairpin, switchback, U-turn impression, sideways bicycle, or camera orbit.

COLOR: Quiet cinematic gray-green palette inspired by soft low-contrast film: protected highlights, gentle skin tones, restrained yellow jersey, slightly cool shadows, delicate mist and extremely fine organic grain. Keep the cyclist readable against the environment.

ABSOLUTE CONTINUITY: single shot, no cut, no montage, no transition, no time jump, no location change, no weather jump, no lightning, no focus-loop, no speed ramp, no slow motion, no drone shot, no camera shake.

OUTPUT MUST CONTAIN NO text, captions, numbers, race bib overlays, logos, watermark, camera HUD, focus box, website UI, music, or dialogue. Avoid extra people, vehicles, cones, malformed hands, extra limbs, warped bicycle parts, changing clothes, or changing face.
```

## 如果成品仍然像迴轉，追加這句重做

```text
Regenerate the entire clip with stricter road geometry: keep the bicycle front wheel within 3 degrees of the road's single stable vanishing line at all times. The rider and camera both travel uphill in the same direction at matching speed. The road may curve gently but must never cross behind the rider, reverse direction, form a hairpin, or visually suggest a U-turn.
```

## 如果天氣仍然跳動，追加這句重做

```text
Lock the environment from frame one: identical cloud mass, road wetness, vegetation density, fog level, color temperature and exposure throughout the entire shot. Weather effects may move naturally inside the same environment, but no new sky, sun, storm front, location, lighting setup or season may appear.
```

---

# 第二組：騎行電影場景

除了山路，再製作「河濱」與「台北市區」兩支。三支片不是三種隨機特效，而是同一部騎行電影的三個章節：

1. `MOUNTAIN／山線`：意志、爬升、雷雨。
2. `RIVER／河濱`：呼吸、節奏、夕陽。
3. `CITY／城市`：速度、燈光、台北濕夜。

## 河濱版上傳素材

一次仍維持 **1 支影片＋5 張圖片**，不要把資料夾八個檔案全部丟進去：

1. `01-motion-reference-current-hero.mp4`
2. `02-steve-face-outfit-front.png`
3. `03-steve-riding-dynamic-corner.png`
4. `04-steve-riding-side-profile.png`
5. `06-ui-framing-reference.png`
6. `07-riverside-environment.jpg`

## 影片四：RIVER／河濱夕陽

```text
Use the uploaded video only as a reference for Steve's natural cycling motion, identity continuity and restrained tracking-camera pace. Use the three Steve photos for his real face, body, yellow-and-gray cycling kit, red glasses, red shoes and dark road bicycle. Use the riverside image only for Taiwan humidity, sunset color, distant water and industrial shoreline atmosphere. Use the UI framing image only for composition and negative space; do not reproduce any interface elements.

Create one continuous 8-second cinematic 16:9 cycling shot with natural 24 fps motion. Steve rides at a strong but comfortable endurance pace on a real Taipei riverside bicycle path at humid golden hour after a brief summer shower. The broad river and warm hazy sky stay on the left; low silver grass, levee textures, distant bridges and restrained city silhouettes establish Taiwan without becoming a tourist postcard. The asphalt is slightly damp and catches small warm reflections. No temple collage, lanterns, giant TAIWAN lettering, staged tourism symbols or dramatic fantasy skyline.

Steve stays seated and pedals smoothly. Hands remain naturally on the hoods, shoulders relaxed, crank and leg motion biomechanically correct, wheels rotating consistently, bicycle geometry stable. No sprint, no cornering lean and no U-turn.

CAMERA: a low front three-quarter tracking camera travels parallel to Steve and slightly ahead of him at matching speed. Steve remains on the right third of the frame, helmet-to-knees by the final frame. The river, sky and path create generous clean negative space on the left for website information. Use a restrained 50–70 mm equivalent lens look and one very slow 4% push-in over the entire clip. No zoom out. The camera height, distance, horizon and rider screen position must remain stable.

PATH: one long, flat, forward-moving riverside path with a stable vanishing point. A very gentle bend is allowed, but the path never reverses, crosses behind Steve, forms a hairpin or suggests a U-turn.

COLOR: poetic but photoreal cinematic film color, warm peach highlights, muted cyan-gray water, restrained green vegetation, soft highlight roll-off, slightly lifted black levels and very fine organic grain. Keep Steve's yellow jersey rich but not fluorescent.

The weather and environment are locked from the first frame to the last. Single shot only: no cut, montage, transition, location change, time jump, sky replacement, exposure jump, drone shot, speed ramp, slow motion or artificial shake. Start and end on clean stable frames without fade-in or fade-out so the website can perform its own scene transition.

No text, captions, numbers, logos, watermark, website UI, focus box, camera HUD, music or dialogue. No extra riders, pedestrians, scooters, cars, cones, malformed hands, extra limbs, warped wheels, changing clothes or changing face.
```

## 市區版上傳素材

1. `01-motion-reference-current-hero.mp4`
2. `02-steve-face-outfit-front.png`
3. `03-steve-riding-dynamic-corner.png`
4. `04-steve-riding-side-profile.png`
5. `06-ui-framing-reference.png`
6. `08-taipei-city-color-reference.jpg`

## 影片五：CITY／台北濕夜

```text
Use the uploaded video only as a reference for Steve's cycling motion, real identity continuity and restrained tracking-camera pace. Use the three Steve photos for his real face, body, yellow-and-gray cycling kit, red glasses, red shoes and dark road bicycle. Use the Taipei skyline photo only as a reference for Taipei's humid blue-hour color, building density and distant city glow. The generated scene itself must be at street level. Use the UI framing image only for composition and negative space; do not reproduce any interface elements.

Create one continuous 8-second cinematic 16:9 cycling shot with natural 24 fps motion. Steve rides smoothly through a believable Taipei street just after rain at blue hour transitioning into night. Show authentic but restrained local texture: wet dark asphalt, white lane markings, concrete arcades, small shop light spill, parked scooters kept safely at the edge, traffic signals reflected in shallow water, dense mid-rise buildings and humid air. Taipei 101 may appear only as a small distant orientation detail if composition allows; it must not dominate the scene. Avoid cyberpunk neon, tourism-poster imagery, lantern streets, temple collage, giant signs, impossible empty highways or unsafe traffic.

Steve rides forward in a protected clear lane at a controlled tempo. He stays seated, hands on the hoods, eyes forward, shoulders stable. Pedaling is biomechanically correct with synchronized cranks, knees, feet and wheel rotation. The bicycle remains physically consistent and upright. No sprint, skid, sudden lean, collision or U-turn.

CAMERA: one low front three-quarter tracking shot from a camera vehicle moving ahead in the same lane at exactly Steve's speed, looking backward toward him. Steve remains on the right third. Preserve clean darker negative space on the left for website data while allowing street lights to create depth. Use a restrained 50–70 mm equivalent lens look. Perform one slow 4% push-in over the entire clip; never pull back. Maintain one stable horizon, camera distance and vanishing point.

STREET DIRECTION: Steve and the camera travel forward along one continuous street. A mild road curve is allowed, but no intersection turn, hairpin, route reversal, orbiting camera or impression that Steve is circling back.

COLOR: realistic cinematic Taipei night, warm tungsten shop highlights, muted red and green traffic reflections, cool blue-gray shadows, protected skin tone, restrained saturation, soft highlight halation and very fine film grain. The yellow jersey remains the single strongest color accent.

Lock rain level, street wetness, traffic density, buildings, color temperature and exposure throughout. Single shot only: no cut, montage, transition, location change, time jump, weather jump, day-to-night transformation, drone shot, speed ramp, slow motion or camera shake. Start and end on clean stable frames without fade-in or fade-out so the website can perform its own scene transition.

No text, readable storefront words, captions, numbers, logos, watermark, website UI, focus box, camera HUD, music or dialogue. No moving vehicle may cross Steve's path. Avoid extra riders, malformed hands, extra limbs, warped bicycle parts, changing clothes or changing face.
```

## 網站中的播放方式

建議做成一卷約 24 秒的 `RIDE FILM`：

`MOUNTAIN 8s → RIVER 8s → CITY 8s → 回到 MOUNTAIN`

- 影片播完才切下一支，不使用固定秒數硬切。
- 第一次進入 TODAY 才演一次對焦鎖定；之後換場景不再失焦。
- 不使用 crossfade，否則兩個 Steve 會疊影。
- 場景間使用約 `220–300ms` 的 shutter blink：迅速壓暗至約 85%，帶一點暖色漏光，立即打開下一段。
- 不使用馬賽克、像素分解、長時間黑屏或重新 zoom。
- 提供 `山線／河濱／城市` 三個低調的小型場景切換鈕；使用者點選後從該片開頭播放。
- 自動輪播預設開啟；滑鼠停在影片上、開啟 modal/drawer、頁面失焦時暫停。
- 只預載目前與下一支影片，避免三支同時解碼。
- iPhone 使用 `muted playsinline`；省電模式或 `prefers-reduced-motion` 顯示對應靜態 poster。
