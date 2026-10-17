# Pulse Factory Premium Plan

Synthesised on 17 October 2026 from five code and market audits, three independent design plans and two judge reviews, then checked by a completeness critic. The critic's findings are resolved in the amendments below; the body that follows is the synthesised plan and is read with those amendments in force.

## Amendments after review (these override the body where they differ)

**17 Oct 2026, non-Steam titles (supersedes the press-path note below).** `src/assets/officialTrailer.ts`: when no Steam app resolves, the factory searches YouTube through the channel's login for "<game> official trailer", accepts only a channel matching a known publisher by name and audience, downloads with yt-dlp, runs the same keyframe matching and cuts under the footage owner's cap (`FRANCHISE_PUBLISHERS`: a PlayStation copy of a Rockstar trailer is Rockstar footage, 6 s; Nintendo stills only). The largest thumbnail is the hero still; the description credits and links the trailer; the search is metered (`QUOTA.search` = 101 units) against the upload reserve. Rockstar footage at 6 s is in use on the live channel by the owner's decision.

**17 Oct 2026, ranking Shorts (from the first evergreen dry run).** An entry shows only its own moment or art (`takeStill`/`takeClip` `ownOnly`), the topic page supplies the hook moment and the hero only, no Steam tile sits under a rank card, the rubric does not count a run of rank cards as repetition, and the analytics loop (`src/analytics.ts`: `video_metrics`, editor advice, Monday digest with views per voice) is live on `videos.list` until the analytics scope arrives.

**17 Oct 2026, shot-aware clips.** Every trailer is scanned for shot changes (scene score plus a frame-difference spike, `detectCuts`); candidates open on a shot's first frame, one per shot, and a clip ends where its shot ends (1.6-4.8 s). The planner cuts a shot where a shorter clip ends (`takeClip` in `plan.ts`). Replaces the fixed 4.8 s clip in section 3.

**Ground truth, 17 Oct 2026, HEAD `1bd9e46d5` plus this commit.** Already landed and no longer backlog: SRT captions (`e70bec20b`), publisher footage cap (`01286d416`), token-tolerant `buildSegments` and Steam app reuse (`1bd9e46d5`), voice take guard (`6da372a12`), own Liam server on :8766 (`311616608`), GPU render (`a72d0f9e2`: `.env` has `REMOTION_GL=angle`, `REMOTION_CONCURRENCY=8`; the benchmark render was pixel-identical to swangle at PSNR 51 dB, and a frame-hash determinism check across two angle renders is item 1.1). 34 tests pass.

**Voice provider.** `VOICE_PROVIDER=elevenlabs-first` is deliberate: the owner asked to use ElevenLabs credits already paid for before the local clone, and never to buy more. The mode spends only while the month's balance covers the script. Both providers return the same `Word[]`, so captions are unaffected. The ElevenLabs key on this PC is invalid until the owner replaces it; the mode then falls through to Liam.

**YouTube scopes (blocking for captions and analytics).** The refresh token in use carries only `youtube` and `youtube.upload`; `captions.list` on an own video returns 403. Captions (`youtube.force-ssl`) and analytics (`yt-analytics.readonly`) need a one-time reconnect at `/oauth/start?key=<ADMIN_TOKEN>` through the tunnel URL, which the factory already requests with the right scopes. Until then `addCaptions` logs `captions_failed` and item 1.10 is blocked. `cli doctor` must check scopes via `tokeninfo`.

**Non-Steam titles.** Every media path keys on a Steam app, so console-only GTA VI, Nintendo titles and hardware stories would render on a brand plate. Milestone 2.2 adds a first-party press path: `official` feed items' `og:image` and newsroom galleries (already partly in `gatherMedia`), a `publisher` field on every feed in `feeds.ts`, and `footageBudgetSeconds` keyed on the feed publisher when no Steam app resolves. Rockstar footage on a monetised channel is an accepted residual risk even under the 6 s cap; stills only for Rockstar is the default until the owner decides otherwise.

**Rights of owned audio.** The four music beds are Suno generations (ids in `public/music.rights.json`, created 6 April 2026); the SFX are synthesised by `tools/build-sfx-library.js` (`public/sfx/rights.json`). Suno output under a paid plan is licensed for commercial use, but any Content ID claim on a bed retires that bed. Master at -16 LUFS integrated (YouTube normalises to -14 anyway) because the Codex gauntlet showed -14 trips the transient-recurrence check; `loudnorm I=-16:TP=-1.5` replaces `I=-14` in `qa/media.ts` and the technical QA band becomes -17 to -15.

**Loop seam.** Frames N-30 to N render the headline block, not the key fact, pixel-identical to frame 0; the loop line's key fact is spoken, not shown. SSIM >= 0.9 is measured with the caption band masked.

**Word bands.** Hook 8-14 words (reject over 16) everywhere: schema, `validateScript`, prompt and rubric. SRT cues: at most 20 cps, minimum 1.0 s; there is no cps floor.

**Quota day.** `quota_ledger` keys on the Pacific calendar day (YouTube resets at midnight Pacific); the content day boundary stays Europe/London. `TOP_PUBLISHERS` is the publisher list in `feeds.ts` with `official: true`.

**Determinism grep** covers `src/render/Short.tsx`, `components/**`, `timeline.ts`, `plan.ts`, `layouts.ts`, `props.ts` only, in `tests/determinism.test.ts`. Focal points come from ffmpeg (`cropdetect` and tiled `signalstats`), never `sharp`.

**Live ticker.** The Steam player count is fetched at script time, so the badge reads "PLAYING ON STEAM" with the fetch time in the description, never "RIGHT NOW".

**Xbox notice** carries the rules URL: "Footage from {Game} used under Microsoft's Game Content Usage Rules, https://www.xbox.com/en-US/developers/rules".

**Tunnel outage.** Timeout approval must not auto-publish while `PUBLIC_URL` is unreachable: `stepAwaitApproval` checks `${publicUrl}/health` through the tunnel and holds the episode (Discord warning) if it fails. Added to item 1.9.

**Unattended host (new item 1.11, 3 h).** Power plan never sleeps, Windows Update active hours set, the "Pulse Factory" task has `-RestartCount 999` already; add a boot-time `cli doctor`, a lease reaper for episodes stuck mid-step after a reboot, and a disk budget check (>= 20 GB free, prune raw trailer downloads after render).

**Go-live checklist (owner-facing, in order).** 1 Anthropic key valid and a dry-run episode produced. 2 Legacy publishers disabled (`windows\disable-legacy-publishers.ps1`, Administrator). 3 Tunnel task registered (`windows\install-tunnel.ps1`) and `/oauth/start` reconnected with captions and analytics scopes. 4 Owner watches two dry-run Shorts and signs off the template. 5 `DRY_RUN=false`, `YOUTUBE_PRIVACY=unlisted`, first real upload checked on YouTube. 6 `YOUTUBE_PRIVACY=public`. Unlisted and dry-run uploads do not count toward any analytics gate.

**Also scheduled (from the audits, previously unlisted):** pinned comment via `commentThreads.insert` (50 units, in the quota arithmetic) in Milestone 2.6; hero-moment accents capped at 3 per Short and word-count card durations (`0.18 x words + 1` s) in 2.4; `MapReveal` rejected for this channel. `videoMetadata`, `segmentInputs` and `steamStat` get unit tests in 1.7, not 3.7.

---


Lead synthesis of the retention, production-value and engineering plans and both judges' notes. Code paths are under `C:\PulseFactory\factory\` unless stated. Frames are at 30 fps on 1080x1920. Hours are single-engineer estimates including tests. British English, no Oxford comma.

## 0. Ground truth and governing rules

Verified on disk on 17 Oct 2026, branch `claude/epic-pasteur-7s143q`, HEAD `01286d416`. Three things the earlier plans listed as backlog have already landed and are treated as done:

- `e70bec20b`: `srtFromWords` in `src/render/timeline.ts`, `captions.srt` written in `stepVoice`, `YouTubeClient.listCaptions` and `insertCaption` in `src/youtube/upload.ts`, `addCaptions` called from `stepConfirm` after `processed`, idempotent on an existing en-GB track, failure logged as `captions_failed` and never blocking. Remaining work on captions is quality (phrase cues, cps bounds) and the quota budget check.
- `01286d416`: `src/assets/footage.ts` with `footageBudgetSeconds(app)` (Rockstar 6 s, default 14 s) and `capFootage`, applied in `gatherMedia`. Remaining work is the full publisher table, the rights ledger and the on-screen credit.
- `50e90d2c4`: `VOICE_PROVIDER=elevenlabs-first`. The owner's constraint that the narrator is the cloned local VoxCPM "Liam" stands; `elevenlabs-first` is a credit-spending mode and every provider must return word timings in the same `Word[]` shape or the plan below cannot build captions.

Still true: no episode has ever rendered on this PC (`data\episodes` does not exist, every tick logged Anthropic 401), `.env` is `DRY_RUN=true`, `REMOTION_CONCURRENCY` default 2, `SAFE = {top:150, bottom:1490, left:64, right:930}` at `Overlays.tsx:17`, TopBar at y 90, nothing drawn in y 900-1180 during beats, `MotionField` with three `blur(40px)` orbs always mounted, `ClipShot` slows clips to 0.6x, `shotTimes` evenly spaced, 58 s `FatalError` at `pipeline.ts:172`, `WORDS_MIN/MAX` 70/115, `VISUAL_KINDS` six values, five owned SFX files in `public/sfx`, four distinct music beds (MD5 checked), only the five core Remotion packages pinned at 4.0.536 (`paths`, `captions`, `media` present transitively and unpinned), no `migrations/002`, no `scripts/` directory, 27 tests.

Rules that every item below obeys (merged from the three plans, all judged must-keep):

