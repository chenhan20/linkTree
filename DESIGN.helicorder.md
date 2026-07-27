<!-- Governs `strava_helicorder.html` ONLY — one of four independent visual worlds in this repo.
     The root DESIGN.md governs `strava.html` (深空觀測站) and is not superseded by this file.
     Sibling worlds: `strava_pitwall.html` (維修站牆), `strava_opus5_max.html` (TELEMETRY // OPUS MAX).
     Every value below was extracted from the shipped file, not from the direction contract. -->
---
name: 記震紙 The Helicorder
description: 一年的訓練畫成一卷不間斷的記震紙 — a seismic-station chart-paper reading of one athlete's continuous record.
colors:
  paper: "#DCE2D5"
  paper-lo: "#D3DACB"
  paper-hi: "#E7EBE2"
  rule: "#9EA997"
  rule-soft: "#B4BEAC"
  grid-1: "rgba(150,62,40,.11)"
  grid-2: "rgba(150,62,40,.24)"
  ink: "#14171A"
  ink-2: "#43494C"
  ink-3: "#585E62"
  sig-max: "#9C2F1C"
  sig-recent: "#1B3F7A"
  sig-ok: "#2F5218"
  sig-none: "#585E58"
  cyc-1: "#14171A"
  cyc-2: "#9C2F1C"
  cyc-3: "#1B3F7A"
  cyc-4: "#2F5218"
  hatch: "rgba(20,23,26,.16)"
  selection: "rgba(27,63,122,.16)"
  neg-paper: "#191C18"
  neg-paper-lo: "#20241E"
  neg-paper-hi: "#111310"
  neg-rule: "#4E564A"
  neg-rule-soft: "#3B4238"
  neg-grid-1: "rgba(228,150,128,.09)"
  neg-grid-2: "rgba(228,150,128,.19)"
  neg-ink: "#E9EEE3"
  neg-ink-2: "#BAC2B4"
  neg-ink-3: "#8E968A"
  neg-sig-max: "#E9886C"
  neg-sig-recent: "#84ADE4"
  neg-sig-ok: "#A2CE74"
  neg-sig-none: "#868E82"
  neg-hatch: "rgba(233,238,227,.16)"
  neg-selection: "rgba(132,173,228,.14)"
typography:
  display:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, Liberation Mono, Noto Sans Mono CJK TC, PingFang TC, Microsoft JhengHei, monospace"
    fontSize: "clamp(28px, 5.6vw, 52px)"
    fontWeight: 700
    lineHeight: 0.96
    letterSpacing: "-0.035em"
    fontFeature: "tnum 1, zero 1"
  headline:
    fontSize: "19px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.01em"
  title:
    fontSize: "17px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  subtitle:
    fontSize: "15px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  body:
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "0.005em"
  note:
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.65
    letterSpacing: "normal"
  label:
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0.03em"
  caption:
    fontSize: "10.5px"
    fontWeight: 400
    lineHeight: 1.7
    letterSpacing: "0.06em"
  micro:
    fontSize: "9.5px"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "0.13em"
  index:
    fontSize: "9px"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "0.12em"
rounded:
  none: "0"
spacing:
  hair: "2px"
  xs: "7px"
  sm: "9px"
  cell-y: "11px"
  md: "13px"
  cell-x: "14px"
  gutter: "18px"
  lg: "22px"
  section: "34px"
  colophon: "52px"
components:
  nav-link:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "0 12px"
    height: "44px"
  nav-link-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper-hi}"
  nav-link-hover:
    backgroundColor: "{colors.paper-lo}"
    textColor: "{colors.ink}"
  instrument-button:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "6px 14px"
    height: "44px"
  instrument-button-pressed:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper-hi}"
  film-button:
    backgroundColor: "transparent"
    textColor: "{colors.ink-3}"
    typography: "{typography.caption}"
    rounded: "{rounded.none}"
    padding: "0 10px"
    height: "44px"
    width: "46px"
  film-button-pressed:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper-hi}"
  pin-button:
    backgroundColor: "{colors.paper-hi}"
    textColor: "{colors.ink-3}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "7px 13px"
    height: "44px"
  pin-button-pressed:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper-hi}"
  plot-frame:
    backgroundColor: "{colors.paper-lo}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "0"
  legend-cell:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink-2}"
    typography: "{typography.caption}"
    rounded: "{rounded.none}"
    padding: "9px 13px"
  catalog-cell:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "8px 11px"
  expand-button:
    backgroundColor: "{colors.paper-hi}"
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "0"
    height: "48px"
    width: "100%"
