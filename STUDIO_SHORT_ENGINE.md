# Studio Short Engine — local-only architecture

Branch: `quality-redesign` (continued)
Status: **architecture + prototype build.** No production deploys, no merge to main, no env-var changes.

The previous PRL approach wasn't enough — overlays on top of a still-image slideshow don't reach "seasoned creator studio". This document captures what studio-grade actually requires in engine terms, the architecture for getting there, and the prototype built in this session to test the architecture on a real story.

---

# Task 1 — What "studio-grade" requires (engine-level audit)

For each layer, this is what a TikTok/Shorts creator studio video DOES, and what the engine has to enforce.

## 1. Editorial layer

| Studio behaviour                                    | Engine implication                                                                                                                                                                               |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Hook is a single concrete claim, not vague suspense | Strip filler openers (`So,`, `Right,`, `Look,`); cap the hook at 1–2 spoken seconds; require a noun-verb-object structure with one named entity                                                  |
| One angle, no padding                               | Single editorial pass that removes recurring filler phrases (`but here's where it gets interesting`, `you won't believe what`, `this changes everything`); enforce per-paragraph word-count caps |
| Words and numbers read as a human wrote them        | Pre-substitute digit pronunciations (`2039` → `twenty thirty-nine`) before TTS so audio + captions agree without post-hoc realignment                                                            |
| CTA is one short imperative line                    | Enforce `cta` field on every story, max 4 words, written as a verb-led command                                                                                                                   |
| No awkward title breaks                             | Caption splitter must NEVER split on `:`, `,`, `;` mid-title (already fixed) and must always insert space after `.!?` (already fixed)                                                            |

**Engine implication (consolidated):** the script-gen output goes through a deterministic editor BEFORE TTS. This is `lib/editorial.js` (already shipped) wired into `audio.js` via `tightenScript()` before the ElevenLabs/VoxCPM call. **Cached audio cannot be retroactively edited** — the editor only takes effect on fresh produce cycles.

## 2. Media layer

| Studio behaviour                                  | Engine implication                                                                                                                                                                          |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Real footage carries the video; stills are filler | Acquisition order: **trailer clips first**, then publisher CDN assets, then trailer-extracted stills, then article hero, then article-inline. **Pexels/Bing only when topical sources < 3** |
| Footage cut to specific beats                     | Trailer downloaded once locally (`yt-dlp`), 4–6 hand-picked clip slices cut at 4–6s with 0.5s headroom                                                                                      |
| Stills are guaranteed topical                     | Frames extracted from the trailer itself become "still scenes" — every frame is provably from the actual reveal                                                                             |
| Publisher gets credit                             | Article scrape captures `og:image`, inline `<img>` from article body, and (for known publishers like Polygon, IGN, Eurogamer, Rockstar Newswire) the publisher-CDN press kit URLs           |
| Stock filler is a tell                            | When fallback fires, mark images with `_stock=true` and **count them in the QC report** so we know if the engine is leaning on filler                                                       |

**Engine implication:** a media-acquisition module that publishes a clean inventory `{ clips: [], trailerFrames: [], articleHeroes: [], publisherAssets: [], stockFillers: [] }` for the composer to consume. Stock fillers are kept available BUT only used when no premium-lane scene type can fill the slot.

## 3. Scene grammar

A studio short is a **sequence of typed scenes**, not a slideshow. The engine maintains a registry of scene types, each with its own renderer:

| Type            | Purpose                         | Trigger                   | Backbone                                               |
| --------------- | ------------------------------- | ------------------------- | ------------------------------------------------------ |
| `opener`        | 1–2s claim card                 | Always at slot 0          | Clip if available, else article hero with text overlay |
| `clip`          | Trailer/gameplay slice          | When clip available       | Real video                                             |
| `still`         | Smart-cropped image with motion | Default fallback          | Image + Ken Burns                                      |
| `clip.frame`    | Still extracted from trailer    | When trailer cached       | Image (no motion)                                      |
| `card.source`   | "REVEALED BY X" reveal          | Once per video, slot 1–3  | Designed graphic on blurred-frame backdrop             |
| `card.release`  | Release-date / status card      | When date metadata exists | Designed graphic with big date glyph                   |
| `card.quote`    | Full-screen Reddit/quote moment | When `top_comment` exists | Quote glyph + body text                                |
| `card.stat`     | Steam % / players card          | When metrics exist        | Designed graphic                                       |
| `card.takeaway` | End sting + CTA                 | Always at last slot       | Blurred-frame backdrop + CTA pill                      |

A studio video typically runs 12–16 scenes for a 60s short. **No scene type is mandatory** beyond `opener` and `card.takeaway`; the rest depend on data availability.

## 4. Motion / graphics layer