1. Retention ladder governs. S0 swipe (frames 0-60), S1 proof (60-240), S2 hold (8 s to the take), S3 payoff (take and loop line), S4 replay (last 30 f into frame 0). Every device ships with a hypothesis and the stage metric it must move; anything that cannot be tied to a stage is cut. Add structure, not noise (the Codex gauntlet scored busier variants 77 against 100 for the disciplined render).
2. Plan then render. Every creative decision (archetype, shots, cards, shelf device, caption pages, SFX cues, turns, loop) is computed in Node by pure functions into a `RenderPlan` JSON, persisted in `assets_json.plan` and executed by the composition. Retries re-render the identical plan; planners are tested without Chromium; the rubric rejects a plan before a render is spent.
3. No LLM, no network, no `Math.random`, `Date.now`, `new Date(`, `fetch(` or `performance.now` inside `src/render`. A grep test enforces it. Model-assisted choices (clip ranking) run in pipeline steps and are persisted.
4. Fail closed, never fail blank. Missing media produces a brand plate, missing card data falls back to the title, a plan that fails the rubric is rebuilt with a new variant seed once and then fails the episode.
5. Nothing is tuned before data exists. Analytics capture starts with the first upload; no scoring or prompt change from analytics before 40 published Shorts per cell.
6. One production worker per PC. VoxCPM, Chromium and ffmpeg share the CPU and GPU; lanes feed one sequential producer through a priority queue.
7. Dependency ceiling: add only `@remotion/layout-utils@4.0.536`. Charts are inline SVG. No `@remotion/effects`, `@remotion/transitions` or `@remotion/media` while renders stay on software GL. `@remotion/paths` may be pinned at 4.0.536 (already present transitively) for `evolvePath`.
8. Frame 0 is the thumbnail. Everything that must read at S0 is fully rendered at frame 0, nothing springs in from alpha 0, and the first spoken word lands at frame 0-3.

Resolved contradiction (both judges flagged it): the hook wants a high-motion full-bleed clip, the loop wants frame N to equal frame 0. Resolution: frames 0-11 are the brand sting over the hero still at scale 1.06 with the headline fully rendered; the first cut, into the highest-motion clip, lands at frame 12 (0.4 s) and is itself the first visual event. The loop's final 30 f return to the same hero still at 1.06 with the callback headline. The seam gate compares frame 0 with frame N-1 with the caption band masked.

---

## 1. Visual system

Files: `src/render/brand.ts` (colour and type tokens, re-exported by `props.ts`), `src/render/motion.ts` (springs, easings, durations), `src/render/layout.ts` (bands and slots). `STORY_THEME` stays in `props.ts` and gains `review_scores` and `hardware`.

### 1.1 Colour tokens

| Token | Hex | Rule |
|---|---|---|
| ink | `#0B0B0E` | all plates and panels |
| paper | `#F5F5F2` | primary text |
| muted | `#B4B4BC` | labels, lifted from `#A1A1AA` for 4.5:1 on ink |
| chrome | `#848180` | mono micro labels only |
| amber | `#FF6B1A` | identity; present in every frame (lockup full stop, accent rule or progress rail) and the dominant coloured area |
| alert | `#FF3B3B` | delay, rumour, negative deltas |
| verify | `#38BDF8` | only LIVE, VERIFIED and live-data chart highlights; never more than 10 % of coloured area |
| up / down | `#22C55E` / `#FF3B3B` | deltas and score bands only |
| gold | `#FFC21A` | price archetype accent |
| violet | `#8B5CF6` | industry and other |
| sky | `#38BDF8` | update archetype cards (shares verify, so update cards cap cyan at the same 10 %) |

