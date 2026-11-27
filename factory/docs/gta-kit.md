# GTA_KIT: what we took from gta-components, and why

Source: https://github.com/echris6/gta-components by Chris (everestchris), MIT licence (notice in
`docs/licences/gta-components-MIT.txt`), commit `81181fda` (21 Nov 2026). It holds 126 HyperFrames components: 76
long-form ones with 16:9 and 9:16 versions, and 50 that are Shorts only.

## Adopted (ported to Remotion, in Pulse's palette and fonts)

| Pulse overlay | From the kit                         | When it fires                                                                                             |
| ------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Place card    | 12 location card, 45 district pop-up | A line names a place on the game's map table (`src/assets/gamemaps/*.json`)                               |
| Cash readout  | 29 / 46 cash counter                 | A line gives a dollar figure, with a word next to it that says what the figure is (budget, earned, price) |
| Head-to-head  | 24 versus card                       | A line sets two known names against each other ("GTA 5 versus GTA 6")                                     |

The cash readout's layout (a label over the figure, with a gauge under it) also borrows from a free GTA VI HUD
After Effects project by @cole_editing on X. We used it as a reference only: we did not open or render the project,
and none of its assets are used.

## Left out, and why

- **Pulse already does these as well or better.**
  - Captions: 03, 04 and s04.
  - Counters and stat hits: s26 and 28 (Odometer, TextMask, LiquidFill, TypeWall).
  - Bars: s25. Tier lists and rankings: s23 and 36 (rank cards, Blender podium).
  - Maps and pins: 44, 56 and s44 (GameMap3D, PulseMaps).
  - Wanted stars: s08 and 50 (the HUD ticker on Day N Shorts).
  - Rumour and confirmed stamps: s40 (Shelf and Overlays pills).
  - Source tags: s13 and 69.
  - Headline, post and phone cards: s38, s39, s43, 42 and 54 (Pulse universe packs).
  - Timelines: s22, 46 and 71 (Lineage, LevelSelect, SplitFlap).
  - Comparison splits: 39, s05 and s21 (COMPARE_WIPE).
  - Podium: s27 (Blender).
  - Title stings and end cards: 08, 02 and s50 (bookends, EndCard).
- **They need a spot in the footage** that the planner can't know: circle callout, magnifier, arrow and freeze detail (13, 14, s14 to s17).
- **They belong to creator formats Pulse doesn't make**: facecam, avatar, meme, SFX words, like goals, sponsor cards, RP name tags and challenge meters.
- **They are tied to the GTA HUD or its trade dress:**
  - The mission passed and wasted stings (s09 and s10), and the weapon or radio wheel (47). No fact in a news line calls for them.
  - The release countdown (s07): the game came out on 19 Nov 2026.

## Why a port and not pre-rendered clips

- In the kit, text and numbers live in a `CONFIG` object inside each component's script. Only `bg` and `variant` are real variables. So filling an overlay from the facts would mean rewriting each component's HTML for every video.
- The kit loads GSAP and Three.js from a CDN at render time.
- Pre-rendering would mean a second renderer, with its own Chromium, running on the Mac mini.
- Transparent clips (ProRes 4444 or VP9 alpha) are big and slow to decode. That costs disk on the Mac mini.
- The port draws inside the render Pulse already does: no new process, cache or network call.
