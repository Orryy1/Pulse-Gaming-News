# Studio Short Engine — local plan

Branch: `quality-redesign` (continued)
Status: **plan-only.** No code in this commit. Stop point per user instruction.
Constraints: local-only, no production touches, no merge to main, no Railway, no env-var changes, no TikTok touches, PRL frozen — do not polish further.

## TL;DR

Repetition is not a renderer problem. Repetition is a **content-acquisition** problem.

Audit of the three sample stories shows that the local-fixture image sets are dominated by **stock filler**, not topical imagery, and **none** of them have video clips. Adding more sophisticated overlays / motion / crops can't fix that — at best it polishes a thin source set into a slightly less obvious slideshow. The user's instinct is right: we need to fix what feeds the renderer before we redesign the renderer further.

The plan below is staged so each phase delivers visible quality on its own AND makes the next phase cheaper. Phase 1 alone (acquisition + anti-repetition gate) closes most of the gap. Phase 2 (clip-first) closes most of the rest. Phase 3 (scene-type system) is where it starts feeling like a creator studio rather than a slideshow with overlays.

---

## Audit findings — concrete numbers

### Per-story source counts (this branch's local fixtures)

| Story                            | Total | Article | Article-inline | Steam | Pexels | Bing | Video clips |
| -------------------------------- | ----- | ------- | -------------- | ----- | ------ | ---- | ----------- |
| `1smsr12` (Witcher 3 director)   | 8     | 1       | 3              | **0** | **4**  | 0    | **0**       |
| `1sn9xhe` (Metro 2039 trailer)   | 7     | 1       | 0              | **0** | **6**  | 0    | **0**       |
| `1s4denn` (no DB row, file-only) | 3     | 1       | 0              | 2     | 0      | 0    | **0**       |

**The story:** outside of the article hero (1 image), production is filling the rest of the slate from generic stock photo libraries. For `1sn9xhe`, **86% of the visuals are Pexels stock**. For `1smsr12`, **50% are Pexels**. The "random man in flooded cottage" complaint isn't an outlier — it's the system working as designed.

### Production image-fetch pipeline ([`images_download.js`](images_download.js) `getBestImage`)

Priority order:

1. Article og:image (priority 100)
2. Pre-saved Steam game_images — capsule (95), hero (90), key_art (85), screenshots (70). **Only fires when hunter.js pre-saved Steam URLs.**
3. Steam search fallback — only runs if NO Steam pre-assets AND article was found
4. Article inline images
5. Pexels stock (priority 25, fires when image count < 6)
6. Unsplash (priority 15)
7. Bing image scrape (priority 10, fires when < 6)

- Cap: 8 total images, Steam capped at 2 when other sources are present

**Failure modes for these samples:**

- `1smsr12` (about a director's opinion, not a specific game) → Steam search returns nothing → Pexels fills 4 of 8 slots
- `1sn9xhe` (Metro 2039) → game isn't on Steam yet (it's a brand-new reveal) → Pexels fills 6 of 7 slots
- `1s4denn` → game IS on Steam, hunter saved 2 Steam assets, didn't reach the Pexels fallback gate (only 3 sources total)

### Production clip-fetch pipeline ([`fetch_broll.js`](fetch_broll.js) + Steam path in `images_download.js`)

| Source           | Trigger                                                                          | Status for samples                                                                                           |
| ---------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Steam trailer    | hunter saved `is_video: true` in `game_images`                                   | All 3 stories: empty                                                                                         |
| IGDB trailer     | `TWITCH_CLIENT_ID` + `TWITCH_CLIENT_SECRET` set, runs only when Steam clip empty | Pulse Gaming `.env` has these creds, but lookup failed for all 3 (game name extraction issue or no IGDB hit) |
| YouTube `yt-dlp` | only when `BROLL_YOUTUBE_FALLBACK=true`                                          | **Disabled by default** — flag opt-in for copyright safety                                                   |