Story accent: one per Short from `STORY_THEME[storyType].accent`. Rumour forces alert. Review scores use the band colour (>= 80 up, 60-79 amber, < 60 alert). No neon, no gradient orbs (`MotionField` orbs removed; a single amber edge glow plus the perspective grid remain as `BrandPlate`, mounted only when a shot's media is `plate`).

### 1.2 Type ladder

Anton for glanced text, Inter for read text. `fontVariantNumeric: "tabular-nums"` on every number (verify the fontsource Inter subset keeps `tnum`; if not, ship the full Inter woff2). At most three sizes visible at once, never two display sizes together.

| Role | Face | px | Use |
|---|---|---|---|
| Display XL | Anton | 180-210 | one number or date |
| Headline | Anton | 118-138, `fitText` to 3 lines, floor 104 | hook |
| Card title | Anton | 92-112 | take box, list rows, chart titles |
| Caption | Inter 900 | 80 | spoken words |
| Chart value | Anton | 56-64 | bars, ring, callouts |
| Label | Inter 800 | 30-40, uppercase, tracking 2 px | kickers, chips, axes |
| Micro | Inter 600 | 26-28 | footage credit, footnotes |
| Floor | | 26 | nothing lower (current LiveStat labels at 24-26 breach it) |

### 1.3 Layout bands (`layout.ts`)

```ts
export const BANDS = {
  header:  [0, 150],      // phone status bar + Shorts header icons: nothing
  brand:   [150, 300],    // lockup, story chip, source lower-third
  wire:    [300, 352],    // progress rail (default) or sentence strip (variant B)
  hero:    [360, 900],    // headline, primary card, chart, framed footage panel
  shelf:   [900, 1180],   // evidence shelf: exactly one device per beat
  caption: [1180, 1460],  // caption block centred on y 1320
  soft:    [1460, 1620],  // footage, scrim, footage credit tag only
  nogo:    [1620, 1920],  // channel row, carousel, progress bar: nothing
} as const;
export const X = { left: 64, rightHigh: 1016, rightLow: 920, railFrom: 1000 };
export const SAFE = { top: 150, bottom: 1500, left: 64, right: 1016, railTop: 1000, railRight: 920 };
```

x range 64-1016 above y 1000, 64-920 from y 1000 down (right rail: heart, comment, share, remix, audio disc at x 930-1080). Captions centred within 64-920. TopBar moves from y 90 to y 150, right edge capped at 1016. The 10 px progress bar leaves y 0 and becomes a 6 px `ProgressRail` at y 300, 952 px wide, one segment per hook, beat, take and loop, active segment in accent, linear.

Scrim becomes banded with a profile per archetype (`footage | card | plate`): top 0-300 from 0.80 to 0.10; hero and shelf 300-1150 at 0.08 (card profile 0.22); caption band 1150-1500 from 0.10 to 0.70; bottom 1500-1920 from 0.75 to 0.92. Footage reads through the hero and shelf.

### 1.4 Motion signature (`motion.ts`)

- Springs: `ENTER {damping 14, stiffness 160, mass 0.7}` (about 18 f settle), `POP {15, 260, 0.5}` (about 12 f), `SNAP {20, 400, 0.4}` (about 8 f).
- Easings: `Easing.out(Easing.cubic)` for draws and count-ups, `Easing.inOut(Easing.cubic)` for moves, `Easing.in(Easing.quad)` for exits, linear only for the rail.
- Durations: micro 4-6 f, chip 8-10 f, card 14-18 f, chart 18-24 f, minimum hold 45 f before an exit, exit 8 f (24 px slide plus fade). Staggers: headline words 2 f, bars and rows 3-4 f, list items 6 f.
- Rule then content: a 4 px accent rule draws over 10-14 f and the content it introduces follows 4 f behind. Every card, lower-third and chart enters this way.
- Cut punch: incoming shot scales 1.03 to 1.00 over 5 f on every cut. One ambient movement per shot (push or drift, never both). Move presets `pushIn | pullBack | pushPan | driftDown` chosen by `(shotIndex * 7 + variant) % 4`, first shot always `pushIn`.
- Accent flash: 3 f at 0.30 alpha, screen blend, only at the two genuine turns (hook end, take start). The current 5 f `CutFlash` on every segment start goes.
- Event cadence: one visual event (cut, card land, counter completion, shelf change) every 60-120 f, never two within 12 f except cut plus card at a segment start.
- Register flip: the active caption word and the active data value flip to the accent together.
- Finish: grain 0.06 (tiled `grain.png`), vignette 0.55, `filter: contrast(1.03) saturate(1.05)` on footage layers only. No `backdropFilter` anywhere, no live `blur()`, no chromatic aberration, no light leaks, no wipes (all judged noise or render cost; see section 4 rejected list).

### 1.5 SFX signature

Owned set in `public/sfx` plus one new file. Cue list is emitted by the plan (`plan.sfx`) and rendered by one `map` in `Short.tsx`. Hard cap 6 cues per Short including the two brand stings, so at most 4 content cues.

| Cue | File | Frame | Volume | Max |
|---|---|---|---|---|
| Brand sting | `sting.mp3` (new: ffmpeg `amix` of `punch-deep` + `tick-blip`, 0.4 s, rights JSON with origin, formula and sha256 in `public/sfx/sting.json`) | 0 and N-12 | 0.40 | 2 |
| Card whoosh | `whoosh-short.mp3` | 3 f before the two strongest card enters | 0.28 | 2 |
| Count tick | `tick-blip.mp3` | count-up completion | 0.30 | 1 |
| Riser | `riser-fast.mp3` | 24 f before the take | 0.22 | 1 |
| Swipe | `swipe-tonal.mp3` | retired from the seam (the sting carries it); available to the reveal archetype PiP enter only | 0.25 | 0-1 |

Headline word pops stay silent. Music: four owned beds, ducking by an attack/release envelope (attack 2 f, release 9 f, about 300 ms) between 0.20 in gaps and 0.085 under voice, held at 0.20 through the tail and never faded to silence, with the last 15 f crossfaded into the bed's first 15 f. Master stays at -14 LUFS, true peak -1.0 dBTP, SFX peaks -12 dBTP.

---

## 2. Short template v2

### 2.1 Frame-by-frame structure (45-55 s target, tier M)

| Frames | Segment | Hero band | Shelf band | Background | Audio |
|---|---|---|---|---|---|
| 0-11 | Sting | Headline fully rendered (Anton 138, accent word), brand bar complete, source lower-third complete | `SourceChip` already landed | Hero still at scale 1.06, no motion | sting at 0, voice word 1 at frame 0-3 |
| 12-60 | Hook | Headline holds | `SourceChip` or `GameCard` | Cut (punch) to the highest-motion clip, full-bleed | voice |
| 60-hook end | Hook cont. | Headline exits over the last 8 f | shelf holds | Intra-segment cut at about 3.0 s snapped to a word end | accent flash 3 f at hook end |
| beat k start | Beat k | Rule then card (archetype primary device), proof within 15 f of the cue word | Exactly one shelf device, enters 6 f after the card, min hold 45 f | Framed clip or still with one slow push; cuts every 2.6-3.6 s snapped to word ends | whoosh on at most two card enters, tick on count completion |
| take start - 24 | | | | | riser |
| take | Take | "OUR READ" label (archetype vocabulary) and red-boxed take headline, `fitText` 2 lines at 96 | `LiveTicker` (Steam players) or `DataCallout` | Hero still full-bleed, slow push | accent flash 3 f at take start |
| loop line | Loop | Callback card: the hook's key fact at the headline position and size over 20 f | "UP NEXT ▸ {related headline}" or "PULSE. DAILY GAMING NEWS" | Hero still returning to scale 1.06 | voice tail trimmed to 6 f after the last word |
| N-30..N | Tail (1.0 s, was 0.6 s) | Headline block pixel-identical to frame 0 | as above | Hero still at 1.06 | sting at N-12, bed held at 0.20, captions empty for the last 6 f |

No full-screen end card, no fade to black, no subscribe plate, no CTA. The take is the climax and the only place for a riser. Length tiers (per-tier caps replace the 58 s `FatalError`, with one rewrite back to `selected` carrying "narration was Xs; cut N words"):

| Tier | Words | Target | Requires |
|---|---|---|---|
| S | 90-125 | 35-45 s | default until the first ten publishes |
| M | 125-160 | 45-58 s | >= 4 unique media, 3-4 beats |
| L | 165-250 | 60-90 s | official story, score >= 70, >= 6 unique media, 5-6 beats, owned audio only; enabled only after tier M AVP >= 70 % over 40 uploads |

### 2.2 Layout archetypes by story type (`src/render/layouts.ts`)

`STORY_TYPES` gains `review_scores` and `hardware`; `is_rumour` overrides to the rumour archetype. `layoutFor(script, steamFacts)` in `src/render/plan.ts` picks the archetype; timing tokens are identical across archetypes so the brand reads consistently and only devices, accents and footage mode vary.

| storyType | Hero device (360-900) | Shelf default (900-1180) | Footage mode | Accent | Take label | Loop callback |
|---|---|---|---|---|---|---|
| delay | Headline then `Timeline` (old date to new date, slip arrow) | `DataCallout` "+N MONTHS" then `SourceChip` | framed, calm shots | alert | OUR READ | new date |
| release_date | `Calendar` with countdown chip | `GameCard` then platform chips plus `LiveTicker` | full-bleed hook, framed beats | amber | WHY IT MATTERS | the date |
| price | `PriceTag` (old struck through 8 f, new Anton 180, currency and region) | regional row of three `DataCallout` tiles | framed | gold | THE MATHS | the price |
| sales | Display XL count-up | `BarCompare` against comparable titles, else `TrendLine` | framed, optional `PictureInPicture` | up green | THE CONTEXT | the number |
| update | `Changelog` (3-4 rows, tick draws) plus version chip in the brand bar | `SplitScreen` before/after when two images exist, else `LiveTicker` | framed | sky | PATCH PULSE | version |
| reveal / trailer | footage-led: full-bleed clip, minimal headline, `QuoteCard` "FROM THE TRAILER" | `PictureInPicture` of a second trailer moment plus credit | full-bleed, cards cover < 35 % of the frame | amber | TRAILER TRUTH | the title |
| review_scores | `Ring` plus 2-3 outlet chips staggered 4 f | Steam review % `DataCallout` plus players | framed | by band | THE VERDICT | the score |
| hardware | `SpecSheet` 4-5 rows | `PriceTag` compact plus `Calendar` mini | framed first-party press images only | amber | PLATFORM PULSE | price or date |
| rumour | headline with hatched border (`repeating-linear-gradient 45deg`, 12 px), footage desaturated 40 %, chip "RUMOUR · UNCONFIRMED" | large `SourceChip` "REPORTED BY …" plus "WHAT WE KNOW" list; no count-ups, no clips | stills only | alert | WHAT WE KNOW | who reported it |
| industry / other | headline plus `QuoteCard` or `BarCompare` | `DataCallout` row then `GameCard` | framed | violet | OUR READ | the headline fact |

### 2.3 The lower-middle: evidence shelf (`src/render/components/Shelf.tsx`)

Every beat populates the shelf with exactly one device, never two, never empty for more than 20 f during speech. Shelf occupancy (frames with a shelf device divided by frames with speech) must be >= 0.85. Device selection in `plan.ts`, in order: (1) `beat.evidence` from the editorial step; (2) deterministic `shelfFor(beat, steamFacts, storyType)` using `assets_json.steam.facts` (price, releaseDate, comingSoon, metacritic, positivePercent, totalReviews, currentPlayers); (3) `GameCard` during the hook and any beat that names the game; (4) `ProgressRail` plus `SourceChip` as the last resort. Shelf changes count toward the event cadence; never two shelf items within 20 f.

| Device | Geometry | Data | Frames |
|---|---|---|---|
| `SourceChip` | pill 34 px: "CONFIRMED · XBOX WIRE", "REPORTED BY VGC", "RUMOUR · UNCONFIRMED" | attribution, isRumour, lead item source | rule 10 f then wipe 14 f; default during the hook |
| `DataCallout` | up to 3 tiles 280x140 or one 420x150; value Anton 72 tabular, label Inter 800 28, delta chip 26 | Steam facts or beat `value_a/b` | ENTER 18 f, count-up 24 f easeOutCubic starting at the cue word minus 2 f, stagger 4 f, one tick |
| `GameCard` | capsule `library_600x900` at 240x360 (180 px tall in the compact form), title Anton 48, platforms and release year Inter 28 | capsule image, `steam.facts.releaseDate`, game title | slide 9 f plus POP (the Epix box-art device) |
| `LiveTicker` | relocated `LiveStat`: green dot, "LIVE · STEAM", value Anton 64, label Inter 800 28 (floor respected) | `steam.facts.currentPlayers` | shown from the first beat that cites Steam, not only in the take |
| `PictureInPicture` | 760x428 at (64, 940), 4 px accent border r 8, credit tag inside | a clip not used in the hero | POP plus 24 px rise |
| `ProgressRail` | 952x6 at y 300 (wire band; shown with the shelf fallback) | segments | linear |
| `Ticker` | 52 px wire-band scroller, 28 px uppercase, diamond separators, 2.4 px/frame seamless loop | 3-5 side facts | variant C only, never in the first 45 f, sales and hardware only; off by default |

### 2.4 Caption spec

Burned-in (`Overlays.tsx` `Captions`, `timeline.ts` `pageCaptions`): pages of 2-4 words, 16 chars per line, 2 lines max, break on `[.!?;:,]` and pauses > 350 ms, minimum page 10 f (merge forward when shorter), hold until the next page if the gap < 600 ms, never rendered before `start - 50 ms`, active window `start - 30 ms` to `end + 80 ms`. Display strips trailing punctuation; the SRT keeps it. Inter 900 80 px uppercase, 4 px stroke `rgba(0,0,0,0.9)` with `paintOrder: stroke fill`, shadow `0 6px 24px rgba(0,0,0,0.85)`, block centred on y 1320 within x 64-920. Ink pill (0.45 alpha, 12 px radius) only when the plate luminance under the band exceeds 0.55 (YAVG from the clip scoring pass, stored per shot in the plan). Colours: unspoken `rgba(245,245,242,0.55)`, spoken paper, active story accent. Emphasis tokens (`beat.emphasis` plus regex for money, percentages, 4-digit years, bare numbers and game-title tokens) stay accent after being spoken. Active word: scale 1.00 to 1.06 over 4 f easeOutCubic, settle by 8 f, 4 px lift, no bounce, no per-word SFX, no flashing. Page enter POP from 0.92 (current 0.86 is too much). Two-tier sentence strip (30 px Inter 600, sentence case, wire band) ships as variant B, default off.

SRT (already landed): tighten `srtFromWords` to phrase cues of 1-2 lines, 32 chars per line, 1.0-5.0 s, 17-20 cps, sentence case with original punctuation, validated monotonic and non-overlapping inside the programme duration. Captions upload is skipped (not failed) when the quota ledger has fewer than 500 units.

### 2.5 Data visual components (`src/render/components/data/`)

All inline SVG or CSS, under 200 nodes, no filters, lengths driven by `interpolate` and `spring`, numbers via `countUp` (skip count-up for values in 1900-2100 unless kind is `stat`). Count-ups and draws start at the spoken cue word (`emphasis[0]` located in the beat's words) minus 2 f, else segment start plus 6 f, and always finish before the beat ends. A number never appears before it is spoken.

| Component | Geometry | Motion (frames) | Data | SFX |
|---|---|---|---|---|
| `DataCallout` | as in 2.3 | count-up 24 f easeOutCubic, en-GB separators | `{value, label, delta?}` | tick |
| `BarCompare` | 2-5 rows, label Inter 800 32 in a 300 px column, bar 56 h r 6 max 560 w, value Anton 56 | grow 18 f easeOutCubic, stagger 3 f, values count in step, highlighted bar accent | `items` "label:value" or `value_a/b` | one tick on the highlighted bar |
| `Timeline` | track 952x6 at y 1000, two 24 px diamonds, labels Anton 64 above and Inter 28 below, delta pill | old marker ENTER 0-18; desaturate at 20; dashed line extends 20-36 easeInOutCubic; new marker POP 36-48; delta pill SNAP at 54 | `date_from`, `date_to` ISO, delta text | whoosh at 20, tick at 48 |
| `PriceTag` | old price Anton 96 with 8 f strike line, new price Anton 180, currency and region label | strike 0-8, new price ENTER plus count-up 24 f, region row SNAP | `value_a/b`, `currency`, `region` | tick |
| `Ring` | r 150, stroke 28, track 12 % white, value Anton 120, label 30, outlet chips Inter 800 32 | `strokeDashoffset` 24 f easeOutQuart, number in sync, chips stagger 4 f, colour by band | `value_a` 0-100, `items` outlets | tick |
| `Calendar` | 400x440, month header 34, 7-column grid 28, target day 72 px accent circle with Anton 48, countdown chip | grid fade 10 f, day POP at 14, countdown SNAP at 24 | `date_to`, render date passed as a prop (never `new Date` in render) | tick |
| `Changelog` | 3-4 rows Anton 64 plus Inter 30, 24 px tick marks | ticks draw 8 f stagger 5 f, rows `clipPath` wipe 12 f | `items`, `label_a` version | none |
| `SplitScreen` | two 952x535 panels stacked from y 360, 24 px gap, 34 px chips | A wipes from the left 12 f, B from the right 4 f later, divider draws 10 f | two image or clip refs plus labels | none |
| `TrendLine` | 952x360, stroke 8 accent, area 0.18 | `evolvePath` 30 f, end dot POP, annotation SNAP at +6 | ordered `items` | none |
| `SpecSheet` | 4-5 rows key Inter 800 32 / value Anton 56 | row wipes 6 f stagger | `items` "key:value" | none |
| `PictureInPicture` | 760x428 at (64, 940) | POP plus 24 px rise | clip ref, credit | none |
| `QuoteCard` (rework) | ink panel 0.82 alpha, 10 px accent top rule, glyph 150, Inter 800 60 sentence case, attribution; `backdropFilter` removed | rule 10 f then text ENTER 14 f | `primary`, `secondary` | none |
| `GameCard` | as in 2.3 | slide 9 f plus POP | capsule, facts | none |
| `FramedFootage` | 1016x572 panel at (32, 360), radius 10, 2 px hairline `rgba(255,255,255,0.14)`, 120 px shadow, over a pre-blurred full-bleed plate | push 1.00 to 1.04 over the shot; panel POP 0.96 to 1 over 12 f plus 24 px rise | clip or still plus `blurSrc` | none |
| `BrandPlate` | ink field, game title Anton 112, capsule 400 px, 4 px accent rule, perspective grid, amber edge glow | rule 10 f then content | title, capsule | none |
| `RankingLadder` (evergreen, Milestone 3) | rank badge Anton 96, `GameCard`, verdict chip <= 4 words, entry wipe 12 f | per entry: rule, badge POP, card ENTER, chip SNAP | evergreen entries | one whoosh per Short |

Build order: `DataCallout`, `BarCompare`, `Timeline`, `PriceTag`, `Ring`, `Calendar` first (the six top archetypes), then the rest.

### 2.6 Gameplay credit treatment

- `FootageCredit` micro tag, 26 px Inter 600, at (64, 1560) in the soft margin during every clip shot, "FOOTAGE: {PUBLISHER} · OFFICIAL TRAILER", fading 8 f in and out with the shot. Inside the `FramedFootage` panel the tag sits bottom-left inside the frame.
- `videoMetadata` appends a "Footage:" block from `assets_json.rights[]` ("{Game} official trailer, {Publisher}, via Steam") and the Xbox Game Content Usage Rules notice line when the publisher matches `/microsoft|xbox game studios|bethesda/i`.
- Description carries the disclosure line: "Narration: locally generated British synthetic voice. Visuals: official publisher material, credited." and `containsSyntheticMedia: true` stays on every upload.

---

## 3. Beat-aware media

### 3.1 Metadata the editorial step must emit

Flat optional fields only, no discriminated unions in the model schema (lowest structured-output drift risk). `src/editorial/schema.ts`, mirrored in `src/render/timeline.ts` `Visual` and `Segment`; the prompt at `editorial.ts:43-57` teaches each field with one example; `validateScript` caps lengths and checks that `emphasis` words occur in the narration and that numeric fields appear in the sources or Steam facts.

```ts
export const VISUAL_KINDS = ["title", "stat", "date", "quote", "list", "none",
  "timeline", "compare", "bar", "countdown", "price", "score", "changelog", "spec", "split", "pip"] as const;
export const BeatSchema = z.object({
  narration: z.string(),
  visual: z.object({
    kind: z.enum(VISUAL_KINDS), primary: z.string(), secondary: z.string(),
    value_a: z.number().optional(), value_b: z.number().optional(),
    label_a: z.string().optional(), label_b: z.string().optional(),
    date_from: z.string().optional(), date_to: z.string().optional(),   // ISO
    currency: z.string().optional(), region: z.string().optional(),
    items: z.array(z.string()).max(5).optional(),                       // "label:value" or plain rows
  }),
  evidence: z.enum(["source", "stat", "timeline", "players", "price", "platforms", "pip", "gamecard", "none"]).optional(),
  footage: z.object({
    want: z.enum(["gameplay", "cinematic", "character", "world", "vehicle", "ui", "calm", "none"]),
    energy: z.enum(["high", "medium", "low"]),
    keywords: z.array(z.string()).max(4),
  }).optional(),
  emphasis: z.array(z.string()).max(3).optional(),
});
```

Script level: `angle` (required; the Pulse take exists today, evergreen needs a stated criterion, long-form a thesis per chapter), `footage_budget_hint: "hook" | "even"`, `pronunciations: [{written, spoken}]` applied before TTS with the written form kept for captions and SRT (aligned by token index). Hook and take also get `footage` (hook defaults `energy: high`, take `energy: low` except reveal/trailer). `cardDataFrom(beat, steamFacts)` in `plan.ts` builds the typed card payload and falls back to `title` when fields are missing. Steam facts travel as `props.steam` so price, date and review tiles never depend on model transcription.

### 3.2 Clip selection algorithm (`src/assets/steam.ts`, new `src/assets/clipscore.ts`)

1. Fetch each trailer variant's HLS once into `raw.mp4` (factor `grabClip`'s fetch into `fetchTrailer`).
2. Candidate windows every 1.5 s from `max(22 s, 15 %)` to `total - 12 s` for trailers over 60 s; for trailers of 60 s or less, from `max(10 s, 20 %)` to `total - 8 s` (the strict 22 s rule returns zero windows on short trailers; the shorter anchor still clears rating boards and publisher logos on most 45-60 s trailers, and the vision pass rejects any that remain). Fail closed to stills if fewer than two candidates survive.
3. One ffmpeg pass per trailer: `-vf "fps=1/1.5,scale=320:-1"` writes numbered keyframes; `signalstats` gives YAVG (luma) and YDIF (motion) per window. Reject YAVG < 25 or > 230. Reject the bottom 20 % by YDIF when a beat asks for `energy: high`. Record luma and motion on each candidate. Cost about 1 s per candidate; the breaking lane proceeds stills-only if clips are not ready within 90 s.
4. Ranking behind `CLIP_RANKING=llm|rule` (default `llm` once the key is valid, `rule` always available): one `llm.structured` vision call (pattern `qa/vision.ts:15-23`, effort low) on a contact sheet of up to 24 surviving keyframes returns per candidate `{label, hasFace, hasText, hasWatermark, energy}` and a ranked `{beatIndex, candidateIndex, confidence}` map against the beats' `footage` hints; `confidence < 0.5` means no clip for that beat (still instead). Rule mode assigns by motion only (hook gets the highest, chart beats the lowest). Either way the result is persisted in `assets_json.clips[].{beatIndex, startSeconds, motion, luma, label, score, reason, publisher}` so renders are reproducible and `plan.ts` never calls a model.
5. Grab 4.8 s per chosen window at crf 17 (so no shot ever needs slow motion; the 0.6x floor in `ClipShot` goes), best candidate per beat plus two spares, within the publisher budget (3.3). Pre-render a blurred plate per clip and per wide still at asset time (`ffmpeg -frames:v 1 -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=28,eq=brightness=-0.25:saturation=0.7"`), carried as `blurSrc`.
6. Thread `VisualAsset` (`steam.ts:15-23`), `EpisodeAssets.clips` (`episodes.ts`), `Services.fetchClips(app, dir, beats, budget)` (`pipeline.ts:53`), `RenderInput.clipFiles` (`render.ts:60`) and `ShortProps.clips` (`props.ts:24`). `gatherMedia` reuses `assets_json.steam.appId` instead of a second `findGame` and fails the episode back to `selected` with feedback when fewer than two visuals are found.

### 3.3 Shot plan and stills/clip alternation (`src/render/plan.ts` `planShots`)

```ts
interface Shot { start: number; end: number; segment: number;
  media: { type: "image" | "clip" | "plate"; index: number; trimFrom?: number; blurSrc?: string };
  move: "pushIn" | "pullBack" | "pushPan" | "driftDown"; framed: boolean; luma: number }
```

- Cut points: frame 12 (end of the opening sting), every segment start, then inside a segment every 2.6-3.6 s; every candidate snapped to the nearest word end within +/-6 f; minimum shot 45 f, maximum 130 f; target >= 14 cuts per minute and >= 18 visual events per minute including card lands and counter completions.
- Assignment by segment and card kind: hook gets the clip tagged hook (highest motion if untagged), full-bleed; `stat | date | timeline | compare | bar | score | price | countdown` beats get the clip tagged for that beat with motion below the median, or a still, rendered framed (a chart needs a quiet background); `list | changelog | quote | spec` beats get a still; reveal/trailer beats get full-bleed clips; take gets the hero still full-bleed with `pushIn`; loop and tail get the hero still returning to scale 1.06.
- Stills: aspect 1.4-2.0 (screenshots, 1920x1080 press shots) are cover-cropped with a focal-point pan along x over the shot (focal from sharp entropy or the vision `hasFace` flag); aspect > 2.2 (`library_hero` 1920x620) is always drawn in the `FramedFootage` panel over its pre-blurred plate; letterbox only below aspect 1.2. Stills under charts use the slow push 1.00 to 1.04 only.
- Anti-repeat: no asset in two adjacent shots, each still at most 2 uses, each clip 1 use (a second use only as a 1.4-2.0 s punch slice from a different `trimFrom`, max 2 per Short). If material runs out, lengthen shots to 4.8 s before recycling, then insert a `BrandPlate`; never pad with cards.
- `ArtTrack` renders `plan.shots[i]` inside `<Sequence from={start} durationInFrames={end - start}>` with `OffthreadVideo startFrom={trimFrom}` muted at rate 1.0, `FramedFootage` when `framed`, cut punch on every entry, `FootageCredit` whenever `media.type === "clip"`.

### 3.4 Allowed-footage rules per publisher (`src/assets/policy.ts`, extends the landed `footage.ts`)

Keyed by `app.details.publishers` and `developers` and by feed `publisher`. Enforced in `gatherMedia` (fail closed: nothing fits means stills only), verified by the rubric and recorded in `assets_json.footageSeconds` and `assets_json.rights[]` (`{file, sha256, publisher, source, seconds, used_in}`).

| Publisher | Cap per Short | Presentation | Notes |
|---|---|---|---|
| Rockstar / Take-Two | 6 s total | never full-bleed, always with a stated take | GTA VI rule; never pre-release or leaked material |
| Nintendo | 0 s clips | newsroom and Steam stills only | the 2024 guideline covers individuals, not company channels |
| Sony | 8 s | framed | no public creator policy |
| Ubisoft | 8 s | framed, never a contiguous trailer sequence | no duplication rule |
| Microsoft, Xbox Game Studios, Bethesda | 14 s | framed or full-bleed | mandatory notice line in the description |
| EA, Capcom, Square Enix, Sega, Bandai Namco, default | 14 s | framed or full-bleed | 4 clips of 4.8 s trimmed to 1.6-4.8 s shots |

Universal: Steam store art (hero, capsule, screenshots), official Steam trailers (muted) and first-party newsroom images from `official` feed items only; footage <= 35 % of runtime (news), 45 % (evergreen, each trailer <= 8 s across the Short), 25 % (long-form, each excerpt <= 10 s, never an unedited trailer sequence); no clip for rumours or any cluster matching `/leak|datamine|pre-?release|unreleased/i`; no anchor before the rating boards; 2 s lead-out before the end slate; never outlet photos, Reddit, stock or isolated cinematics. A Content ID claim seen in Studio drops that publisher to stills only for 90 days (the Data API does not expose claims to a non-partner channel, so the control is preventive plus a 24 h manual Studio check prompted by Discord for every Short over 60 s during the first month).

---

## 4. Implementation backlog

Each item: files, change, data dependencies, frames and timings, effort and acceptance check. Milestone 1 ships this week and needs no LLM schema change; every milestone leaves a renderable, tested state and the factory keeps publishing between them.

### Milestone 1 (ship this week, about 64 h): unblock, plan-then-render, premium frame without schema change

| # | Item | Files | Change | Data deps | Frames and timings | h | Acceptance |
|---|---|---|---|---|---|---|---|
| 1.1 | Unblock and preconditions | `.env`, `scripts/bench.mts`, `scripts/smoke.mts`, `package.json`, `windows/run.ps1`, `src/config.ts:153`, `src/render/render.ts:88-115`, `tests/render.test.ts`, `src/episodes.ts:152-158`, `pipeline.ts` `choosePublishAt` | Valid `ANTHROPIC_API_KEY`; one `DRY_RUN` episode to `published (dry_run)` kept as canonical v0 with a 6-frame strip (frames 0, 15, 45, 90, N-30, N-1); bench harness `npm run render:bench` printing wall time and fps; `REMOTION_CONCURRENCY` default `Math.max(4, floor(cpus/2))` (8 here), `x264Preset "faster"`, `jpegQuality 85`, one shared browser for `renderMedia` and `renderStill`; `REMOTION_GL=angle` opt-in only after a frame-hash determinism check on the smoke render, swangle otherwise; smoke render in the deploy gate; determinism grep test over `src/render`; `Europe/London` day boundary via `Intl.DateTimeFormat`; UTF-8 logs without BOM | none | | 9 | `data\episodes\<id>\short.mp4` exists; bench shows a 36 s Short under 2 min at c=8; `npm test` passes with the grep test; `run.ps1` rolls back on smoke failure |
| 1.2 | `RenderPlan` and shot planner | `src/render/plan.ts` (new), `pipeline.ts` `stepRender`, `props.ts` (`ShortProps.plan`), `Background.tsx` `ArtTrack` (consumes `plan.shots`, drops `mediaOrder` and `cuts.length`), `timeline.ts` (`shotTimes` replaced), `tests/plan.test.ts` | Pure `buildPlan(script, words, media, steamFacts, variant)` returning `{layout, shots, cards, captions, sfx, turns, loop, rubric}`; persisted in `assets_json.plan`; retries reuse it | segments, words, media list with motion and luma (defaults 0.5 and 128 until 2.2), storyType, variant | cut at frame 12, segment starts, 2.6-3.6 s intra-segment snapped +/-6 f; min shot 45 f, max 130 f; loop forces `shots[last].media === shots[0].media` at scale 1.06 | 10 | tests: bounds, snapping, anti-repeat, plate fallback with zero media, identical output for identical inputs, GTA cap |
| 1.3 | Layout bands, banded scrim, `FramedFootage`, pre-blur, `BrandPlate` | `src/render/layout.ts`, `brand.ts`, `Overlays.tsx:17,36-80`, `Background.tsx:56-93,174-181`, `components/Footage.tsx` (new), `steam.ts` `fetchSteamArt`, `pipeline.ts` `gatherMedia`, `render.ts` (`blurSrc`) | `SAFE` imported from `layout.ts`; TopBar to y 150, right edge 1016; progress bar becomes the wire-band rail; scrim profiles; framed panel for aspect > 2.2 and for framed shots; focal pan for 1.4-2.0; `.blur.jpg` plates written at fetch time; `MotionField` orbs removed, `BrandPlate` only for plate shots; live `blur()` and `backdropFilter` removed | `blurSrc` per asset | panel POP 12 f plus 24 px rise; push 1.00 to 1.04 over the shot | 8 | contact sheet shows nothing in y 0-150 or 1620-1920, no 381 px hero strip, footage visible through the shelf; bench time does not rise |
| 1.4 | Evidence shelf v1 | `components/Shelf.tsx` (new), `Short.tsx` (mount per beat and take Sequence), `plan.ts` `shelfFor`, `props.ts` (`steam` facts object replaces `steamStat`), `pipeline.ts` (pass `assets_json.steam.facts`) | `SourceChip`, `DataCallout`, `GameCard`, `LiveTicker`, `ProgressRail` with the four-level fallback chain | Steam facts, capsule image (`library_600x900` fetched in `fetchSteamArt`), attribution | enter 6 f after the card, ENTER 18 f, min hold 45 f, exit 8 f, never two within 20 f | 8 | rubric shelf occupancy >= 0.85 on canonical v0 script; LiveTicker label 28 px |
| 1.5 | Loop close and brand sting | `components/LoopClose.tsx` (new), `Short.tsx:36-51`, `pipeline.ts:237` (tail 0.6 to 1.0 s), `public/sfx/sting.mp3` and `sting.json`, `voice/index.ts` `polishVoice` | Callback card, sting at 0-12 and N-12..N, bed held at 0.20 with 15 f crossfade into its own head, captions blank for the last 6 f, voice tail trimmed to 6 f after the last word, leading silence trimmed (`silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05`) | hook key fact from the plan, related episode id (optional) | callback 20 f; rule draw 10 f; logo tile 1.0 to 1.08 to 1.0 over 6 f | 6 | `loopSeam` SSIM >= 0.9 (frame 0 vs N-1, caption band masked); word 1 at frame 0-3 in the alignment |
| 1.6 | Motion tokens, exits, cut punch, flash discipline | `motion.ts` (new), `Overlays.tsx` (`HookHeadline`, `FactCard`, `LiveStat`, `LowerThird` take `durationInFrames`), `Background.tsx` `ArtTrack`, `Overlays.tsx:204` (`useVideoConfig().fps`) | Exits over the last 8 f; incoming shot 1.03 to 1.00 over 5 f; `CutFlash` only at `plan.turns`; word stagger 2 f | plan.turns | as section 1.4 | 4 | strip at segment start +18 shows settled cards; no flash on intra-segment cuts |
| 1.7 | Brand bar, lower-third, footage credit, SFX cue list, duck envelope | `Overlays.tsx:25-88` (`TopBar`, new `LowerThird`), `Background.tsx` (`FootageCredit`), `Short.tsx:89-109` (one `map` over `plan.sfx`), `pipeline.ts` `videoMetadata` | Lockup Anton 46 plus chip Inter 900 30 at y 150-222; source rows at y 232-300; credit tag during clips; "Footage:" block and Microsoft notice in the description; attack 2 f release 9 f envelope; cue cap 6 | `assets_json.rights[]` (from 2.2; until then publisher from `app.details`) | rule 8 f then wipe 14 f staggered 4 f | 5 | cue count <= 6 in the plan; description contains the credit block when clips were used |
| 1.8 | Captions v2 | `timeline.ts` `pageCaptions`, `srtFromWords`, new `emphasisTokens`; `Overlays.tsx` `Captions`; `pipeline.ts` `addCaptions` (quota check) | 10 f floor with merge-forward, 16 chars per line, 2 lines, punctuation stripped for display, regex emphasis, ink pill on luma > 0.55, POP from 0.92, never before start - 50 ms; SRT phrase cues 32 chars per line, 1.0-5.0 s, 17-20 cps; skip caption upload below 500 units | words, plan.shots luma | as section 2.4 | 4 | `tests/units.test.ts` paging and SRT bounds; caption gaps > 2 s = 0 on canonical v0 |
| 1.9 | Structural rubric v1 | `src/qa/rubric.ts` (new), `pipeline.ts` `stepRender` (before `s.render`), `qa/media.ts` (`loopSeam`, `ebur128` readback), `tests/rubric.test.ts` | Metrics from the plan: first word <= 0.10 s, hook words 8-14, event density, beat awareness, shelf occupancy, unique media / shots, max still repeat, adjacent same-kind cards, caption gaps and short pages, footage seconds vs cap, SFX cues, duration integrity; green / amber / red; red rebuilds the plan with a new variant seed once then `FatalError`; ambers logged in `qa_json.rubric` | plan | | 5 | a plan with a 3x repeated still is rejected before render; canonical v0 script scores green |
| 1.10 | Analytics capture v1 | `migrations/002_lanes.sql` (`video_metrics`, `episodes.lane`, `format`, `priority`, `variant`, `related_episode_id`), `src/analytics/snapshots.ts` (new), `server.ts` (third interval) | Snapshots at +1 h, +3 h, +24 h via `videos.list part=statistics` (1 unit) and +72 h, +7 d, +28 d via `youtubeanalytics reports.query` with `views, engagedViews, estimatedMinutesWatched, averageViewDuration, averageViewPercentage, likes, comments, subscribersGained`; curve `elapsedVideoTimeRatio` / `audienceWatchRatio` at +72 h and +7 d stored as JSONB when available; `variant` (hash of episode id) logged | `yt-analytics.readonly` scope (already granted) | | 6 | first upload has a +1 h row; curve row present or `curve_unavailable` logged |

### Milestone 2 (weeks 2-4, about 110 h): beat-aware media, archetypes, lanes, safeguards

| # | Item | Files | Change | Data deps | Frames and timings | h | Acceptance |
|---|---|---|---|---|---|---|---|
| 2.1 | Editorial schema extension and guards | `schema.ts`, `editorial.ts:43-57,163-185`, `src/editorial/titles.ts` (new), `src/voice/pronounce.ts` (new), `tests/units.test.ts` | Fields from 3.1; `review_scores` and `hardware`; AI-tell regexes (`here's where it gets interesting`, `you won't believe`, `this changes everything`, `let that sink in`, `game-changer`), hook <= 12 words with one named entity, take >= 12 words and Jaccard < 0.5 against the hook, CTA <= 4 words, plain-news title detector, story-type title formulas (game name first, <= 60 chars, no hashtags, no "leak" unless the story is an official statement about one), advertiser-unfriendly list (extend `BANNED_PHRASES` with the `PENALTY` tragedy and violence terms) across title, description, tags and narration; pronunciation map; `angle` required; per-tier word bands; over-length narration routes back to `selected` once with feedback | | | 12 | fixture scripts with each violation are rejected with a named reason |
| 2.2 | Clip descriptors, candidate scoring, vision ranking, policy module, rights ledger | `steam.ts:207-293`, `src/assets/clipscore.ts` (new), `src/assets/policy.ts` (extends `footage.ts`), `pipeline.ts` `gatherMedia`, `episodes.ts`, `render.ts`, `props.ts`, `tests/clipscore.test.ts` | Section 3.2 and 3.4; `CLIP_RANKING` switch; persisted descriptors; `asset_rights` rows; rumour and leak regex block | beats' `footage`, publisher names | 4.8 s grabs, 1.5 s candidate step | 20 | fake `fetchClips` test covers cap arithmetic and stills-only fallback; a GTA story carries <= 6 s; an episode's clips carry `beatIndex` and `reason` |
| 2.3 | Shot planner v2 | `plan.ts` | Beat-tagged assignment, motion-aware framing, punch slices, ink-pill luma | descriptors from 2.2 | as 3.3 | 4 | beat awareness >= 0.6 and unique media / shots >= 0.85 on three real episodes |
| 2.4 | Archetype registry and first six data components | `src/render/layouts.ts` (new), `components/data/{DataCallout,BarCompare,Timeline,PriceTag,Ring,Calendar}.tsx`, `components/Cards.tsx` (`FactCard` split), `Short.tsx` dispatch, `plan.ts` `cardDataFrom`, `tests/layouts.test.ts` | Section 2.2 and 2.5; proof within 15 f of the cue word; captions-first rule for numbers | beat fields, `props.steam`, render date as a prop | per component table | 28 | every story type yields a layout; `cardDataFrom` falls back to title; each component renders in the smoke composition under 200 nodes |
| 2.5 | Text fitting and timeline robustness | `package.json` (`@remotion/layout-utils@4.0.536`), `Overlays.tsx:107,167,178,230`, `timeline.ts:36-51` `buildSegments` | `fitText` for headline, stat, take box and card titles with floors; token-normalised alignment (strip punctuation, lower-case, one-to-many splits for numerals and hyphens), drift log, proportional fallback when drift > 15 f, assert the last segment's first word was found | | | 6 | hyphenated and numeral test cases; any fitted size below floor is an amber |
| 2.6 | Lanes migration, gates, discovery poll, breaking path, slots, quota ledger, doctor | `migrations/002_lanes.sql` (extend 1.10: `cluster_sightings`, `breaking_log`, `quota_ledger`, `lane_plan`, `topics_covered`, `video_fingerprints`, `asset_rights`), `pipeline.ts:84-114,339-353,501-524`, `server.ts:63-70,179-229`, `src/discovery/cluster.ts`, `src/discovery/feeds.ts:12-29`, `src/lanes/` (new), `src/cli.ts` (`doctor`), `tests/lanes.test.ts` | Section 5 | | | 30 | per-lane gates tested; breaking cooldown and idempotency tested; quota deferral tested; `doctor` fails on a bad key and pauses selection |
| 2.7 | Near-duplicate stack | `pipeline.ts` `maybeSelect`, `src/qa/fingerprint.ts` (new, dHash via ffmpeg `scale=9:8,format=gray`), `episodes.ts` | Story hash 7-14 day window plus headline token overlap >= 0.6 over the last 14 days (allowed only for `update` with new claims); title Jaccard >= 0.7 against the last 60 uploads forces a rewrite; poster, first and last frame dHash with Hamming < 8 against 30 days rejects before upload; `app_id + story_type` 72 h cooldown; cross-lane 48 h rule; `findByMarker` paged to 50 | | | 8 | fixtures for each layer |
| 2.8 | Vision QA update | `qa/vision.ts`, `pipeline.ts:274` | Prompt adds shelf not empty during beats, footage matches `footage.want`, lockup at y 150-222, no two display sizes, brand amber present; sampling adds two 540 px shelf-band crops | | | 2 | prompt test fixture |

### Milestone 3 (weeks 5-10, about 150 h): remaining components, evergreen, long-form, tiers, variants

| # | Item | Files | Change | Data deps | Frames and timings | h | Acceptance |
|---|---|---|---|---|---|---|---|
| 3.1 | Remaining data components | `components/data/{Changelog,SplitScreen,TrendLine,SpecSheet,PictureInPicture,QuoteCard,GameCard}.tsx` | Section 2.5 | | per table | 18 | each renders in the smoke composition |
| 3.2 | Length tiers | `editorial.ts:18-19`, `pipeline.ts:172`, `qa/media.ts:72-85` | Per-tier word bands and caps; `technicalQa` takes `{width, height, minSeconds, maxSeconds}`; tier L gated on analytics | `video_metrics` | | 5 | tier M episode of 55 s passes; tier L refused until the gate is met |
| 3.3 | Evergreen lane | `src/editorial/evergreen.ts` (new), `src/lanes/plan.ts` (weekly plan), `services.ts` (`discoverEvergreen`), `components/data/RankingLadder.tsx`, series chip in `TopBar`, `tests/evergreen.test.ts` | Section 5.2 | Steam top sellers, most played, coming soon, anniversaries | entry: rule, badge POP, card ENTER, chip SNAP, wipe 12 f | 36 | first evergreen Short renders with 6-8 entries, footage <= 45 %, publisher caps summed |
| 3.4 | Long-form lane | `src/render/Root.tsx` (`PulseLong` 1920x1080, `PulseThumb` 1280x720), `render.ts` (composition id and size), `qa/media.ts`, `src/editorial/longform.ts`, `pipeline.ts` `videoMetadata` (chapters, no `#Shorts`, playlists via `playlistItems.insert`, `thumbnails.set`), 16:9 variants of `LowerThird`, `FramedFootage` 1600x900, `ChapterCard` | Section 5.3 | the week's published episodes or an evergreen theme | | 44 | a 6 min briefing renders overnight within the long-form window without blocking a Short |
| 3.5 | Variants and digest | `plan.ts` (variant-driven defaults: two-tier caption strip, ticker, hook headline position), `src/analytics/digest.ts`, `src/analytics/retention.ts` (`retentionBySegment`) | Mechanical A/B by `variant`; weekly Discord digest with top and bottom 5 by S0 and AVP, segment drop leaders, variant comparison with sample sizes; `performanceNotes` into `selectStory` and `scriptPrompt` only after 40 uploads per cell, bounded to advice | `video_metrics` | | 14 | digest posts on Monday 09:00 UK; decision table empty until cells reach 40 |
| 3.6 | Diagram atoms (industry and update stories, optional explainer lane) | `components/diagram/{Rails,MorphCard,EvidenceMap,Ladder}.tsx` | Hairline rails, morph card 0.55 to 1.46 over 30 f, self-drawing rails 0.52 s with 5 f stagger, cadence ladder lit on word cues; reveal across the segment, end on a hold, nothing below the caption band | | | 12 | used by at least one industry archetype |
| 3.7 | Tests consolidation | `tests/*.test.ts` | Plan, rubric, layouts, lanes, fingerprint, evergreen, pipeline fakes per lane | | | 12 | `npm test` green, smoke render only when `RENDER_TESTS=1` |

Explicitly rejected for risk or noise: 4K vertical renders, presenter avatar, LLM calls inside the composition, live CSS blurs and `backdropFilter`, `@remotion/effects` light leaks, node-canvas light-leak plates, chromatic aberration, `@remotion/transitions` wipes, whoosh on every cut, full-screen end cards and subscribe mimicry, flashing caption colours, speed ramps (deferred to a split-Sequence variant after Milestone 3), Reddit sources and stock imagery, parallel renders, raising the narration cap before Milestone 1 is live, date-stamped roundups without an angle, hashtag-stuffed titles.

---

## 5. Multi-lane factory

### 5.1 Lanes and scheduling model

| Lane | Format | Composition | Cadence | Slots (Europe/London) | Length | Priority | Approval |
|---|---|---|---|---|---|---|---|
| `news_breaking` | news Short | PulseShort | as stories break, cap 2/day at launch (3 after the quota extension) | immediately between 07:00 and 23:00, else held to 07:00 unless score >= 95; >= 45 min after the last Short | tier S/M | 100 | timeout 20 min for the first 20 published Shorts; then auto when official plus fact-check pass plus rubric green plus not rumour, with a 15 min Discord veto |
| `news` | news Short | PulseShort | 2/day at launch, 3 after the extension | 12:00, 16:00, 19:30 (first free slot; produced Shorts wait privately with `publishAt`) | tier S/M | 50 | timeout 30 min |
| `evergreen` | ranking, wishlist, versus, "N years later", best per year | PulseShort with `RankingLadder` | Tue, Thu, Sat; 1/day once analytics support it | 19:00 | 75-120 s (tier L rules) | 30 | manual for the first 10, then timeout 120 min |
| `roundup` | "Gaming news, week N of 52" | PulseShort | Sundays | 17:00 | 90-150 s | 25 | timeout |
| `longform` | top-10, briefing, weekly news show | `PulseLong` 16:9 | 1/week (Fri briefing), fortnightly top-10 (Sun) | 17:00 Fri, 15:00 Sun; renders only in the 01:00-06:00 window | 6-14 min | 10 | manual |

Channel rules: `SHORTS_PER_DAY_MAX=4` until the YouTube quota extension is granted (2 news plus up to 2 breaking, evergreen counted within the 4), 6 after; `MIN_UPLOAD_GAP_MINUTES=60` across Short lanes (breaking may shorten to 45); long-form never within 2 h of a Short; `notifySubscribers` true only for breaking and long-form.

Mechanics: two clocks, one producer.

- `discoverTick` every 3 min under lease `discover` (4 min TTL): fetch feeds (official feeds added for Nintendo, Steam News, Rockstar Newswire, Bethesda, Ubisoft, EA, Epic, Capcom, Square Enix, Sega, Bandai Namco, Sony Interactive newsroom, each with a `publisher` tag), cluster, upsert `cluster_sightings(hash, first_seen, last_seen, item_count, has_official, max_score, velocity)`. No LLM calls. `maybeSelect` reads sightings and never refetches. `StoryCluster` gains `firstSeenAt`, `ageMinutes`, `velocity` (items per hour) and `breaking`; decay is relative to `first_seen`.
- `produceTick` every 5 min under lease `produce` (45 min TTL): `maybeSelect(news_breaking)`, then `maybeSelect(news)`, then `maybeSelectEvergreen` (plan-driven), then `maybeSelectLongform` (01:00-06:00 only); then `dueEpisodes ORDER BY priority DESC, created_at ASC`, each advanced up to 10 steps. Production is strictly sequential: one Chromium render, one VoxCPM job; `Services.render` is wrapped in an in-process mutex and the CLI refuses to run a tick while the server holds the lease. PGlite is single-process; a second worker would need `DATABASE_URL` Postgres.
- Gates (replacing `pipeline.ts:84-114`): producing count (`selected | scripted | voiced | rendered`) <= 2 across Short lanes; waiting states never block; `countToday(lane)` in Europe/London; `MIN_GAP_MINUTES` per lane (news 120, breaking 45, evergreen 0); `SELECT_FROM_HOUR` per lane (news 08:00, breaking none).
- Breaking criteria: `hasOfficial && ageMinutes <= 90 && score >= 70 && (velocity >= 2 || publisher in TOP_PUBLISHERS)`, or `velocity >= 3 && item_count >= 2 && ageMinutes <= 120`; rumours are never breaking; 2 h per-franchise cooldown from `breaking_log`; idempotent on `story_hash`; `choosePublishAt` returns now inside the window. Time-to-publish target 40 min from first official sighting. If clips are not ready within 90 s the plan proceeds stills-only. A second corroboration check at publish time (`item_count >= 2 || hasOfficial`).
- Capacity: a 60 s Short costs about 10-13 min of machine time at c=8; five Shorts a day is about one hour. A 10 min 16:9 render is 25-40 min and stays in the night window.
- Quota: upload 1,600 plus caption insert 400 plus list 50 plus polls about 6 plus marker 2 is about 2,060 units per video, so 4 uploads fit in 10,000 and 5 do not. `quota_ledger(day, units)` is incremented by every call with its unit cost; selection never runs ahead of the day's remaining budget; uploads defer to the next day below 2,100 remaining; captions skip below 500. File the extension request in Google Cloud Console in parallel.
- Weekly plan (`src/lanes/plan.ts`, Sunday 06:00): picks the franchise cluster for the week's evergreen run (Pt.1/Pt.2 continuations, each Short's "UP NEXT" pointing at the next via `related_episode_id`), the top-10 theme and the briefing date; writes `lane_plan`; posts to Discord with a 12 h veto window.
- Ops: `cli doctor` at boot (Anthropic key, YouTube refresh token via `tokeninfo`, Data API key, local TTS, ffmpeg, disk >= 10 GB, quota ledger) pauses selection without stopping in-flight uploads; `/health` and the dead man's switch per lane (news 26 h, evergreen 4 days, long-form 9 days); the daily 04:00 restart waits for any lane mid-production; `pruneMedia` keeps long-form masters 30 days; the related-video chip is Studio-only, so the Discord publish embed carries the suggested long-form id.

