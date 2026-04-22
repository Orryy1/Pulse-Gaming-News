# Premium Render Layer v1 — Pulse Gaming

**Status:** Design doc. No code changes required by this document.
**Author:** 2026-04-22 — after the day's 09:00 and 14:00 publish windows both failed (media-persistence root cause, fixed separately in commit `771d656`).
**Audience:** Operator + future Remotion/render-layer implementer.

---

## TL;DR

Pulse Gaming's output currently looks like an automated slideshow because the render layer is a single 1900-line FFmpeg filter graph bolted onto whatever images `images_download.js` happened to scrape, with burned-in CRT scanlines, an Impact-font karaoke caption, and the same lower-third on every video. The scripts read like efficient news bullets rather than premium editorial.

The plan below lands a **hybrid Remotion + FFmpeg** renderer in three phases and a **"Ruthless Editor" second-pass** for scripts. Phase 1 is mostly FFmpeg quick-wins that don't need Remotion and ship in days. Phase 2 introduces Remotion for the typographic + motion layers. Phase 3 adds per-template scene engines.

---

## 1. Current problems — concrete evidence

### 1.1 Render-level "automated" tells

Source: `assemble.js` (1915 lines, single function doing everything), `overlays.js`, `subtitles.js`, `images_story.js`.

| #   | Visible tell                                                                                                     | Evidence                                                                                                                                                                                                                                     | Severity |
| --- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | **CRT scanline overlay at 0.15 opacity on every frame**                                                          | `overlays.js:26` — a 4px-period scanline PNG composited over every output via FFmpeg `overlay`. Dated 2016-era "cyberpunk YouTube" aesthetic; marks the video as algorithmic at a glance.                                                    | **High** |
| 2   | **Karaoke-caption in Impact 90 px with orange keyword highlight**                                                | `assemble.js:918-939`. This is the same caption style every TikTok spam farm used in 2022-2023. Viewers read it as AI content.                                                                                                               | **High** |
| 3   | **Ken-Burns zoompan fallback with comment cards sliding from left**                                              | `assemble.js:1666-1757`. Fires whenever multi-image assembly fails. Hard-coded 6 s display + 2 s gap. Visibly repetitive.                                                                                                                    | **High** |
| 4   | **Same lower-third / brand bar bottom-aligned at 1780-1920 px on every video**                                   | `assemble.js:1334-1346`. "PULSE GAMING" + tagline, fixed position, identical frame-by-frame.                                                                                                                                                 | Medium   |
| 5   | **Flair badge renders as a rounded pill with a pulsing white dot**                                               | `images_story.js:103-104` (card), same pattern in `assemble.js` badges. Pulse-dot animation screams "Instagram auto-template".                                                                                                               | Medium   |
| 6   | **Background music ducked to 8 % always, no sidechain**                                                          | `assemble.js:1396` `amix=inputs=2:duration=first`. No voice-activated ducking; music feels pasted under a VO rather than produced.                                                                                                           | Medium   |
| 7   | **No cuts on the beat / no story rhythm**                                                                        | `assemble.js` uses `xfade` (count: 4) between images with fixed durations derived from total script length / image count. No audio-driven pacing.                                                                                            | **High** |
| 8   | **Entity portraits are 360×480 rectangles with a 4 px orange border, top-right, 0.3 s fade-in / 0.5 s fade-out** | `assemble.js:1365-1382` + `entities.js`. Every portrait looks like the same sticker, drops at the same speed, disappears the same way.                                                                                                       | Medium   |
| 9   | **Subtitles always bottom-centred (margin 250 px)**                                                              | `assemble.js:926-939`. Never adapts to hero composition; obscures faces and game UI often.                                                                                                                                                   | Medium   |
| 10  | **Repeat imagery within a video**                                                                                | `images_download.js` fallbacks to the same Steam capsule twice when other sources don't pan out. Same image in slots 2 and 5.                                                                                                                | **High** |
| 11  | **Opening 0-1.2 s is always the composite thumbnail**                                                            | `images_story.js` template reused as the first slot. Every Short opens with the same "PULSE GAMING" card.                                                                                                                                    | **High** |
| 12  | **Colour palette doesn't carry the story**                                                                       | Brand orange `#FF6B1A` is baked into every overlay. A "CONFIRMED" story reads visually identical to a "RUMOUR" story — the classification colour only appears on a tiny flair pill.                                                          | Medium   |
| 13  | **No motion backgrounds / no depth**                                                                             | All still images, no parallax, no camera, no subtle loop motion behind stills.                                                                                                                                                               | Medium   |
| 14  | **No quote cards, no timeline cards, no platform logos inline**                                                  | Everything is "image + caption + brand bar". A premium gaming channel (e.g. IGN Shorts, GameSpot) uses quote cards for source citations, timeline cards for "when did this leak", platform badges when discussing Xbox vs PS5. We have none. | **High** |

### 1.2 Script-level "AI" tells

Source: `processor.js` (802 lines), `channels/pulse-gaming.js:133-211` (system prompt).

The current pipeline calls Haiku (`claude-haiku-4-5-20251001`) with a large system prompt that enforces:

- 160-180 words (63-75 s audio)
- Hook → Source → Details → Mid-roll pivot → What it means → CTA
- British English (via post-generation find/replace of 40+ pairs)
- Banned starters + banned stock phrases
- Classification tag ([LEAK] / [RUMOR] / [CONFIRMED] / [BREAKING])

A quality-scoring pass runs (Haiku again, `processor.js:358`) with hook strength weighted 40 %. Scripts scoring ≥7/10 go through a Sonnet editor polish (`processor.js:402`, `claude-sonnet-4-6`) that tightens prose. Scripts <7 get regenerated up to 3 times.