---

# Design System: 記震紙 The Helicorder

**Scope: `strava_helicorder.html` only.** This file is a sibling of, not a replacement for, the root `DESIGN.md`, which documents `strava.html` (深空觀測站) and remains accurate for that artifact. This repo runs four independent visual worlds off one data pipeline (`data/*.json`); nothing below applies to the other three.

## Overview

**Creative North Star: "The Seismic Station's Chart Paper"**

This is a printed instrument record, not a dashboard. One body's year of training is drawn as a single continuous roll — sixteen rows of chart paper, one month per row, the pen travelling left to right across the days — instead of a grid of cards. Everything that would announce "software" has been removed: there is not one rounded corner, not one shadow, not one gradient fill, not one glow, and not one backdrop-filter anywhere in the 1,611-line file. Depth is 1px printed rules and white space, exactly as it would be on paper.

The world is a pale blue-grey chart stock (`#DCE2D5`) with rust-printed grid lines that sit *under* the ink, and near-black ink traces on top. The whole page is set in one monospace stack with `tabular-nums` and `"tnum"/"zero"` feature settings — mono is here because every number in this document is a measurement that has to align in a column, not because mono reads as technical. A second print exists: **negative film** (`#191C18` stock, ink and paper swapped), reached through a 正片／負片 toggle in the masthead that persists to `localStorage` and defaults from `prefers-color-scheme`. It is the same record on microfilm, not a second design.

The system's hardest rule is chromatic. Four inks cycle down the drum's rows and mean *nothing* — they exist so that adjacent traces stay separable, which is the real instrument's own convention, and the on-page legend says "列色**僅供分列**，不帶意義" out loud. A separate set of four semantic inks each owns exactly one meaning and never touches the drum. Density is the value here, not a cost: seven sections, a 9-column event catalog, and a summary that is a measurement register rather than a stat-card grid.

**Key Characteristics:**
- Zero radius, zero shadow, zero glow, zero gradient fill, zero backdrop-filter — verified across the whole file
- One monospace family for 100% of the page, `tabular-nums` everywhere including buttons
- Two ink families that never mix: a meaningless 4-colour row cycle and four single-meaning semantic inks
- Positive/negative film, not light/dark mode
- Every container edge is a 1px or 1.5px printed rule; blocks butt against each other with no gap
- Three distinct kinds of "no number", each rendered differently
- Exactly one authored motion moment, whose final state is the CSS default

## Colors

Pale blue-grey chart stock, rust-printed grid, near-black ink, and four deliberately restrained semantic inks — a palette that reads as pigment on paper rather than light on glass.

### Primary
- **Rust Print** (`{colors.sig-max}`): The record ink. Reserved for all-time bests — a PR mark on a segment sequence (filled square), the `BREAKTHROUGH` status word, a PR tag in the event catalog, the peak column in the response spectrum, the two bolded fragments of the station code in the masthead, and the error-state border. It is also the hue behind the two grid tokens at 11% and 24% alpha, where it functions as *pre-printed paper*, not as signal.
- **Prussian Blue** (`{colors.sig-recent}`): The 90-day-best ink. A diamond mark on a segment sequence, the 90-day-best register cell, and the page-wide focus ring (`2px solid`, offset `2px`, or inset `-2px` on scroll containers). Also the footer's cross-version links.
- **Olive** (`{colors.sig-ok}`): Target met. Filled units in the coverage bar, the "四項全達標" line, positive month-over-month change in the bulletin.
- **Station Grey** (`{colors.sig-none}`): No reading from the station. The gap glyph on the drum, `ND` cells in the catalog, `UNTOUCHED` status, the hollow no-power circle, and the dashed missing-data outline in the bulletin.

### Secondary — the row cycle
- **Cycle 1–4** (`{colors.cyc-1}` / `{colors.cyc-2}` / `{colors.cyc-3}` / `{colors.cyc-4}`): Applied to the drum's traces by `row index % 4`. These share hex values with ink and the three semantic inks, and that collision is intentional and safe *only* because the two families never appear in the same plot. They carry no meaning whatsoever.