### 5.2 Editorial rules per lane

- Shared guards (Milestone 2.1) apply to every lane. `angle` required everywhere.
- News and breaking: `ScriptSchema` extended per 3.1; story-type title formulas ("[Game] Delayed To [Window]", "[Game] Price Confirmed: [figure] [region]", "[Game] Reviews Are In: [score]", "[Game] Update [version]: What Changed", "[Game] Revealed: [one fact]"); selection allows review-day aggregates (OpenCritic and Metacritic figures are public facts); breaking uses `effort: medium` for script and fact-check; `performanceNotes` only after 40 uploads per cell.
- Evergreen: `EvergreenScriptSchema {format, game_or_franchise, title, hook, entries[6-10] {rank, game_title, steam_search_term, year, platforms, one_line <= 18 words, verdict_chip <= 4 words, visual, footage}, pulse_take (the stated criterion), loop_line, series {name, part, next_hint}, youtube, claims}`; 165-300 words; every entry's facts (release year, review %, price, players) come from `steamFacts` per entry and the fact-check runs against store data; title templates "The BEST [franchise] game for every year", "Ranking EVERY [franchise] [thing]", "[A] vs [B]: which holds up in 2026", "[Game]: N years later", "Is [Game] still good in 2026"; sources are Steam top sellers, `GetMostPlayedGames`, the coming-soon calendar, anniversaries and the channel's own best performers.
- Roundup: aggregated from the week's `published` news episodes with their `claims[]` reused as the fact base; title "Gaming news, week N of 52".
- Long-form: `LongformScriptSchema {title, hook, chapters[6-12] {title, beats[3-6], items[]}, pulse_take, outro, chapter_cards, youtube}`; 1,200-2,000 words; chapters emitted as `0:00 Title` lines from segment timings (first at 0:00, >= 3 chapters); description lists platforms and release dates per entry plus the Sources block; fact-check per chapter.
- Explainer (optional, Milestone 3.6): BRIEF to six-line SCRIPT to STORYBOARD to per-frame component; original diagrams only; manual until 10 clean.