The visible tells:

| #   | Tell                                                               | Evidence                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | **Every script opens with a metric + hedge**                       | The prompt biases toward "specific number" + "timed fact" + "deleted evidence" hooks (`channels/pulse-gaming.js:158-166`). In output the first sentence is almost always "X did Y Z hours ago." Readable, but identical rhythm across stories. |
| S2  | **"What it means" pivot is formulaic**                             | The prompt explicitly names this beat. Most scripts hit it at word 110-120. Viewers who watch two videos in a row hear the same pivot location.                                                                                                |
| S3  | **Hedging via "reportedly" / "sources suggest" without hierarchy** | Rumour Watch content is covered in hedges; Confirmed Drop content still uses hedges because the system prompt doesn't scale the hedge language by classification.                                                                              |
| S4  | **No sentence-length rhythm control**                              | Sonnet editor "aims for 3-8 word punches + 15-25 word details" (`processor.js:410`) but only runs on ≥7/10 scripts and only when it thinks it improves. The majority of output is straight news-desk rhythm.                                   |
| S5  | **CTA is always the same shape**                                   | "Follow Pulse Gaming so you never miss a drop" or close variant. Acts as a signoff; acts as a tell.                                                                                                                                            |
| S6  | **Hooks exceed 12 words regularly**                                | The prompt says <20 words for hooks. 20 words is still too long for TikTok first-3-seconds retention.                                                                                                                                          |
| S7  | **Mid-script "wait but here's the twist" absent**                  | No mandated mid-point re-engagement beat. Listen-through at 25-30 s is where retention drops — no architectural defence against that.                                                                                                          |
| S8  | **Loop / closing line doesn't close the gap the hook opened**      | The hook often promises "and what actually leaked is worse than you think" but the closing line pivots to the CTA without answering.                                                                                                           |

---

## 2. Proposed visual system

Single cohesive design language. Every new asset in Phase 1-3 conforms to this.

### 2.1 Colour palette (replaces over-indexed orange)

| Role                     | Hex       | Usage                                                                               |
| ------------------------ | --------- | ----------------------------------------------------------------------------------- |
| **Background primary**   | `#0A0A0C` | Video "canvas", top/bottom letterbox pad                                            |
| **Background secondary** | `#14151A` | Cards, callouts                                                                     |
| **Brand accent**         | `#FF6B1A` | **Limited** — classification flair only, key moment highlights. Not on every frame. |
| **Alert / Breaking**     | `#FF2D2D` | LEAK / BREAKING classification only                                                 |
| **Confirmed**            | `#22C55E` | CONFIRMED / VERIFIED classification only                                            |
| **Neutral**              | `#F4F4F5` | Body text, captions                                                                 |
| **Muted**                | `#71717A` | Metadata (date, source attribution)                                                 |

Rule: **classification colour drives the story's accent**, not the brand orange. A RUMOUR video is orange; a CONFIRMED video is green; a LEAK/BREAKING video is red. Story-level colour = classification colour.

### 2.2 Typography

| Style    | Font             | Weight | Size (1080×1920) | Use                                      |
| -------- | ---------------- | ------ | ---------------- | ---------------------------------------- |
| Hero     | Space Grotesk    | 700    | 96-120 px        | Hook overlay                             |
| Caption  | Inter            | 600    | 56-64 px         | Body captions                            |
| Quote    | DM Serif Display | 400    | 64 px            | Quote cards                              |
| Metadata | JetBrains Mono   | 500    | 28 px            | Timestamps, source URLs, version numbers |
| Flair    | Inter            | 800    | 28 px all-caps   | Classification badge                     |

**Drop Impact entirely.** Impact is the 2022 AI-content fingerprint. Space Grotesk + Inter reads as premium editorial (The Verge, IGN Shorts, Polygon shorts). DM Serif Display for quote cards adds broadcast-doc gravitas.

### 2.3 Caption rules

- Position: bottom-centred by **default**, auto-lifts to upper-third when a face is detected in the lower half of the frame (Phase 2 — needs landmark detection or a per-image bbox hint from `images_download.js`).
- Animation: subtle word-fade, not karaoke jump. Each word fades in over 80 ms, no scale bounce, no colour flash.
- Line count: max 2 lines, each ≤6 words.
- Emphasis: keyword highlight is a **thin underline**, not a colour flip. Colour flips trigger "ad-read" association.
- No all-caps. Impact's all-caps style is the opposite of premium gaming media.

### 2.4 Lower thirds

Reserved for **one** thing: the speaker / source attribution when we quote them.

Shape: 40 px tall strip, 72 % opacity of `#14151A`, left-aligned text, 48 px left margin.
Content: `NAME · OUTLET · TIME` in Inter 28 px + JetBrains Mono 22 px for the time.
Duration: appears 200 ms after the quote starts, persists for quote + 800 ms fade-out.

No lower-third on every frame. No brand bar. The branding lives in the intro sting + closing card, not baked into every second.

### 2.5 Source cards

Full-screen cards for the **source** of a leak:

```
┌─────────────────────────────────────────────┐
│                                             │
│            [Reddit / Gematsu / IGN logo]    │
│                                             │
│            r/GamingLeaksAndRumours          │
│            Posted 4 hours ago               │
│            Flair: Verified                  │
│                                             │
│                                             │
│            "quote from the post or article" │
│                                             │
└─────────────────────────────────────────────┘
```

Held for 1.2-1.8 s during the "where this came from" beat of the script (word ~20-35). Establishes credibility visually — viewers can pause and screenshot, which is a native share behaviour on TikTok.

### 2.6 Rumour / Confirmed badges

Render as a **sticker** top-left of the hero, not a pulsing pill.