### Neutral
- **Chart Stock** (`{colors.paper}`): Page ground.
- **Plot Bed** (`{colors.paper-lo}`): Every plotting surface, hover state, and inset table area — one step darker than the page so the drawing area reads as a recessed panel without a shadow.
- **Header Stock** (`{colors.paper-hi}`): The sticky masthead, control bars, table headers, and pin strips — one step lighter, marking the parts of the sheet that are apparatus rather than record.
- **Rule / Rule Soft** (`{colors.rule}` / `{colors.rule-soft}`): The two weights of printed division — structural rules and intra-block hairlines.
- **Ink / Ink-2 / Ink-3** (`{colors.ink}` / `{colors.ink-2}` / `{colors.ink-3}`): Primary text and heavy borders / secondary text and axis strokes / captions, units, and axis labels. Every sampled text role on paper measures ≥4.98:1.
- **Hatch** (`{colors.hatch}`): A 45° hatch fill used for days that do not exist in a month and for un-executed coverage units.

### Named Rules

**The Two Ink Families Rule.** The drum's four-colour row cycle carries no meaning and exists only to keep adjacent rows separable; the legend must say so on the page. The four semantic inks each own exactly one meaning. **Semantic ink never appears on the drum, and cycle colour never encodes a fact.** Where the drum needs to mark an event it uses shape: filled square = all-time best, diamond = 90-day best, hollow circle = missing power, filled circle = ordinary.

**The Rust Is A Record Rule.** Rust means "highest reading ever", nothing else. It was deliberately pulled back out of four places it had leaked into — the `DECLINING` status, negative month-over-month change, over-target bars, and a non-record TSS value — all of which now render in plain ink. Before adding rust to anything, ask whether the thing is literally an all-time maximum. If not, it is `{colors.ink}`.

**The Grid Is Under The Ink Rule.** Rust at 11%/24% alpha is pre-printed paper, not signal. Grid lines are drawn before the trace and are never allowed to reach the opacity where they compete with it.

**The Same Record, Two Prints Rule.** Negative film is the same document on microfilm: every token is redefined, nothing is restructured, and the toggle uses the world's vocabulary (正片／負片). Never introduce a colour that exists in only one print.

## Typography

**Display / Body / Label Font:** one monospace stack — `ui-monospace, SFMono-Regular, Menlo, Consolas, Liberation Mono, Noto Sans Mono CJK TC, PingFang TC, Microsoft JhengHei, monospace`. There is no second family and no webfont.

**Character:** An instrument log. Numbers are set with `font-variant-numeric: tabular-nums` and `font-feature-settings: "tnum" 1, "zero" 1` on `body` *and* re-declared on `button`, so a control's label never shifts width when it changes state. Small sizes carry wide tracking (0.06em–0.2em); large sizes tighten to −0.02em/−0.035em. Latin uppercase sub-captions sit under Chinese headings as a documented brand convention (PRODUCT.md), not as a decorative eyebrow.

### Hierarchy
- **Display** (700, `clamp(28px, 5.6vw, 52px)`, line-height 0.96, tracking −0.035em): the page title 記震紙 alone. One instance.
- **Headline** (700, 19px, 1.1, −0.01em): section titles, each carrying a 9.5px/0.2em Latin sub-caption beneath.
- **Title** (700, 17px, −0.02em): the measurement number in the summary register and the response-spectrum list.
- **Subtitle** (700, 15px, −0.02em): segment names and per-segment key values.
- **Body** (400, 13px, 1.55, 0.005em): the document default.
- **Note** (400, 11px, 1.65, max-width 64ch): the explanatory paragraph under each section head. This is where the page argues with itself, and it is capped at 64ch so it stays prose.
- **Label** (400, 11–11.5px): nav links, instrument buttons, pins, catalog cells.
- **Caption** (400, 10–10.5px, 0.06em): legend cells, drum meta, colophon, axis annotation.
- **Micro** (700, 9.5px, 0.11–0.13em): table column heads, section sub-captions.
- **Index** (700, 9px, 0.12em): the `01`–`07` section numbers and the secondary line inside two-line buttons.

### Named Rules

**The One Typeface Rule.** Monospace for the entire page, including headings and prose. Mono is here for measurement — column alignment of numbers — not as a technical costume. Do not introduce a second family for "readability"; if something is hard to read, change size or measure, not family.

**The Chart Type Is Type Rule.** Text inside an SVG must render at the same legible size as text outside it. Every plot keeps its `viewBox` width close to its rendered CSS width and sets a matching `min-width` on the scroll container (drum 1200/1180, spectrum 720/700, stack 1180/1160, segment plot 880/860, bulletin 1200/1180), so in-chart labels at font-size 11–12 land at roughly 10.7–11.7px. A scaled-down viewBox silently shrinks chart type below legibility — this was a real, fixed defect. Let the sheet scroll horizontally rather than shrink its type.