### 5.3 Asset rules per lane

| Lane | Allowed | Caps | Not allowed |
|---|---|---|---|
| news, breaking | Steam store art, official Steam trailer clips (muted, 4.8 s grabs trimmed to 1.6-4.8 s shots), first-party newsroom images from `official` items | 14 s default per Short with the publisher table (3.4), <= 4 clips, <= 35 % of runtime; rumour and leak clusters 0 s | outlet photos, leaked or pre-release material, Reddit, stock, isolated cinematics, trailer duplication |
| evergreen | per entry: capsule as the `GameCard` identity, hero, up to 2 screenshots, 1 trailer clip <= 4 s | publisher caps summed per video; each trailer <= 8 s across the Short; footage <= 45 % of runtime | pre-release footage of unannounced content, third-party captures |
| roundup | the week's episode assets reused by reference | as news per story | new sourcing |
| longform | trailer excerpts framed in a 1600x900 panel with commentary, store screenshots, original charts and diagrams, publisher press kits | each excerpt <= 10 s, <= 20 s per chapter, footage <= 25 % of runtime, publisher caps per video (Rockstar 6 s total) | unedited trailer sequences, isolated cinematics |
| explainer | original diagrams only | none | any third-party asset |

Shared: clips always muted; owned music beds with a rights JSON (origin, sha256) per bed; `asset_rights` ledger rows per clip; on-screen `FootageCredit`; "Footage:" block, Microsoft notice and disclosure line in every description; `containsSyntheticMedia: true`; category 20; `defaultLanguage` and `defaultAudioLanguage` en-GB; private-first then `publishAt`.

