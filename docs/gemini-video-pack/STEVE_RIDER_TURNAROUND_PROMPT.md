# Steve Rider Identity Module · V3 Brand & Bike Accurate

> 已由拆分且解析度更高的 V4 取代。新影片請優先使用 `STEVE_IDENTITY_MODULE_V4_SPLIT.md` 列出的三張素材；本文件保留作舊版比較。

## 最終輸出

- 首選：`steve-rider-turnaround-master-v3-brands-giant-tcr.png`
- 備用：`steve-rider-turnaround-master-v2-detail.png`
- V3 進一步鎖定所有真實品牌與 GIANT TCR PRO 0；V2 可作幾何備援，V1 不再作身份主圖。

## 使用原則

- `identity-source/01-face-front.jpg` 是臉部唯一最高優先來源。
- `identity-source/04-rider-front.png` 是車衣文字、裝備與正面比例最高優先來源。
- `identity-source/03-rider-front-three-quarter.png` 補充騎姿、袖章與前三分之四外觀。
- `identity-source/02-bike-side.png` 補充側面身形、車架幾何、坐墊高度與踩踏姿勢。
- V1 素黃色模組只可當姿勢草稿，不可當人物或服裝主參考。
- V2 細節版可協助背面幾何，但車架品牌仍不夠準確，不可取代原始照片或 V3。

## 不可刪除的 Steve 身份錨點

1. 真實 Steve 的東亞臉型、五官比例、膚色、髮際與自然皮膚質感。
2. 黃色 Santini 車衣，胸前文字必須清楚呈現為 `From zero to HERO`；不得改成素黃色。
3. 車衣上的 Santini 小標與袖口黑色公牛章，位置及比例依原照保留。
4. 消光深灰安全帽、白框紅色鏡片運動眼鏡，以及藍色 `2969` 號碼牌。
5. 灰色 Van Rysel 車褲、白色 Van Rysel 長襪、白黑手套與紅色卡鞋。
6. 手臂上的黑色直向字樣／刺青外觀。
7. 原本深藍灰色 **GIANT TCR PRO 0** 公路車；必須保留 GIANT／TCR 車架識別、車架比例、彎把、輪組、坐墊高度與水壺位置，禁止換成相似的通用公路車。
8. 原照可辨識的 Santini、Van Rysel、GIANT、TCR、ZIV 與 NEUTEC／公牛袖章等細節都屬於人物身份；不可主動去品牌化。看不清楚的區域不得自行發明其他品牌。

## 圖像生成 Prompt

```text
Use case: identity-preserve, photorealistic-natural.
Create one extremely photorealistic professional 2-by-2 rider identity reference sheet showing the exact same Steve, the exact same signature racing kit and the exact same road bicycle in four consistent studio views. This is a high-detail identity module for future image-to-video generation. Visual identity and clothing accuracy are more important than generic cleanliness.

Reference hierarchy:
- Use the formal portrait as the sole highest-priority facial identity reference. Preserve Steve's exact adult East Asian facial structure, eyes, eyebrows, nose, lips, jaw, ears, skin tone, age, hairline and natural skin texture. Do not substitute or beautify him into a different person.
- Use the straight-on cycling photo as the highest-priority wardrobe, equipment and frontal-proportion reference.
- Use the cornering cycling photo only for three-quarter apparel details and real body proportions; remove the lean, cones, officials and event setting.
- Use the side cycling photo for body proportions, seated climbing pose, bicycle geometry, saddle height, crank, pedals, frame and wheel relationships.

Four equal panels on a neutral matte light-gray studio background with thin unobtrusive dividers:
1. Straight-on frontal full-rider view, bicycle and front wheel straight, hands naturally on the brake hoods.
2. Front three-quarter full-rider view, face visible, natural steady climbing posture.
3. Exact drivetrain-side orthographic profile, complete rider and mechanically correct complete bicycle.
4. Rear three-quarter view, conservatively reconstructed: yellow jersey back with three realistic pockets, no invented slogans or logos on areas not visible in the references.

Exact signature wardrobe and equipment — do not simplify:
- The same fitted vivid yellow Santini cycling jersey from the references.
- On the chest, preserve the exact readable design and capitalization: "From zero to HERO". Keep its handwritten black "From zero to" line and large light-gray "HERO" placement faithful to the source. This chest graphic is a primary identity marker and must never disappear, mutate, become random letters or turn into a plain jersey.
- Preserve the real small black Santini mark and the NEUTEC-style black bull/emblem sleeve artwork with its supporting marks exactly as visible in the supplied photos. Do not erase visible authentic branding and do not invent unrelated sponsors where the reference is unclear.
- Matte charcoal vented road helmet, white-framed wraparound cycling glasses with deep red mirrored lenses, and the blue race number plate reading exactly "2969" in the same plausible placement shown in the reference.
- Preserve the authentic ZIV eyewear identity where it is visibly supported by the source; do not add oversized invented eyewear logos.
- Light-gray Van Rysel bib shorts with the real readable side branding and pink accent visible in the source.
- White-and-black fingerless gloves, tall white Van Rysel socks with their black vertical wordmark, and vivid red clipless cycling shoes.
- Preserve the visible black vertical lettering/tattoo-like mark on Steve's forearm in the same position and orientation as the reference without inventing different lettering.
- The bicycle is specifically Steve's dark navy-charcoal **GIANT TCR PRO 0**, not a generic road bicycle. Preserve the exact TCR frame silhouette and proportions from the side reference, the authentic GIANT downtube wordmark and TCR model identity wherever visible, black drop bars, deep black road wheels, disc-brake geometry, black saddle, drivetrain, pedals and bottle positions. Never substitute another bicycle brand, invent a fake frame wordmark, or output an unbranded frame.

Consistency requirements:
The four panels must depict one identical rider, not four similar people. Preserve the same facial identity, body build, kit design, equipment, bicycle scale, camera height and neutral lighting. Entire helmet, hands, shoes and both wheels must stay inside every panel. Maintain plausible human anatomy, hand grip, leg position, chain path, crank, spokes, brakes and bicycle frame junctions.

Photography:
High-resolution honest studio catalog photography with soft neutral daylight, realistic pores, slight natural facial asymmetry, woven fabric, visible seams, accurate printed graphics, realistic helmet, lens, carbon, rubber and metal texture. No glamour retouching, plastic skin, illustration, CGI, wax figure or fashion-model substitution.

Exclude:
No scenery, roads, crowd, cones, cars, other cyclists, energy gel, captions, labels, UI, watermark, extra limbs, extra fingers, extra wheels, melted crank, warped frame or random replacement text. Do not erase or replace the actual "From zero to HERO", Santini, NEUTEC/bull sleeve artwork, 2969, ZIV, Van Rysel, GIANT or TCR identity details requested above.
```

## 影片模型餵圖順序

1. 第一順位：`identity-source/04-rider-front.png`，確保車衣與裝備沒有被二次生成吃掉。
2. 第二順位：V3 身份模組，提供轉向與車體幾何；若生成版本與原始側面照的 GIANT TCR PRO 0 衝突，以原始側面照為準。
3. 第三順位：`identity-source/01-face-front.jpg`，只負責臉部校正。
4. 場景圖最後加入，並明確寫「場景只控制環境，不得重設人物、衣服、車或文字」。

> 影片模型最容易破壞衣服上的文字。若成片胸前文字不可讀、變字或消失，視為身份失敗，不接受以「大致黃色」取代。