- LEAK / BREAKING: Red chip, `#FF2D2D`, no animation, just present.
- RUMOUR: Orange chip, `#FF6B1A`, with a tiny "?" glyph.
- CONFIRMED: Green chip, `#22C55E`, with a tiny "✓" glyph.

One chip. No pulse-dot. Persists for the first 8 seconds then fades out (viewer has registered the credibility).

### 2.7 Platform badges

When a script mentions Xbox / PlayStation / Steam / Switch / PC:

- Inline icon chip appears next to the keyword in the caption
- 48×48 px SVG (official brand logos stored in `branding/platforms/`)
- Slide-in from left, 120 ms

Signals clearly which platform the viewer should care about. Today the script says "Xbox Game Pass" but there's nothing visual to match.

### 2.8 Quote cards

For any direct quote in the script (e.g. "Microsoft said in the blog post…"):

```
┌─────────────────────────────────────────────┐
│  "                                          │
│   The quote itself in DM Serif Display,     │
│   64 px, with generous line-height.         │
│                                          "  │
│                                             │
│        — Phil Spencer, Xbox CEO             │
└─────────────────────────────────────────────┘
```

Opens as a 6-frame scale-up (0.95 → 1.0) plus 150 ms fade-in. Holds for quote length. Closes with 150 ms fade.

### 2.9 Timeline / date cards

When the script references "three weeks ago" or "last Tuesday":

A thin horizontal timeline (JetBrains Mono 24 px date labels, 2 px `#71717A` stroke) appears bottom-third for 1.2 s. Non-intrusive. Gives the story a chronology without extra narration.

### 2.10 Game / person / company overlays

Current `entities.js` already identifies these via Haiku and fetches Wikipedia portraits. Redesign the overlay:

- **Person**: circular 320 px crop (not 360×480 rectangle), appears bottom-right, with name in Inter 32 px below, 200 ms scale-from-0.9 with spring ease.
- **Game**: rectangular 480×270 keyart crop (Steam hero dimensions), with title in Inter 32 px + release year. Shown at mid-third (not edges).
- **Company**: logo on a rounded white plate 200×200 px (logos are rarely readable on the dark background raw), with name below.

Timing: overlay appears 300 ms before the word is spoken, persists 600 ms after. Current 300/500 ms timing is too short.

### 2.11 Intro / outro rules

**Drop the composite-thumbnail intro slot entirely.** Instead:

- First 0-800 ms: dark frame with a single-word hook flash in Space Grotesk 140 px (e.g. "LEAK."), brand accent colour.
- 800-1200 ms: cut to the hero image with a 400 ms ramp-in on the voiceover.

Outro: simple 1.2 s card with "PULSE GAMING" wordmark + follow CTA. Not a huge brand bar; just the logo and one line. Matches how ColdFusion, Moon, and other premium short-form channels close.

### 2.12 Transitions

Replace the default `xfade` cross-fade with a **curated set**:

| Transition                | When                                         |
| ------------------------- | -------------------------------------------- |
| Hard cut on beat          | Default — matches music grid                 |
| 120 ms whip pan           | When script pivots ("but here's the thing…") |
| 300 ms slide-up           | When introducing a new source/person         |
| 400 ms fade-through-black | Before quote cards                           |

No xfade (the FFmpeg default cross-dissolve). xfade is fine on corporate slideshows and nowhere else.

### 2.13 Motion background rules

For still hero images, add subtle parallax:

- 2 % scale drift over 4 s
- 1 % horizontal translate
- 0.5 px Gaussian blur on a duplicate layer behind the sharp one (fake depth)

Only for still images. Gameplay clips don't need it.

---

## 3. Rendering architecture — recommendation

### 3.1 Option comparison

| Option                                      | Build time         | Control     | Caption precision | Motion-design quality                           | Ongoing cost                                   |
| ------------------------------------------- | ------------------ | ----------- | ----------------- | ----------------------------------------------- | ---------------------------------------------- |
| **A. Keep FFmpeg-only**                     | 0                  | Limited     | Good (ASS)        | Poor                                            | Low                                            |
| **B. Full Remotion rewrite**                | 4-6 weeks          | Total       | Frame-perfect     | Excellent                                       | Node+headless Chromium                         |
| **C. Hybrid Remotion + FFmpeg**             | 2-3 weeks          | Scene-level | Frame-perfect     | Excellent (where it matters)                    | Node+headless Chromium (shorter Remotion runs) |
| **D. AI video model (Runway / Sora / Veo)** | 1-2 weeks plumbing | Near-zero   | Patchy            | Visually impressive but inconsistent, expensive | $0.05-$0.50 per second                         |

### 3.2 Recommendation: **Option C — Hybrid Remotion + FFmpeg**

**Why:**

1. **Remotion renders the typographic, motion-design, and template layers** (captions, quote cards, source cards, timeline cards, lower-thirds, transitions, overlays). These are the parts that currently look automated.
2. **FFmpeg still handles**: audio mixing (ElevenLabs VO + ducked music), the final encode, and still the "stitch gameplay clips together" step where Remotion's per-frame render cost would be prohibitive.
3. **Remotion outputs per-scene 1080×1920 MP4 components** → FFmpeg concat + audio mix + final encode. This caps Remotion's render time to ~20-40 s per video (only typographic scenes, not full duration).
4. **Declarative React JSX** makes the template specs below concrete — a designer can iterate on the look without touching FFmpeg filter graph syntax.
5. **Remotion on Railway**: runs in Node + headless Chromium. Already how everyone deploys it. Will need a Dockerfile update (install Chromium) and a bumped memory limit.

**Why not A (keep FFmpeg-only):** The filter-graph complexity in `assemble.js` is already the ceiling. Adding quote cards / timeline cards / face-aware caption positioning on top of the current approach is a net-loss in maintainability. We'd be building a template engine from scratch in FFmpeg syntax.