### 5.4 Safeguards

- Copyright: publisher table enforced in `gatherMedia` and verified by the rubric (fail closed to stills); no clip fetch for rumours or clusters matching the leak regex; trailer windows never inside rating boards; Shorts over 60 s only with zero third-party audio (owned beds and muted clips make this structural); Content ID is preventive plus a 24 h manual Studio check prompted by Discord for every Short over 60 s in the first month; a claim drops that publisher to stills only for 90 days.
- Monetisation: advertiser-unfriendly validator across title, description, tags, narration and on-screen text; `PENALTY` tragedy terms stay at -60 in selection; rumours labelled in title, chip and description and never auto-published; vision QA keeps the imagery check; API readback of title, description, tags, category, languages, privacy, publish time and caption presence after `processed`, logged as `events.readback` with a Discord alert on mismatch.
- No near-duplicate uploads: the four-layer stack in 2.7 plus `topics_covered` cooldowns (180 days per evergreen topic, 365 days for the same format on the same franchise); evergreen franchise runs are deliberate but each Short has a distinct format key.
- Reliability: per-lane leases and dead man's switches; `FatalError` taxonomy unchanged; retry from the furthest artefact extended with the persisted plan so a retried render is byte-identical; smoke render in the deploy gate; VoxCPM cold-start wait (exists); disk and quota budgets; events carry `lane`, `layout`, `tier`, `variant` and a rubric summary.