**The Margin Annotation Rule.** A section head is a three-column annotation band: title plus Latin sub-caption on the left, channel code and measurement range right-aligned on the right, a 1.5px rule beneath. It is not a tracked-uppercase eyebrow, and there is exactly one section-head pattern in the whole document.

## Layout

A single centred sheet, `max-width: 1180px`, gutter 18px (12px below 680px). Content is not a card grid; it is a stack of bordered blocks that butt directly against one another — the control bar, legend, and pin strip each set `border-top: 0` so the drum, its instruments, and its legend read as one continuous printed unit.

The masthead is sticky (`top: 0`, `z-index: 60`, `min-height: 52px`) and holds three zones separated by vertical rules: station identity, a horizontally scrollable 7-item section nav with its scrollbar hidden, and the film toggle. Below 680px the identity and film toggle share one row and the nav wraps to its own full-width row — a deliberate reclaim of ~70px of first viewport on an 812px-tall phone.

Rhythm is small and printed rather than airy: 2px between coverage units, 7–9px inside compact cells, 11px/14px as the standard table and cell padding pair, 18px between blocks, 22px on the drum lede, 34px above a section head, 52px before the colophon. There is no 8pt grid; the values are set to the density of a log sheet.

Grids are two-column and collapse at 900px: the response spectrum (1.55fr / 1fr plot-and-list), the segment body (plot / 300px side cells), and the coverage pair. The colophon is three columns collapsing to one. Wide artifacts — the drum sheet and the event catalog — scroll horizontally *inside their own containers*, each with `tabindex="0"`, a `role`/`aria-label`, and an inset focus ring, and the page itself has no horizontal overflow at 1280×860. Below 900px the drum shows a scroll hint bar stating the visible month range.

All interactive targets are at least 44px tall (46px on the masthead below 680px); the expand-catalog button is 48px. The skip link is a real 46px bar that appears on focus rather than a permanent 1px sliver.

## Elevation & Depth

**There are no shadows in this system.** No `box-shadow`, no `text-shadow`, no `filter`, no `backdrop-filter`, no `border-radius`, and no tonal-gradient fill anywhere in the file. Depth is conveyed by exactly three means: 1px/1.5px printed rules, a three-step paper ladder (`paper-hi` for apparatus, `paper` for the page, `paper-lo` for plot beds and hover), and white space.

Two elevation-adjacent devices exist and are both material, not luminous. First, a fixed full-viewport paper grain: a procedurally generated `feTurbulence` SVG at 45% opacity with `mix-blend-mode: multiply` on paper, dropping to 16% with `mix-blend-mode: screen` on negative film. Second, a single `repeating-linear-gradient` at 45°, used only as a hatch fill for un-executed coverage units; it is a printed hatch pattern, not a tonal gradient, and it is the only gradient function in the file.

State is expressed by ink inversion, never by lift: a pressed control becomes `background: {colors.ink}` with `{colors.paper-hi}` text; hover becomes `{colors.paper-lo}`. Transitions are 0.12s linear on background and colour only — nothing moves.

### Named Rules

**The 1px Rule Rule.** Hierarchy is drawn, not lit. A block boundary is `1px solid {colors.ink}`; an internal division is `1px solid {colors.rule-soft}`; a section head or table head underline is `1.5px solid {colors.ink}`. If a new element needs to feel separate, give it a rule or give it space. Never a shadow, never a radius, never a glow.

**The One Motion Rule.** The page has exactly one authored motion moment: on load the pen plots the drum row by row via `stroke-dashoffset`, staggered 0.055s per row over 1s with `cubic-bezier(.16, 1, .3, 1)`, plus a 0.5s fade for gap glyphs. Its **final state is the CSS default** (`.tr { stroke-dashoffset: 0 }`) and the animation is applied on top, so all content is visible even if the animation engine never runs. The whole block sits inside `@media (prefers-reduced-motion: no-preference)`. Any future animation must satisfy the same test: remove the animation and the page must still be complete.

## Shapes