**Why not B (full Remotion):** Audio mixing in Remotion means loading ElevenLabs + music into the browser, mixing on CPU in a Chromium tab. FFmpeg does this 10× faster natively. Full Remotion also loses the FFmpeg ffprobe/blackdetect QA we just landed.

**Why not D (AI video model):** Cost at daily-cadence volume: three Shorts × 7 days × 60 s × $0.15/s ≈ **$189/month**. But the bigger issue is **consistency** — Runway or Sora generate visually impressive clips but the brand is not recognisable video-to-video. Pulse Gaming is building a recognisable channel; AI-generated video undermines that. Keep AI video in reserve for Phase 4 as a _texture layer_ only (e.g. generate 2 s ambient B-roll for filler, not the whole video).

### 3.3 Concrete hybrid architecture

```
┌────────────────────────────────────────────────────────────────┐
│  processor.js → scripts + classification                       │
│  audio.js → voiceover + word-level timestamps                 │
│  entities.js → entity timing windows                          │
│  images_download.js → hero/keyart/screenshot/logo paths       │
└────────────────────────────────────────────────────────────────┘
                         ↓
          ┌──────────────────────────────────┐
          │  NEW: renderer/scene-plan.js     │
          │  Decides which scenes to render  │
          │  (source card, quote card, etc)  │
          │  based on script + template id   │
          └──────────────────────────────────┘
                         ↓
        ┌──────────────────────┬─────────────────────┐
        ↓                      ↓                     ↓
┌────────────────┐   ┌────────────────┐   ┌────────────────┐
│  Remotion:     │   │  Remotion:     │   │  Remotion:     │
│  intro hook    │   │  source card   │   │  outro card    │
│  (1.2 s MP4)   │   │  (1.5 s MP4)   │   │  (1.2 s MP4)   │
└────────────────┘   └────────────────┘   └────────────────┘
                         ↓
┌────────────────────────────────────────────────────────────────┐
│  FFmpeg concat of Remotion scenes + story-body clip (from      │
│  images_download.js gameplay/stills) + voiceover + ducked      │
│  music + subtitle ASS. Final 1080×1920 MP4.                    │
└────────────────────────────────────────────────────────────────┘
```

### 3.4 Package changes

```json
"dependencies": {
  "@remotion/bundler": "^4.0.x",
  "@remotion/renderer": "^4.0.x",
  "remotion": "^4.0.x",
  "react": "^18",
  "react-dom": "^18"
}
```

Add a `remotion/` folder: `remotion/Root.tsx` + one composition per template (see Section 4).