12-second cap on every clip. 20-minute upper bound to avoid podcasts/reviews.

**Net:** all three stories had a path to clips and all three ended up with zero. The pipeline isn't broken; it's gated, conservative, and the gates fire too often.

### Local cached clip inventory

```
output/video_cache/        ← does not exist
output/tiktok_demo.mp4     ← one-off demo, not story-tied
branding/logo_reveal.mp4   ← 1080×1080 brand sting (animated logo)
audio/Breaking News Sting 1-5.wav  ← five news stings, unused
```

Net usable assets we could lean on right now: the brand logo reveal sting (intro/outro), the breaking-news stings (transition SFX), and any locally cached IGDB/YouTube downloads we trigger (none yet).

---

## Studio Short Engine — proposed architecture

The engine has four layers, each addressing one of the user's priorities. **Every layer can fail-closed** (drop to a deliberate fallback) without bricking the render.

### Layer 1 — Editorial pass

A pre-render module that rewrites the script with a creator-studio voice. NOT a re-LLM-generation — a **deterministic editor** that runs after the existing script-gen.

Rules:

- **Hook = first 1–2s only.** One sentence ≤ 12 words. One specific claim, no generic suspense (no "you won't believe", no "this changes everything").
- **No filler openers.** Strip leading "So,", "Right,", "Look,", "Today" (already in `lib/hook-factory.js` for the on-screen overlay; **extend to the spoken script too**).
- **Tighter line pacing.** Cap each phrase at 4 words for fast-cut sections. Already partially done in `lib/caption-emphasis.js` with `WORDS_PER_PHRASE = 4`; needs to apply to the underlying script not just the captions.
- **No awkward digit-pronunciation.** When the script has "Metro 2039" but TTS will say "twenty 39", pre-substitute the script to "Metro twenty thirty nine" so spoken AND visible text match. (This is the half-built `realignTimestampsToScript` work the user halted — it lives in EDITORIAL land, not RENDERER land.)

**Files:**

- New `lib/editorial.js` with `tightenScript(rawScript, story)` returning `{ scriptForTTS, scriptForCaption }` — possibly different forms
- New `lib/script-pronunciation.js` to handle the digit / acronym edge cases (years, GTA→"GTA", PS5, F1, etc.) using a shared map

### Layer 2 — Source diversity

A pre-render acquisition pass that **drops the Pexels / Bing crutch** and instead pulls more topical media. Concrete changes to `images_download.js`:

| Change                                                                  | Where                                                                                                                                                                                                                  | Effect                                                                   |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------- | ---------------------------------------------------------------------- | ----------------------------------------------- |
| **Make YouTube trailer fallback default-on for trailer/reveal stories** | `fetch_broll.js` `fetchFallbackBroll` — if `story.title` matches `/trailer                                                                                                                                             | reveal                                                                   | gameplay | first.look/i`, force `BROLL_YOUTUBE_FALLBACK` = true regardless of env | `1sn9xhe` Metro 2039 trailer would have ≥1 clip |
| **Pull more Steam assets**                                              | `images_download.js` priority-2 step — when Steam matches, also fetch screenshots 2-5 (currently capped) and `library_capsule` variants. Cap raised from 2-per-video to 6-per-video when no other source dominates     | 1s4denn would have 5-6 Steam shots not 2                                 |
| **Expand article-inline scraping**                                      | new helper `lib/article-scraper.js` — when article hero is found, also scrape remaining `<img>` tags from the article body that are >300×200, dedupe by URL, cache locally                                             | 1smsr12 already has 3 inline article images; pattern-match more articles |
| **Drop Pexels and Bing** for stories with verified topical sources      | `images_download.js` — only fall back to stock libraries when total topical count < 3 AND title indicates a game that doesn't have a clear visual identity                                                             | Eliminates the "flooded cottage" filler                                  |
| **Publisher CDN scrape** for first-party game stories                   | new in `lib/article-scraper.js` — for stories from Polygon / IGN / Eurogamer / Rockstar Newswire, follow the article's publisher CDN URLs to grab official press kit assets                                            | More publisher-quality images                                            |
| **YouTube frame extraction**                                            | new in `fetch_broll.js` — once we have a trailer cached, extract 4–6 evenly-spaced still frames via ffmpeg to pad out the still-image slate. These are _guaranteed topical_ because they're literally from the trailer | Solves 1sn9xhe by pulling 6 trailer frames as stills + 1 trailer clip    |