Right angles only — `rounded.none` is the entire radius scale, and the file contains zero `border-radius` declarations. Form language is orthogonal and printed: rectangular blocks with 1px ink borders, tables with hairline row rules that thicken every tenth row, coverage bars built from 1px-outlined rectangular units 20px tall, and a masthead partitioned by vertical rules rather than by gaps.

Plot marks are a shape alphabet, and shape is load-bearing because it carries meaning independently of colour: **filled square** = all-time best, **diamond** = 90-day best, **hollow circle** = no power reading, **filled circle** = ordinary effort, **hollow square crossed by a diagonal** = the reading that should exist and doesn't. The drum's maximum deflection is `RH × 0.86` — deliberately more than half the 29px row height, so a big day bleeds across neighbouring baselines. That is what this paper does in life; it is a feature of the instrument, not an overflow bug.

## Components

### Instrument Controls (channel / gain)
The signature control. A single bordered bar butted to the bottom of the drum, divided into labelled groups by vertical rules; the gain group is pushed right with `margin-left: auto`.
- **Shape:** square, no radius; `border-right: 1px solid {colors.rule-soft}` between buttons, group boundaries in `{colors.rule}`.
- **Default:** transparent on `{colors.paper-hi}`, `{colors.ink-2}` text, two lines — Chinese name at 11px above a 9px/0.12em code line (`BHT · 小時`) in `{colors.ink-3}`.
- **Pressed:** `aria-pressed="true"` inverts to `{colors.ink}` ground with `{colors.paper-hi}` text; the sub-line goes `{colors.paper-lo}`. Hover on a pressed button stays inverted rather than lightening.
- **Size:** `min-height: 44px`, padding `6px 14px`.

### Navigation (masthead)
- Seven links, each `01`–`07` index in 9px bold `{colors.ink-3}` followed by the Chinese section name at 11px.
- Default `{colors.ink-2}`; hover `{colors.paper-lo}` ground; current section carries `aria-current="true"` and inverts to ink-on-paper, driven by an `IntersectionObserver` with `rootMargin: -56px 0px -72% 0px`.
- Horizontally scrollable with hidden scrollbar; wraps to its own row below 680px.

### Film Toggle
Two buttons labelled 正片 / 負片 in 10px/0.08em, 46px × 44px, using the same `aria-pressed` inversion as every other control. Writes `helicorder-film` to `localStorage`; with no stored value the pressed state is derived from `prefers-color-scheme` and the CSS falls through `html:not([data-film="pos"])`.

### Tables (summary register, event catalog)
- **Register:** a measurement log, not a stat-card grid — quantities across, periods down, so the reading is "this year's column against all-time's column". Column heads right-aligned at 9.5px/0.13em with the unit beneath; values at 17px bold, right-aligned, tabular.
- **Catalog:** `min-width: 760px` inside its own focusable scroll region, 11.5px, right-aligned numerics, `1.5px` head underline, hairline row rules that thicken to `{colors.rule}` every 10th row, and **the column head reprinted every 20 rows** — a printed-catalog convention used deliberately because `position: sticky` has no y-scroll container to stick to here.
- **Missing data:** `ND` in `{colors.sig-none}` at 10px/0.06em. Never a zero, never a blank.

### Legend
A bordered strip butted under the control bar, each cell an inline SVG specimen plus a 10.5px caption, divided by hairlines. The legend states the notation rules out loud — that row colour is for separation only, that the waveform is envelope plotting where height is data and oscillation is notation, that height is non-linear at the 0.55 power, and the live count of missing readings against in-scope events.

### The Drum (signature component)
Sixteen rows, one month each, days 1–31 left to right. Grid: hairlines every 5 days in `grid-1`, major rules at days 1/10/20/31 in `grid-2`. Each row has a 0.75px baseline, a month label right-aligned in the left margin (96px), an event count in the right margin (62px), and a hatched mask over days the month does not contain.

The trace is **envelope plotting, declared**: daily channel totals set packet height, the oscillation is notation. Each packet is synthesized from a decaying envelope and a carrier, then normalized as a unit so the largest day reaches exactly full deflection — no guessing where envelope and carrier multiply. Height is compressed at the 0.55 power so mid-range days stay visible on a 29px row. The bottom measurement band's full-scale label therefore solves for both gain and compression (`rel = (1/gain)^(1/0.55)`); at ×2 gain, full scale is 28% of peak, not 50%. Waveforms use a seeded PRNG keyed to year and month, so a refresh redraws the identical paper.