Dockerfile: install Chromium (`apt-get install -y chromium-browser` or use `@remotion/renderer`'s bundled Chromium).

---

## 4. Template plan — 5 production templates

Every story maps to exactly one template based on `classification` + `content_pillar`.

### Template A — Breaking Leak (classification: LEAK / BREAKING)

**Scene sequence (60 s)**

| Time        | Scene                                                                            | Asset                                  | Caption                   |
| ----------- | -------------------------------------------------------------------------------- | -------------------------------------- | ------------------------- |
| 0.0 - 0.8 s | **Hook flash** (red accent, Space Grotesk 140 px, one word: "LEAKED.")           | —                                      | —                         |
| 0.8 - 4.5 s | **Hero image** with source sticker top-left, subtle 2 % parallax                 | Article og:image OR game keyart        | Word-faded hook line      |
| 4.5 - 6.5 s | **Source card** (see §2.5)                                                       | Subreddit / outlet logo + quoted flair | Source attribution        |
| 6.5 - 30 s  | **Body**: 3-4 image cuts, gameplay clip mid-way, entity overlay on first mention | `images_download.js` outputs           | Body captions             |
| 30 - 40 s   | **Quote card** if the source contains a direct quote                             | —                                      | Quote in DM Serif Display |
| 40 - 55 s   | **Stakes / "what this means"** with timeline card                                | —                                      | Body captions             |
| 55 - 60 s   | **Outro** (PULSE wordmark, follow CTA)                                           | —                                      | —                         |

**Required assets:** hero image (article og:image or keyart, mandatory), source logo (Reddit/Gematsu/IGN), quote (parsed from article OR Reddit body), 2-4 additional images, optionally 1 gameplay clip.

**Caption style:** bottom-centred, 2 lines, word-fade.

**Timing:** Hook flash is 800 ms — **must** fit under TikTok's 1.5 s "skip moment" threshold.

**QA requirements:** hero image ≥400×400, source card has a real logo (not generic placeholder), quote extracted is ≥10 words.

---

### Template B — Official Confirmation (classification: CONFIRMED / VERIFIED)

**Scene sequence (60 s)**

| Time      | Scene                                                                            |
| --------- | -------------------------------------------------------------------------------- |
| 0 - 0.8 s | Hook flash "CONFIRMED." green accent                                             |
| 0.8 - 5 s | Hero image (official keyart preferred) with platform badges (PS5/Xbox/PC/Switch) |
| 5 - 7 s   | Source card — official blog / publisher announcement                             |
| 7 - 30 s  | Body with game/company overlays                                                  |
| 30 - 40 s | Timeline card (release date callout)                                             |
| 40 - 55 s | "What's included" beats — 3-4 hard cuts, platform badges inline                  |
| 55 - 60 s | Outro                                                                            |

**Required assets:** official keyart (fail if not available — falls back to Template A), platform logos, release date, company logo.

**QA requirements:** keyart must be ≥1200×675 (it exists on Steam for virtually every PC-release game), release date must parse to a date.

---

### Template C — Trailer / Update (any classification, but `content_pillar = trailer_reaction`)

**Scene sequence (60 s)**

| Time       | Scene                                                          |
| ---------- | -------------------------------------------------------------- |
| 0 - 0.8 s  | Hook flash with one punchy word from the trailer ("SURPRISE.") |
| 0.8 - 15 s | **Trailer clip** (15 s cut, muted, subtitles over top)         |
| 15 - 25 s  | Hero screenshot + caption overlay "what we saw"                |
| 25 - 40 s  | 3-4 screenshot hard-cuts with entity/game overlays             |
| 40 - 55 s  | "Release window" timeline card + stakes                        |
| 55 - 60 s  | Outro                                                          |

**Required assets:** trailer MP4 ≥15 s (IGDB / YouTube trailer DL), 3-4 Steam screenshots, release date.

**Caption style:** positioned top-third (trailer occupies bottom) for 0.8-15 s, flips to bottom thereafter.

**QA requirements:** trailer clip must be actual video (not a still with Ken-Burns), min 4 unique screenshots for body.

---

### Template D — Price / Business Controversy (classification: BREAKING, pillar: business)

**Scene sequence (60 s)**

| Time      | Scene                                                                               |
| --------- | ----------------------------------------------------------------------------------- |
| 0 - 0.8 s | Hook flash with the number (e.g. "$22.99.")                                         |
| 0.8 - 4 s | Hero: price-chart style graphic generated on the fly (old price → new price, arrow) |
| 4 - 8 s   | Source card — official blog post                                                    |
| 8 - 25 s  | Body: context, publisher/platform logo, historical context                          |
| 25 - 40 s | Timeline card ("last price change: Nov 2023")                                       |
| 40 - 55 s | What it means for the player (with platform badges)                                 |
| 55 - 60 s | Outro                                                                               |

**Required assets:** old price, new price (structured data from the story), company/platform logos, source link.

**Special:** This template needs a **Remotion price-diff graphic generator** — a reusable component that takes `{from: 16.99, to: 22.99, currency: "$", effective_date: "2026-04-20"}` and renders a premium chart.

**QA requirements:** both prices must parse, diff must compute, source must be an official channel.

---

### Template E — Rumour Roundup (classification: RUMOUR, pillar: multi-story)

**Scene sequence (60 s)**

| Time      | Scene                                                   |
| --------- | ------------------------------------------------------- |
| 0 - 0.8 s | Hook flash "RUMOURS." amber accent                      |
| 0.8 - 3 s | Hero composite (3-4 mini-cards stacked, one per rumour) |
| 3 - 18 s  | Rumour 1 — hero + source chip + 1-sentence summary      |
| 18 - 33 s | Rumour 2 — same beat                                    |
| 33 - 48 s | Rumour 3 — same beat                                    |
| 48 - 56 s | "Which one do you believe" beat — poll-style CTA card   |
| 56 - 60 s | Outro                                                   |

**Required assets:** 3-4 linked rumour stories (needs a weekly roundup aggregator in `hunter.js`), source chip for each, 1 image each.

**QA requirements:** min 3 linked rumours, each with a source.

**Note:** This is the one template that needs changes outside the renderer — the hunter/processor needs to cluster related rumours into a single roundup story.

---

## 5. Asset hierarchy (Task 5)

Strict priority. Use lower-tier only if higher-tier missing.

### 5.1 Video assets

1. **Official trailer / gameplay clip** — IGDB (gated on `TWITCH_CLIENT_ID`), Steam trailer (`fetch_broll.js`)
2. **Steam store video** — `images_download.js` Steam video endpoint
3. **yt-dlp'd trailer** (only if `BROLL_YOUTUBE_FALLBACK=true`, known copyright-strike risk per CLAUDE.md)

### 5.2 Still assets

1. **Official keyart / hero** — Steam API hero, capsule, library assets
2. **Steam screenshots** — 4-6 per game, picked by hash-dedup
3. **Article hero (og:image)** — news source meta tag
4. **Article inline images** — scraped `<img>` tags from article, filtered to ≥400×400
5. **Wikipedia headshot** (people only) — `entities.js`
6. **Company logo** — SVG from Wikipedia
7. **Reddit thumbnail** — last-resort, low priority (Reddit thumbnails are often a 140 px crop)
8. **Pexels / Unsplash stock** — **last resort**, never primary

### 5.3 Generated assets

1. **Source cards** (Remotion) — always generated
2. **Quote cards** (Remotion) — generated when a real quote exists
3. **Timeline cards** (Remotion) — generated when 2+ dates parse
4. **Price-diff graphics** (Remotion, Template D only) — generated when old + new price parse

### 5.4 Stock fallback rules

- Stock is **only** acceptable for Template E (Rumour Roundup) "we have no visuals for this unconfirmed rumour" beats.
- Never for Template A (Breaking Leak) — if there's no real image, we kill the story. A leak video with stock gaming photos screams "AI farm".
- Never for Template B (Official Confirmation) — official content has official assets by definition.
- Never for Template C (Trailer) — trailer is the whole point; no trailer → fall back to Template A or kill.
- Maybe for Template D (Business) — a price-diff graphic is the visual; no stock needed. If we do use a stock photo of a console, it must be on the stock allowlist (`images_download.js` Pexels/Unsplash "portrait" filter already in place).

### 5.5 Asset QA hooks

Extend `content-qa.js` with a soft warning (NOT a block) when:

- `stock_image_used` — any Pexels/Unsplash image appears in `downloaded_images`
- `only_one_hero` — `downloaded_images.filter(i => !i.type.startsWith('logo')).length < 3`
- `no_video_clip` — Templates C + A prefer one; Template D doesn't need one

Hard block (new):

- `repeated_image_cluster` — hash-dedup on `downloaded_images[].path`; ≥2 identical hashes → fail. Today's `images_download.js` already caps Steam at 2 when other sources exist, but doesn't hash-check.

---

## 6. QA plan — visual QA checks

Current `video-qa.js` covers:

- Duration bounds (40-75 s)
- Black segments (>2 s anywhere, >1.2 s opening)
- Missing file

### 6.1 New visual QA checks

| #   | Check                                    | Hard-fail / Warn | How                                                                                                                                                                                                                                                            |
| --- | ---------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1  | **No long black frames mid-video**       | Hard-fail (≥2 s) | Already have blackdetect; just ensure it scans the full video, not first 15 s                                                                                                                                                                                  |
| V2  | **No repeated image clusters**           | Hard-fail        | Perceptual hash (pHash via Sharp) each unique still shown; two stills with pHash Hamming distance ≤4 within the same video = fail                                                                                                                              |
| V3  | **Source/person/game visual match**      | Warn             | If script mentions "Cyberpunk 2077" and no image in `downloaded_images` has type=steam_hero + name match → warn                                                                                                                                                |
| V4  | **Caption collision**                    | Warn             | Render a subtitle preview at 3 representative timestamps; run a cheap face/text detector against the lower third; if caption overlaps a face bounding box → warn                                                                                               |
| V5  | **Minimum moving-media ratio**           | Warn             | At least 15 s of the 60 s output must be video clip (not still). Warn if below. Encourages template C-style renders.                                                                                                                                           |
| V6  | **No fake gameplay**                     | Hard-fail        | Trailer / gameplay clip metadata must trace back to an official source URL (Steam, IGDB, publisher). If the clip is from a YouTube fan channel, block (we already gate yt-dlp behind `BROLL_YOUTUBE_FALLBACK`, but a clip that slips through must be flagged). |
| V7  | **No misleading AI images**              | Hard-fail        | If any `downloaded_images[].source` is `generated_ai` (future), must be tagged visibly ("AI CONCEPT" chip).                                                                                                                                                    |
| V8  | **Story card has meaningful hero image** | Hard-fail        | Already implemented implicitly via `images_story.js` fallback logic, but promote "hero is company_logo only" from warn to fail for Templates A/B/C. Rumour Roundup can keep it as warn.                                                                        |

### 6.2 New content-QA checks (script side)

| #   | Check                                    | Hard-fail / Warn                                                                          |
| --- | ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| S1  | **Hook word count**                      | Hard-fail if ≥13 words                                                                    |
| S2  | **Mid-point re-engagement line present** | Warn if missing                                                                           |
| S3  | **Loop line closes the hook**            | Warn if closing line is the CTA and does not reference the hook's promise                 |
| S4  | **No banned AI tells**                   | Hard-fail — add to existing `BANNED_STOCK_PHRASES` (see §7.2)                             |
| S5  | **Classification-appropriate hedging**   | Warn — RUMOUR must have ≥1 "reportedly" / "sources suggest"; CONFIRMED must have ≤1 hedge |

---

## 7. Script Quality — Ruthless Editor Pass

### 7.1 Where it sits in the pipeline

Currently:

```
processor.js: generate (Haiku) → score (Haiku) → if ≥7 → edit (Sonnet) → validate → save
```

New:

```
processor.js: generate (Haiku) → score (Haiku) → if ≥7 → edit (Sonnet) →
  ⇒ NEW: Ruthless Editor (Sonnet, stricter prompt) ⇒
  validate → save
```

The Ruthless Editor runs **after** the existing Sonnet polish, **before** the final validation. It runs on every approved script (no gating on score), because the goal isn't "rescue bad scripts" — it's "take 8/10 scripts and make them 9.5/10 production-ready."

It does **not** run before scoring. Scoring decides whether the _idea_ is good; editing decides whether the _execution_ is good.

### 7.2 Banned-phrase list (additive to existing)

New entries to add to `processor.js` validation + `content-qa.js` banned list:

```js
const BANNED_AI_TELLS = [
  /let('?|')s dive in/i,
  /without further ado/i,
  /buckle up/i,
  /you won('?|')t believe/i,
  /this changes everything/i,
  /mind[- ]?blown/i,
  /the internet is losing it/i,
  /here'?s (?:where|why|what) (?:it gets|it goes|the)/i,
  /ladies and gentlemen/i,
  /game[- ]?changer/i,
  /paradigm shift/i,
  /at the end of the day/i,
  /it'?s worth noting/i,
];
```

Plus the existing list in `content-qa.js` already covers "let me know in the comments" / "smash that like button" / "hey guys welcome back".

### 7.3 Exact Ruthless Editor prompt structure

```
SYSTEM:
You are the senior editor on Pulse Gaming, a premium gaming-news Shorts channel
that competes with IGN, Polygon and Kotaku for attention. Your job is to take a
draft script and produce the final broadcast version.

Hard rules (non-negotiable):
1. The HOOK must be ≤ 12 words. Every word earns its place.
2. Remove every filler phrase and generic AI tell. Banned phrases (non-exhaustive):
   "let's dive in", "without further ado", "buckle up", "you won't believe",
   "this changes everything", "mind-blown", "the internet is losing it",
   "here's where it gets interesting", "at the end of the day", "it's worth
   noting", "game-changer". Replace with a specific fact.
3. Enforce ONE clear story angle. The script must have a single spine. If the
   draft wanders, cut the side-quest.
4. Insert exactly ONE midpoint re-engagement line between words 55-85. It must
   be a promise (e.g. "and the part nobody's talking about is ___") that the
   next beat answers.
5. The final line MUST either (a) loop back to the hook, closing the gap it
   opened, or (b) land with a concrete stake. Never end on a generic CTA.
6. British English throughout. No em dashes — use commas or full stops.
7. Facts are sacred. If the draft asserts something not supported by the
   source material provided, replace with a hedge or remove. Never invent.
8. Hedge language must match classification:
   - CONFIRMED: ≤ 1 hedge word ("reportedly", "seemingly", "apparently")
   - RUMOUR: ≥ 1 hedge word on every load-bearing claim
   - LEAK: hedge the unverified details, state verified ones plainly
9. Keep target audio 60-75 s. Word count 150-180. Do not exceed 180.
10. Output the revised script in the exact JSON schema below. Nothing else.

Writing rhythm:
- Alternate short punch sentences (3-8 words) with detail sentences (15-25 words).
- No 3 consecutive sentences of the same length.
- One specific number or proper noun per sentence where possible.

USER:
Classification: {LEAK|RUMOUR|CONFIRMED|BREAKING}
Content pillar: {confirmed_drop|source_breakdown|rumour_watch|business|trailer_reaction|multi_story}
Source material (verified facts only):
{source_excerpt_from_processor_js_fact_check}

Draft script (post-Sonnet polish):
{
  "hook": "...",
  "body": "...",
  "cta": "...",
  "full_script": "..."
}

Return the final broadcast version in this schema:
{
  "hook": "<= 12 words, closes the loop in the final line",
  "body": "150-180 words total with full_script, contains one re-engagement beat at 55-85",
  "loop": "1-2 sentences, closes the hook's loop OR lands a concrete stake — NOT a CTA",
  "full_script": "hook + body + loop, exact words the TTS will speak",
  "word_count": <integer>,
  "changes_summary": ["short bullet per meaningful change"]
}
```

### 7.4 Input fields required

From the existing story object (`processor.js` builds this):

- `classification` (LEAK / RUMOUR / CONFIRMED / BREAKING)
- `content_pillar` (confirmed_drop / source_breakdown / rumour_watch / etc.)
- `source_excerpt` — the fact-check'd source text (already gathered in `processor.js:101-209`)
- `hook`, `body`, `cta`, `full_script` from the prior Sonnet pass

### 7.5 Output schema (matches existing story shape)

```json
{
  "hook": "string",
  "body": "string",
  "loop": "string",
  "full_script": "string",
  "word_count": 0,
  "changes_summary": ["string"]
}
```

Note that we rename the existing `cta` slot to `loop` — it's no longer a CTA, it's the looping/landing line. The existing `cta` field becomes the channel-wide outro overlay text (baked into the outro card, not into the script TTS).

### 7.6 Retry rules

- Max 2 attempts of the Ruthless Editor
- Attempt 2: Add "Your previous attempt had {specific issue}. Fix it without changing other parts."
- On second failure: **fall back to the post-Sonnet draft** (don't block publish — the prior step already produced a valid script)
- Track in story metadata: `ruthless_editor_attempts`, `ruthless_editor_result` ("applied" / "fallback" / "skipped"). Surface in `/api/analytics/digest` so we can measure how often the Ruthless Editor helps.

### 7.7 Tests / QA checks for the Ruthless Editor

1. Hook word count ≤12 (unit + integration)
2. No banned AI tells in output (regex check)
3. Loop line references hook's noun (simple overlap check via `lib/entities.js` extraction)
4. Classification → hedge count monotonic (CONFIRMED ≤1, RUMOUR ≥1)
5. British English — reuse existing `processor.js:329-349` sanitizer as post-check
6. Word count 150-180 (hard fail outside)
7. Re-engagement line detected at word 55-85 (heuristic: find a sentence that starts with "but", "and", "although", "wait", or contains "part nobody's")
8. Final line is NOT a CTA (no "follow", "subscribe", "hit that", "drop a", "link in bio")
9. Factual accuracy regression — "hedge when the source doesn't support a specific claim" — hardest to test; start with a unit test that checks hedge language matches classification
10. Latency budget — Ruthless Editor call must complete within 15 s or timeout; fallback kicks in

### 7.8 Before or after scoring?

**After.** Scoring decides whether the idea is worth producing. Editing decides whether the execution reads as premium. Running Ruthless Editor before scoring would mean editing scripts we're about to reject — waste of tokens. Running it after editing but before validation + save is the right seam.

---

## 8. Phased implementation plan

### Phase 0 — Immediate FFmpeg Wins (no Remotion yet)

Do not implement in this planning doc. Listed here per brief requirement. Each is a small, independent PR.

| #   | Win                                                                                                                           | Files touched                          | Risk                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ---------------------------------------- |
| W1  | **Remove CRT scanline overlay** entirely                                                                                      | `assemble.js`, `overlays.js`           | Very low                                 |
| W2  | **Replace Impact 90 px caption with Inter 64 px bottom-safe**                                                                 | `assemble.js` ASS styles               | Low                                      |
| W3  | **Classification-coloured accent** (orange for rumour, red for leak, green for confirmed) replacing the always-orange overlay | `assemble.js`, `brand.js`              | Low                                      |
| W4  | **Drop the default composite-thumbnail as intro slot** (start on hero image directly)                                         | `assemble.js`                          | Low                                      |
| W5  | **Sidechain compress music under voice** via FFmpeg `sidechaincompress` filter                                                | `assemble.js`                          | Medium — needs testing on real VO levels |
| W6  | **Hash-dedup `downloaded_images` so the same image can't appear twice**                                                       | `images_download.js` + new QA check V2 | Low                                      |
| W7  | **Drop pulsing flair dot** in `images_story.js` — static chip only                                                            | `images_story.js`                      | Very low                                 |
| W8  | **Reduce brand bar to outro only** (remove persistent bottom overlay)                                                         | `assemble.js`                          | Low                                      |
| W9  | **Hook flash overlay** — add a 0-800 ms hook-word overlay before hero image                                                   | `assemble.js`                          | Low                                      |
| W10 | **Outro card** — simple 1.2 s wordmark + follow CTA, no full-frame brand panel                                                | `assemble.js`, `branding/`             | Low                                      |

These ten wins alone close ~60 % of the visible gap between current output and premium. They're the recommended day-1 work regardless of whether Phase 2 ships.

### Phase 1 — Ruthless Editor + QA hardening (2-3 days)

1. Implement the Ruthless Editor step in `processor.js` per §7
2. Add the new script-side content QA checks per §6.2
3. Add hash-dedup V2 in `video-qa.js` per §6.1
4. Add the banned-AI-tells list per §7.2
5. Tests: `tests/services/ruthless-editor.test.js` covering §7.7

### Phase 2 — Remotion scene engine (2-3 weeks)

1. Scaffold `remotion/` — one composition per template (A, B, C, D, E)
2. Build the shared component library:
   - `<HookFlash />`
   - `<HeroStill />` with parallax
   - `<SourceCard />`
   - `<QuoteCard />`
   - `<TimelineCard />`
   - `<FlairChip />`
   - `<PlatformBadge />`
   - `<EntityOverlay />` (person, game, company variants)
   - `<Outro />`
   - `<Caption />` (word-fade, position-aware)
3. Build the scene-plan layer (`renderer/scene-plan.js`) that maps `(classification, content_pillar)` → template
4. Wire Remotion render as a child step in `assemble.js` — generate per-scene MP4s, FFmpeg concat them with the body (gameplay/stills) and audio
5. Deploy: Dockerfile update (Chromium), Railway memory bump, smoke-test one story end-to-end

### Phase 3 — Per-template intelligence (1-2 weeks)

1. Template D price-diff graphics generator
2. Template E rumour clustering in `hunter.js`
3. Caption position-awareness (face bbox detection per still, drives top-third vs bottom-third)
4. Sidechain ducking refinement
5. Per-platform caption variants (TikTok narrower safe zone than YouTube Shorts)

### Phase 4 — AI video texture layer (speculative, 1-2 weeks, only if retention data justifies it)

Use Runway / Veo for 1-2 s ambient B-roll filler scenes _only_ when no real clip is available for Template E. Budget-gated. Requires a new hard-fail QA rule: "AI-generated clips must carry a visible 'AI ILLUSTRATION' chip at top-right."

---

## 9. Highest-impact first coding tasks

Ranked by impact per implementation day:

1. **W1 + W2 + W3** (drop scanlines, replace Impact with Inter, classification-coloured accent) — 1 day, ~70 % of the "premium vs automated" visual shift
2. **Phase 1 Ruthless Editor** — 2 days, closes the script-quality gap
3. **W6 hash-dedup + V2 QA** — half-day, eliminates the "same image twice" glare
4. **W9 hook flash + W10 outro card** — 1 day, replaces the brand-bar-on-every-frame tell
5. **Phase 2 Remotion scaffold with just Template A** — 5 days, unlocks the rest of the templates
6. **Phase 1 script-side content QA (hook ≤12, banned tells, hedge-by-classification)** — 1 day
7. **Remaining Phase 2 templates (B, C, D, E)** — 2-3 days each once scaffold exists
8. **Phase 3 price-diff graphic, caption face-awareness, rumour clustering** — 2 weeks cumulative

Total Phase 0 + Phase 1: **~6-7 days for a substantial quality leap**, no Remotion required.
Total Phase 2: **~3 weeks for the full premium renderer**.
Total Phase 3: **~2 weeks for polish**.

---

## 10. Success criteria

A premium-tier Pulse Gaming Short (post-Phase-2):

- Could plausibly be mistaken for an IGN Shorts / Polygon / GameSpot editorial Short at a glance
- Opens with a hook flash + hook word spoken in the first 800 ms
- Uses a real source card with a real outlet logo, never a generic placeholder
- Classification colour drives the accent (red/orange/green), not everything-is-orange
- Has at least one moving-video segment in the middle 45 seconds
- Entity portraits land 300 ms before the name is spoken, not after
- Ends with a single-line outro, not a brand panel
- Passes all V1-V8 visual QA + S1-S5 content QA checks
- Renders in ≤90 s per video (Remotion scenes + FFmpeg concat)

And a premium-tier script:

- Hook ≤12 words, closes the loop in the final line
- Zero banned AI tells
- Exactly one mid-point re-engagement line
- Classification-appropriate hedging
- Final line is never "follow Pulse Gaming"

---

## Appendix — Current state inventory (for reference when implementing)

- **Current FFmpeg render timeout:** 600 s (`assemble.js:1607`)
- **Current Anthropic models in the script pipeline:** Haiku for generation + scoring; Sonnet for polish (`processor.js:402`, `claude-sonnet-4-6`)
- **Current voice:** ElevenLabs Liam (`TX3LPaxmHKxFdv7VOQHJ`), `eleven_multilingual_v2`, stability 0.2 / similarity 0.8 / style 0.75 / rate 1.1×
- **Current caption renderer:** ASS subtitles via FFmpeg `subtitles` filter — Impact 90 px, white with orange keyword highlight
- **Current entity overlay cap:** 5 per video, hidden first 1.2 s (`entities.js`)
- **Current music volume:** 8 % vs 100 % voice (`assemble.js:1396`)
- **Current fonts referenced in code:** Impact, Inter, Arial, DejaVu Sans, Helvetica, monospace
- **Remotion is not a dependency today** — adding it is a clean first-install
- **Dockerfile change required for Phase 2:** install Chromium, bump memory limit