---

## 6. QA and measurement

### 6.1 Automated checks per render

Pre-render (`src/qa/rubric.ts`, from the plan, zero cost):

| Metric | Green | Reject |
|---|---|---|
| headline fully rendered at frame 0 | yes | no |
| first spoken word start | <= 0.10 s | > 0.30 s |
| hook words | 8-14 | > 18 |
| spoken WPM | 130-175 | outside 115-190 |
| AI-tell regex hits | 0 | >= 1 |
| event density per minute (cuts, card lands, counter completions, shelf changes) | >= 18 | < 12 |
| cuts per minute | >= 14 | < 10 |
| beat awareness (cuts within +/-6 f of a word end) | >= 0.6 | < 0.4 |
| shelf occupancy | >= 0.85 | < 0.6 |
| unique media / shots | >= 0.85 | < 0.6 |
| clip frames / shot frames when clips exist | 0.40-0.70 | n/a (amber outside) |
| max still repeat | <= 2 | >= 3 |
| adjacent same-kind cards | 0 | >= 1 |
| two display-size texts co-visible | 0 | >= 1 |
| caption gaps > 2 s | 0 | >= 2 |
| caption pages < 10 f | 0 | >= 3 |
| footage seconds vs publisher cap | within | over |
| footage share of runtime | within lane cap | over |
| SFX cues | <= 6 | > 6 |
| fitted text below floor | none | n/a (amber) |
| duration integrity (render >= narration >= last caption) | yes | no |