### Overlay Comparison Bar (pinned segments)
Six segment sequences normalized to their own PRs and stacked on one plot, distinguished by **pinning, not by hue** — an unpinned layer sits at 0.3 opacity, a ghosted layer at 0.13, the pinned layer goes to full ink at 2px stroke and gains its marks and name label. Six new hues would have made one line answer two questions at once; the semantic inks already own hue.

### Coverage Bar
A row of flex units, 20px tall, 2px apart, each `1px solid {colors.rule}`: filled units take `{colors.sig-ok}`, un-executed units take the 45° hatch. Same hatch as the drum's non-existent days, deliberately.

## Do's and Don'ts

### Do:
- **Do** keep the two ink families separate: cycle colour for row separation only, semantic ink for exactly one meaning each, and encode drum events by shape (square / diamond / hollow circle / filled circle).
- **Do** distinguish the three kinds of absent number. `applies() === false` means the quantity does not exist for that event type (a gym session has no kilometres) — not marked, not counted. `applies() === true` with a `null` value means it should have been measured and wasn't — marked with the hollow crossed-square glyph and counted. **A value of `0` is a reading**, and must render as a reading. Switching the drum to 訓練負荷 collapses exactly 24 of 133 rides into gap glyphs, matching PRODUCT.md; if that count moves, the classification has broken.
- **Do** state notation on the page. Envelope plotting, the meaninglessness of row colour, the non-linear height, and the full-scale value all appear in the legend or the section note rather than being hidden in the code.
- **Do** keep every plot's `viewBox` width within a few percent of its rendered CSS width, and set the container `min-width` to match, so in-chart type lands at 10.7–11.7px.
- **Do** invert ink and paper for state (`aria-pressed` / `aria-current`), and keep transitions to 0.12s linear on colour only.
- **Do** let maximum deflection exceed half the row height (`RH × 0.86`). Big events bleeding across neighbouring baselines is the instrument working.
- **Do** ship every plot with an accurate `aria-label` on its container and `aria-hidden="true"` on the SVG itself, and keep interactive targets ≥44px.
- **Do** make animation additive: the final state must be the CSS default, so the page is complete with the animation engine switched off.

### Don't:
- **Don't** introduce a `border-radius`, `box-shadow`, `text-shadow`, `filter`, `backdrop-filter`, glow, or tonal-gradient fill. The file currently contains none, and hierarchy is drawn with 1px rules and the three-step paper ladder instead.
- **Don't** spend rust on anything that is not an all-time maximum. It was removed from `DECLINING`, negative month-over-month, over-target bars, and non-record TSS values on purpose.
- **Don't** put semantic ink on the drum, or let a row-cycle colour imply a fact.
- **Don't** add a second typeface, a webfont, or a build step. One monospace stack, everything inline, static hosting.
- **Don't** shrink a chart to fit a narrow screen. Scroll the sheet inside its own focusable container and keep the type legible.
- **Don't** substitute `0`, an em dash, or a blank for a missing reading, and don't count an inapplicable quantity as missing.
- **Don't** add a second authored animation. The pen plotting the drum is the page's one motion moment.
- **Don't** treat negative film as a separate design. It is the same record on microfilm; every colour must exist in both prints.
- **Don't** use emoji, alert lamps, epicenter icons, magnitude warnings, or any other seismic decoration. The form is a measurement convention, not a costume.

---

## Recorded inconsistencies

Documented rather than smoothed, because they are in the shipped build:

1. **Prussian blue carries two meanings in the segment status line.** `{colors.sig-recent}` is defined as "90-day best", and it is used that way for the diamond mark and the 90-day register cell. But `segStatus()` also assigns it to `HEATING UP` (three consecutive improvements) and `PEAK` (score ≥ 0.99). Both are "recent form is strong" rather than literally "90-day best", so the one-ink-one-meaning rule is stretched here. It is also the page-wide focus-ring colour, which is a UI role outside the semantic scheme entirely.
2. **`--paper-edge`** (`#C4CCBA` / `#2C3129`) is declared in all three token blocks and consumed by nothing. It is not part of the working system and is excluded from the frontmatter above.
3. **`{colors.hatch}` is dual-purpose**, marking both "this day does not exist in this month" and "this scheduled observation was not performed". The build treats the visual equivalence as intentional (the section note says so), but the two are not the same fact.
4. **`--cyc-1..4` are hex-identical to `{colors.ink}` and the three signal inks.** This is only safe because the two families are never plotted together; it is a discipline held by convention, not by the token values.