The big idea: every still that lands in a video should be **provably topical** (sourced from the article, the game's Steam page, the trailer itself, or the publisher CDN). When it isn't, we'd rather have fewer images than fill with stock.

### Layer 3 — Clip-first / mixed-media composition

Production already supports video clips in slots — `assemble.js` `isVideoSlot[i]` and the harness `lib/motion.js` skips zoompan for video slots. We're just not USING it because clip acquisition is gated.

New composer `lib/composer.js` that takes the story's media inventory and decides the **slate composition** before the renderer touches anything:

```
composeSlate(story, mediaInventory) → {
  scenes: [
    { type: "opener", durationS: 2.5 },
    { type: "clip", source: "<trailer>.mp4", inS: 4, outS: 8 },        // hard 4s clip
    { type: "still", image: "<hero>.jpg", motion: "pushInCentre", durationS: 3 },
    { type: "card.releaseDate", date: "Q4 2026", durationS: 3 },        // designed graphic
    { type: "clip", source: "<trailer>.mp4", inS: 14, outS: 19 },
    { type: "card.quote", text: "...", attribution: "Director", durationS: 4 },
    { type: "still", image: "<screenshot>.jpg", motion: "pullBack", durationS: 2.5 },
    { type: "clip", source: "<trailer>.mp4", inS: 25, outS: 30 },
    { type: "card.takeaway", durationS: 3 },
  ],
  totalDurationS: 28,
}
```

**Composition rules:**

- Whenever a clip is available, prefer it over a still
- A 60s short with a 12s trailer is sliced into 3× 4-second clip-shots (each cut to a different region of the trailer) — looks like deliberate b-roll, not a slideshow
- A clip-shot can be re-used at multiple in/out points (the user sees the trailer in 3 different chunks, NOT the same chunk 3 times)
- Stills from the trailer (Layer 2 frame extraction) treated as their own "still.fromTrailer" type
- If clips + stills < N, the composer **substitutes designed cards** (release-date, quote, source-confirmation, stat) — NOT recycled stills
- Hard cap: **no still rendered more than twice in the same video, ever** (different crops don't count as different)

### Layer 4 — Scene-type system

Each scene type is a self-contained renderer that takes `{ scene, story, brand, fonts }` and returns a filter-graph fragment. The composer wires them together.

| Scene type         | What it is                                                               | When it triggers                             | Looks like                               |
| ------------------ | ------------------------------------------------------------------------ | -------------------------------------------- | ---------------------------------------- |
| `opener`           | 1–2s claim card with bold typography over a relevant still or clip-frame | Always                                       | Big text, fade-out, snap to next scene   |
| `clip`             | Trimmed slice of a trailer / gameplay clip                               | When a clip is available                     | Real footage, hard cuts                  |
| `still`            | Smart-cropped image with motion                                          | Default fallback                             | Existing Ken Burns variants              |
| `card.releaseDate` | "RELEASE DATE / Q4 2026" type graphic                                    | Story metadata has a date                    | Designed card, no source image           |
| `card.quote`       | Quote with attribution                                                   | Story has `top_comment` or pulled quote      | Quote-mark glyph + text + author         |
| `card.source`      | "CONFIRMED BY: PUBLISHER" badge                                          | Story flair == Confirmed and publisher known | Badge + publisher logo                   |
| `card.stat`        | Steam % / player count comparison                                        | Story has Steam metrics                      | Big-number card                          |
| `card.takeaway`    | One-line closing line + CTA                                              | Always (last scene)                          | Bottom-third + CTA                       |
| `clip.frame`       | Still extracted from a trailer                                           | When clip is shorter than runtime needs      | Looks identical to clip but doesn't move |

These are HTML-natural — strong typography, designed cards, motion graphics — which is the leg this branch's pure-ffmpeg approach can't do well. See "rendering choice" below.

### Anti-repetition gate

A single composable rule applied in `lib/composer.js`:

```js
function antiRepeat(scenes, mediaInventory) {
  const usedStills = new Map();
  for (const scene of scenes) {
    if (scene.type === "still" || scene.type === "clip.frame") {
      const key = scene.image;
      const count = (usedStills.get(key) || 0) + 1;
      if (count > 2) {
        // Force-substitute a card or shorten the slate
        scene.type = "card.takeaway"; // or whichever is contextually right
      }
      usedStills.set(key, count);
    }
  }
  // If the slate had to substitute >40% of its still scenes, REDUCE
  // total runtime instead of padding with cards.
}
```

The rule: **a 30-second video made of real, varied media beats a 60-second video that recycles the same 3 stills.** Length is negotiable; quality isn't.

---

## Files / modules likely to change

### Phase 1 — Editorial + acquisition (highest leverage, lowest visual risk)

| File                          | Status | Purpose                                                                               |
| ----------------------------- | ------ | ------------------------------------------------------------------------------------- |
| `lib/editorial.js`            | NEW    | `tightenScript(raw, story)` — strip filler, cap word count, normalise digits/acronyms |
| `lib/script-pronunciation.js` | NEW    | Number / acronym substitution map (2026 → "twenty twenty-six", GTA → "G T A")         |
| `lib/article-scraper.js`      | NEW    | Pull more inline images / publisher-CDN media                                         |
| `images_download.js`          | edited | Drop Pexels/Bing for verified-topical stories; raise Steam cap                        |
| `fetch_broll.js`              | edited | Force YouTube fallback for trailer-reveal stories                                     |
| `tools/quality-render.js`     | edited | Use `editorial.tightenScript` before TTS path                                         |

### Phase 2 — Clip-first composition (medium risk, biggest visible lift)

| File                      | Status | Purpose                                                                 |
| ------------------------- | ------ | ----------------------------------------------------------------------- |
| `lib/clip-frames.js`      | NEW    | Extract N evenly-spaced still frames from a cached trailer              |
| `lib/composer.js`         | NEW    | Build the slate from `(story, mediaInventory)` → array of scene objects |
| `tools/quality-render.js` | edited | Replace its inline pacing/segment logic with `composer.composeSlate`    |

### Phase 3 — Scene-type renderer (highest visual lift, requires the rendering decision below)

| File                                                          | Status                   | Purpose                                                                                            |
| ------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------- |
| `lib/scenes/opener.js` / `clip.js` / `still.js` / `card-*.js` | NEW (one per scene type) | Each scene produces its own ffmpeg filter fragment OR HTML overlay (depending on rendering choice) |
| `lib/scene-renderer.js`                                       | NEW                      | Dispatcher — picks the right scene module per slate entry                                          |
| `tests/services/scenes/*.test.js`                             | NEW                      | One test file per scene type                                                                       |

### Anti-repetition

| File              | Status              | Purpose                                                                                                                   |
| ----------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `lib/composer.js` | edited (in phase 2) | Add `antiRepeat(scenes)` post-pass that substitutes cards for over-used stills, reduces runtime if too many substitutions |

---

## Rendering choice for scene-cards (phase 3 prerequisite)

The card scenes (release-date, quote, source-confirmation, stat) require designed typography, animation easings, and motion-graphics primitives that ffmpeg's `drawtext` / `drawbox` are weak at. We have two options:

**Option A — Stay in ffmpeg.** Card layouts via increasingly elaborate filter expressions. Doable, but every new card adds another fragile filter chain and a long debugging tail (see `auto_scale_N` saga and the `drawbox alpha` regression we already hit on this branch).

**Option B — Adopt [HyperFrames](https://github.com/heygen-com/hyperframes) for the card layer only.** HTML/CSS/JS authored cards rendered to transparent MP4 by HyperFrames, then composited over the still/clip backbone in ffmpeg. The slideshow remains ffmpeg; the cards become HTML.

**My recommendation: Option B for cards, ffmpeg backbone unchanged.** Reasons:

- Browser preview during card design (massive iteration speedup)
- GSAP / CSS transitions trivially handle the easing the user wants for "studio" feel
- Apache 2.0, local-only, runs offline once Chromium is cached
- Card MP4s are short (3–4s each, transparent) and lightweight
- The risk surface is contained — if HyperFrames stops working, cards revert to ffmpeg drawtext gracefully

This is exactly the lane I flagged in the previous evaluation: HyperFrames for ONE specific layer, not as a wholesale renderer replacement.

---

## What to build first — single-prototype recommendation

If we're allowed only one prototype before deciding direction, build this:

> **Phase 1 acquisition fix + a single `clip` scene end-to-end on `1sn9xhe` (Metro 2039 trailer reveal).**

Specifically:

1. Wire `BROLL_YOUTUBE_FALLBACK` to default-on for trailer-titled stories in `fetch_broll.js` (gated to local-only by hardcoding the override only when run from `tools/quality-render.js`)
2. Use `yt-dlp` locally to grab the actual Metro 2039 trailer
3. Extract 6 still frames from it via `ffmpeg -ss <t> -frames:v 1`
4. Render `prl_1sn9xhe.mp4` with: 1 article hero + 6 trailer-frame stills + 3× 4-second slices of the trailer itself, **zero Pexels stock**

This single prototype will answer:

- Is the source-diversity fix sufficient to make videos feel "topical" without any other change?
- Does a clip-driven backbone visibly differentiate from a stills-only video?
- How much complexity does the scene-type system actually need to add on top?

**Why this story?** It's the worst case in the audit (6 of 7 images were stock filler) AND it's a trailer-reveal where the trailer itself is news-worthy. If clip-first works on this, it'll work everywhere.

**Concrete deliverable:** one `prl_1sn9xhe.mp4` rendered with the prototype, committed to the branch as `test/output/proto_1sn9xhe.mp4`. User reviews. Decides whether to greenlight the full Studio Short Engine build.

**Cost estimate:** one focused session. The acquisition piece is ~150 LOC; the composition is ~50 LOC; the existing harness already handles render. The prototype intentionally skips the scene-type system + HyperFrames decision until the source-diversity fix is proven.

---

## What this plan deliberately does NOT do

- No production deploys, no Railway changes, no `.env` edits, no main-branch commits.
- No PRL polish — frozen.
- No HyperFrames installation yet — that's a downstream decision, gated on the prototype outcome.
- No TikTok touches.
- No live YouTube scraping at production scale — the local prototype uses `yt-dlp` once locally, never on Railway.
- No Premium Render Layer expansion. PRL stays as a reference for what NOT to repeat: the lesson is that renderer polish on top of weak source acquisition is a dead end.

---

## Stop point

Per the user's instruction, I stop here. Awaiting:

1. **Greenlight on the prototype direction** (build the 1sn9xhe trailer-clip prototype?)
2. **Decision on the rendering split** (HyperFrames-for-cards vs all-ffmpeg)
3. **Authorization to enable `yt-dlp`-based clip download locally** (it's local-only and the prototype won't touch Railway, but I want explicit OK before downloading copyrighted trailer footage)

No code in this commit. Plan only.