Red rebuilds the plan with a new variant seed once, then `FatalError`. Ambers pass and are stored in `qa_json.rubric` for correlation.

Post-render (`src/qa/media.ts`): existing technical QA parameterised by lane; `loopSeam` SSIM >= 0.9 (frame 0 vs N-1, y 1180-1460 masked); `ebur128` readback after `loudnorm`, fail if integrated loudness is outside -15 to -13 LUFS or true peak above -1.0 dBTP; music lift in gaps not above -18 LUFS momentary; transient-recurrence check (`astats` 100 ms windows, 18-bin RMS signatures, cosine similarity >= 0.965 across >= 5 windows fails); dHash of poster, first and last frame against 30 days; contact sheet strip at frames 0, 15, 45, 90, every segment start +18, N-30 and N-1 attached to the Discord approval message.

Pre-upload: readback contract (5.4), rights ledger complete for every clip used, description contains the credit block and disclosure line, title passes `titles.ts`.

### 6.2 Vision QA prompts

`qa/vision.ts` (one `llm.structured` call, effort low, samples at segment starts +0.6 s plus two 540 px shelf-band crops):

```
You are checking a 1080x1920 gaming news Short frame set for Pulse Gaming News. Answer as JSON.
For each frame report: brandLockupVisible (PULSE. lockup within y 150-222), amberPresent, headlineLegible,
textOverlapsPlatformUi (anything essential in y 0-150, y 1620-1920 or x 930-1080 below y 1000),
shelfEmptyDuringBeat (y 900-1180 blank while the beat caption shows), twoDisplaySizesVisible,
footageMatchesHint (given the beat's footage.want and keywords), faceOrHandArtifact, watermarkOrRatingBoard,
textOverflowOrClipping, advertiserUnfriendlyImagery, captionLegibility (1-5 on the plate behind y 1180-1460).
Then overall: verdict pass | downgrade | reject, reasons[] (one line each, cite the frame index).
Reject on: platform UI overlap, watermark or rating board, advertiser-unfriendly imagery, text overflow, missing lockup in more than one frame.
```

For evergreen and long-form the prompt adds: rank badge and game card present on every entry frame; chapter card legible at 1920x1080 at 50 % scale.

### 6.3 Analytics feedback loop

- Capture (Milestone 1.10): `video_metrics(episode_id, label, captured_at, views, engaged_views, watch_minutes, avd_seconds, avp, likes, comments, subs, curve JSONB, raw JSONB, UNIQUE(episode_id, label))` at +1 h, +3 h, +24 h (`videos.list`), +72 h, +7 d, +28 d (`reports.query`); the retention curve at +72 h and +7 d when YouTube returns it (it lags 2-3 days and needs a minimum view count; the first upload verifies availability for Shorts on this channel and the plan tolerates its absence).
- Stage metrics and targets (hypotheses, not tuned): S0 curve at ratio 0.05 >= 0.75; S1 at 0.20 >= 0.65; S2 no beat drops more than 8 points; S3 AVP >= 85 % at <= 45 s and >= 70 % at 60-90 s; S4 AVP > 100 % on at least 30 % of uploads and `engagedViews / views`.
- `retentionBySegment(curve, segments)` maps the 100-point curve onto hook, beats, take and loop spans and stores the drop per segment; join keys from `events`, `script_json` and `qa_json.rubric` (story_type, lane, tier, archetype, variant, beat kinds, clip count, hook word count, rubric ambers).
- Mechanical A/B by `variant` (two-tier caption strip, ticker, shelf default, hook headline position): decisions only at >= 40 uploads per cell. Tier L and 1-per-day evergreen unlock only when tier M AVP >= 70 % over 40 uploads.
- Weekly Discord digest (Monday 09:00 UK): lanes and counts, rubric averages, quota used, top and bottom 5 by S0 and AVP, segment drop leaders, variant comparison with sample sizes, Studio reminders (related-video chip, Content ID check for Shorts over 60 s).
- Feedback into editorial: `performanceNotes` (top and bottom 5 by AVP with story_type, game and hook pattern) into `selectStory` and `scriptPrompt` as bounded advice; `HOT_TERMS` adjustments bounded to +/-15 in `settings`; never a hard rule derived from analytics.

### 6.4 Risk register

| Risk | Mitigation |
|---|---|
| Retention curves absent for low-view Shorts for months | capture from upload one, tolerate missing curves, decide on AVP and S0 proxies first, keep stage targets as hypotheses |
| VoxCPM instability on long takes | takes capped at 36 words; tiers add takes, not longer takes; `elevenlabs-first` must emit the same `Word[]` |
| Render time growth with charts and framed footage | pre-blur at asset time, SVG only, c=8, `faster` preset, bench in the deploy gate, rubric rejects before render |
| LLM schema drift on new fields | flat optional fields, `cardDataFrom` fallback to title, Steam facts as data |
| Clip fetch slow or failing | stills-only plan after 90 s for breaking, plate fallback, rubric amber not red when no clips |
| YouTube quota at 4-6 uploads/day | ledger, deferral, caption skip, extension request, 4/day until granted |
| `gl: angle` output differing between retries | opt-in only after a frame-hash determinism check; swangle default |
| PGlite single process | one producer, in-process mutex, CLI refuses while the server lease is held |
| Steam app mismatch between script and render | persist and reuse `appId` |
| Word-alignment drift | token-normalised mapping with drift assertion and proportional fallback |
| Duplicate uploads across retries or lanes | marker tag, `story_hash UNIQUE`, title and headline overlap, dHash fingerprints, cross-lane 48 h rule |
| Early auto-publish of a weak breaking Short | timeout approval for the first 20 publishes, rubric green required for auto thereafter |