| Studio behaviour                           | Engine implication                                                                                                                                       |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hard cuts dominate, dissolves are rare     | Transition mix tilted to ~60% cuts (`concat`), ~40% short dissolves (`xfade duration=0.22`)                                                              |
| Punch-ins on key beats                     | Per-still motion preset library — pushInCentre, pullBack, pushPan, driftDown — picked deterministically per slot                                         |
| Animated badges that feel alive            | Periodic-enable gate on the badge border line (drawbox doesn't support runtime alpha — workaround documented)                                            |
| Lower thirds with brand polish             | Channel name + tagline + thin amber accent line above text                                                                                               |
| Kinetic subtitles                          | Word-level ASS captions with two styles: Caption (84pt) and Emphasis (96pt amber 1.15× scale). Per-word style switching for proper nouns / money / years |
| Visual hierarchy changes every few seconds | Composer-enforced rule: no two consecutive scenes share a backdrop image                                                                                 |

## 5. Anti-repetition layer

| Rule                                                | Implementation                                                                                                                                                                                                           |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No still rendered more than 2× per video            | `composer.antiRepeat()` post-pass walks the scene list and substitutes cards when count > 2                                                                                                                              |
| If unique stills < N, reduce scene count            | Composer recomputes target scene count from `unique-media-count × 2`                                                                                                                                                     |
| Premium lane fails deliberately rather than recycle | If, after substitution, the slate would still have >40% recycled stills, the composer either (a) shortens the video to fit only varied content, or (b) returns `null` so the caller can fall back to the legacy renderer |
| Different crops of the same image are NOT diversity | The composer only counts source-image identity, not crop strategy. A 1080×1920 attention-crop and a north-crop of the same JPEG count as the **same** still                                                              |

---

# Task 2 — Studio Short Engine architecture

## Module map (local-only; nothing here is production-ready yet)

```
lib/
├── editorial.js                     ✓ shipped (script-side filler stripper)
├── caption-emphasis.js              ✓ shipped (realignment + emphasis)
├── prl-overlays.js                  ✓ shipped (badge, source bug, lower third, etc.)
├── motion.js                        ✓ shipped (motion preset library)
├── transitions.js                   ✓ shipped (mixed cut/dissolve strategy)
├── image-crop.js                    ✓ shipped (smart-crop + multi-strategy variants)
├── relevance.js                     ✓ shipped (keyword-match scoring)
├── hook-factory.js                  ✓ shipped (0–3s opener overlay)
│
├── scene-composer.js                ★ NEW in this session
├── scenes/
│   ├── source-card.js               ★ NEW
│   ├── release-date-card.js         ★ NEW
│   ├── quote-card.js                ★ NEW
│   └── (existing types still inline in tools/quality-prototype.js for now)
│
└── (TODO — outside this session)
    ├── media-acquisition.js          NOT shipped — would consolidate the
    │                                 trailer-first / publisher-CDN pipeline
    └── quality-gate.js               NOT shipped — the explicit fail-condition
                                      that forces the renderer to drop a video
                                      if it can't reach premium-lane standards
```

## `lib/scene-composer.js` — responsibilities + I/O

**Input:**

```js
{
  story,                              // DB row
  media: {
    clips: [{ path, startInTrailer, durationS }, ...],
    trailerFrames: [path, path, ...],
    articleHeroes: [path, ...],
    publisherAssets: [path, ...],     // empty for these samples
    stockFillers: [path, ...],        // strictly de-prioritised
  },
  audioDurationS,
}
```

**Output:**

```js
{
  scenes: [{ type, source?, duration, ...sceneOpts }, ...],
  metrics: {
    totalScenes,
    clipCount,
    uniqueStillCount,
    cardCount,
    repeatedStillCount,
    stockFillerCount,
    isSlideshow: false,            // composer's own verdict
  }
}
```

**Responsibilities:**

1. Compute the target scene count from audio duration: `target = clamp(12, 16, ceil(duration / 4.0))`.
2. Allocate scene types according to availability:
   - Slot 0: `opener` (clip if available, else `card.title`)
   - Slot 1: clip OR still
   - One `card.source` between slots 1–3
   - One `card.quote` near 50% if `top_comment` present
   - One `card.release` near 75% if release metadata exists
   - Last slot: `card.takeaway`
   - Remaining slots: alternate clip / trailer-frame / article-hero
3. Apply `antiRepeat()`: walk scene list, replace any 3rd+ occurrence of the same still with a card-typed scene, OR shorten the video.
4. Apply `noAdjacentRepeat()`: shuffle adjacent identical-source scenes apart.
5. Compute and return metrics.

## `lib/scenes/source-card.js` — full-screen designed scene

A 4–5s designed scene that announces the source. Layout:

- Backdrop: blurred + darkened smart-cropped trailer frame
- Top: small kicker `SOURCE` in amber
- Centre: the source label (e.g. `r/GAMES`, `POLYGON`, `EUROGAMER`) at 96pt
- Below: optional sub-line (subreddit + flair, or publisher domain)
- Animated reveal: kicker fades 0–0.3s, label slides up + fades in 0.3–0.9s

## `lib/scenes/release-date-card.js`

- Backdrop: blurred trailer frame
- Big date string (`Q4 2026`, `TBA`, `2026-XX`) at 120pt
- Kicker `RELEASE DATE` above
- Optional clarifier below (e.g. `unconfirmed`, `developer estimate`)

## `lib/scenes/quote-card.js`

- Backdrop: blurred trailer frame, heavier blur than other cards (so the quote gets full attention)
- Big quote glyph `"` at top-left
- Body text at 32pt with 3-line max
- Attribution below in amber: `— u/handle  ↑12,345`
- Same animated reveal sequence as the takeaway card

## What stays experimental

- `lib/scene-composer.js` and the new `lib/scenes/*` modules — local prototype, not cherry-pickable as-is
- The media-acquisition consolidation — designed but NOT built in this session
- The quality-gate fail-deliberately logic — designed but NOT built; for now the composer just labels the metrics

## What could later be cherry-picked safely (in priority order)

1. The new scene types (`source-card`, `release-date-card`, `quote-card`) as new entries in production `assemble.js`'s overlay menu — additive, low risk
2. `lib/editorial.js` wired into `audio.js` before TTS — fixes filler phrases, runs once, deterministic
3. `lib/scene-composer.js` as a NEW production code path behind an env flag — high visual lift, medium risk, needs a feature gate

---

# Task 3, 4, 5, 6, 7

(Filled in after the prototype renders.)
