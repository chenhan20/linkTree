# Steve Identity Module V4 · Split High-Detail Pack

## 為什麼拆成三張

四角度塞在同一張圖時，臉、胸前文字與車架只分到很少畫素，影片模型容易把 Steve 變成普通黃衣車手。V4 將臉、正面騎姿與側面車體拆開，讓 Gemini／Flow 每次只讀取需要的資訊。

## 最終素材

1. `steve-face-identity-sheet-v1.png`
   - 正面、左右前三分之四、左右側面與輕微自信表情。
   - 鼻型以證件照為準；鼻孔自然、不放大。
   - 只透過髮型、精神與光線稍微變帥，不改成另一個人。
2. `steve-rider-front-three-angles-v1.png`
   - 騎乘正面、左前三分之四、右前三分之四。
   - 保留 `From zero to HERO`、Santini、NEUTEC／公牛袖章、ZIV、2969、Van Rysel 與 GIANT。
3. `steve-rider-side-profile-v1.png`
   - 單一大尺寸傳動側面。
   - GIANT TCR PRO 0 車架、車身比例與踩踏機構為主。

## 不可變動規則

- Steve 臉部以 `identity-source/01-face-front.jpg` 與臉部模組為最高優先。
- 鼻翼與鼻孔保持自然放鬆，不得變寬、上翻或誇張。
- 兩側前臂與手掌保持乾淨皮膚：不要手寫號碼、黑色直排字、刺青式字樣或任何皮膚文字。
- 手臂上的號碼移除，但安全帽與車後藍色 `2969` 號碼牌保留。
- 所有原照可辨識品牌保留；不可去品牌化，也不可在看不清楚的地方發明品牌。
- 黃色 Santini 車衣必須保留正確的 `From zero to HERO`；素黃色視為失敗。
- 車輛必須是 Steve 的深藍灰色 GIANT TCR PRO 0，不可換成通用車、計時車或其他品牌。

## Prompt 1：臉部多角度

```text
Create a photorealistic 3-by-2 facial identity sheet of the exact same Steve: straight front, left three-quarter, right three-quarter, exact left profile, exact right profile, and a subtle confident front expression. Use the supplied formal portrait as the sole authoritative identity. Preserve his real adult East Asian face, eye spacing, brows, nose bridge and width, lips, jaw, cheeks, ears, skin tone, age, hairline and natural asymmetry. Match the portrait's nose exactly: small relaxed nostril openings, no flaring, enlarged holes, widened tip or upturned nose. Make him subtly more handsome only through neat natural hair, alert eyes, rested expression, soft studio light and modest jaw definition; no face replacement, surgery, aggressive slimming or beauty-filter skin. Plain charcoal T-shirt, no helmet, glasses, logo or text. Neutral gray studio, identical scale and lighting, realistic pores and consistent identity in all six views.
```

## Prompt 2：騎乘正面三角度

```text
Create a wide three-column photorealistic studio sheet showing the exact same Steve riding the exact same GIANT TCR PRO 0: straight front, front-left three-quarter and front-right three-quarter. Use the Steve facial identity sheet to lock his face and corrected natural nose. Preserve the vivid yellow Santini jersey and exact readable chest design "From zero to HERO", Santini mark, NEUTEC/bull sleeve artwork, charcoal helmet, white-frame red ZIV glasses, blue 2969 plate, gray Van Rysel bib shorts, white Van Rysel socks, white-black gloves and red cycling shoes. Completely remove all handwritten number, ink, tattoo-like letters and text from both forearms and hands; keep clean natural skin. Preserve the dark navy-charcoal GIANT TCR PRO 0, GIANT/TCR identity and mechanically correct bicycle geometry. Seated climbing posture, hands on hoods, full rider and full wheels visible. Neutral studio; no scenery, random text, fake logo, large nostrils, malformed anatomy or broken bicycle.
```

## Prompt 3：騎乘完整側面

```text
Create one wide high-resolution orthographic drivetrain-side studio photograph of the exact same Steve riding left to right on his exact dark navy-charcoal GIANT TCR PRO 0. Use the face sheet as facial authority and the original side cycling photo as authority for body build, bike fit, saddle height, TCR frame silhouette, GIANT branding, wheelbase, drivetrain and bottle placement. Preserve his yellow Santini "From zero to HERO" jersey, sleeve artwork, ZIV glasses, blue 2969 plate, gray Van Rysel shorts, white Van Rysel socks and red shoes. Both forearms and hands must be clean natural skin with no handwritten number, ink, tattoo-like letters or text. Keep the corrected natural nose and only subtly flattering grooming and light. Show one complete rider and one complete mechanically correct bicycle, large in frame, neutral gray studio, no road, motion blur, fake brand, random text, warped wheels, melted crank or cropped parts.
```

## 給 Gemini／Flow 的餵圖組合

### 正面或迎面鏡頭

1. `steve-face-identity-sheet-v1.png`
2. `steve-rider-front-three-angles-v1.png`
3. `identity-source/04-rider-front.png`
4. 目標環境 Start Frame

### 側向跟拍鏡頭

1. `steve-face-identity-sheet-v1.png`
2. `steve-rider-side-profile-v1.png`
3. `identity-source/02-bike-side.png`
4. 目標環境 Start Frame

> 不要在同一次生成同時加入舊四宮格 V1、V2、V3 與新的三張模組，過多互相矛盾的參考會降低臉部與品牌一致性。
