# Frame packet: 03-velocity-samples

## Project inputs

- Project: D:\pulse-worktrees\system-trace-display-20260820\videos\system-trace-motion-blur
- Design tokens: D:\pulse-worktrees\system-trace-display-20260820\videos\system-trace-motion-blur\frame.md
- RULES_DIR: C:\Users\MORR\.agents\skills\hyperframes-animation\rules

## Assigned storyboard block

## Frame 3 - The game estimate

- scene: Per-pixel arrows drive an original sample-and-blend rail along a moving object's direction.
- voiceover: "Games often estimate the same path with per-pixel velocity, then sample and blend colour along the direction of travel."
- duration: 9.2s
- poster: 6.2s
- transition_in: crossfade
- status: outline
- src: compositions/frames/03-velocity-samples.html
- type: feature_showcase
- persuasion: Process map
- beat: Clarity
- blueprint: fixed-anchor-cycle (Adapt)
- focal: VELOCITY VECTOR feeding SAMPLE AND BLEND
- roles: pixel arrows = foreground mechanism · sample rail = foreground proof · colour dots = supporting · dark grid = background
- source_trace: NVIDIA GPU Gems motion-blur post-processing technique, velocity vector sampling and averaging
- sfx: none

Scene 1 (0.0-3.0s): In a top-83% grid, a moving square exposes per-pixel arrows through SVG self-draw (`svg-path-draw`) as "per-pixel velocity" is spoken.

Scene 2 (3.0-6.3s): On "sample and blend", colour samples travel in deterministic sequence via dynamic-content-sequencing (`dynamic-content-sequencing`) and merge into one fire-orange trail using motion-blur streak (`motion-blur-streak`).

Scene 3 (6.3-9.2s): VELOCITY VECTOR / SAMPLE AND BLEND enters by per-word staggered reveal (`dynamic-content-sequencing`), then the completed top-83% trail holds still.

narrativeRole: Explains the common real-time mechanism behind the visual streak.
keyMessage: A velocity-based pass can sample and blend along estimated motion.

## Selected motion rule: dynamic-content-sequencing

---
name: dynamic-content-sequencing
description: Auto-calculate timeline start/end times from content length + per-item duration config — longer content gets more screen time without hardcoded numbers.
metadata:
  tags: timeline, sequencing, dynamic, duration, content-aware, utility
---

# Dynamic Content Sequencing

A utility pattern (not a motion rule in itself) for scenes that show a SEQUENCE of items (cards, phrases, stats): each item's duration is computed from its content length + per-item config, and the sequencer assigns absolute start/end times automatically — no hardcoded offsets per item. Distinct from [discrete-text-sequence](discrete-text-sequence.md) (one text element changing states) — this rule swaps between distinct content blocks.

## How It Works

A content array of `{ eyebrow, title, body, speedFactor, hold }` entries is reduced once at build time into a flat `TIMELINE` of `{ …entry, start, end }` — duration per entry is `BASE_DURATION + body.length × SEC_PER_CHAR + hold`, so longer text earns more reading time. A single linear driver's `onUpdate` reverse-searches the active entry and swaps the DOM **only on transitions** (a `lastTitle` guard — per-frame `textContent` writes flicker in render); an optional progress bar fills 0→100% across the whole run.

## Recipe

```html
<!-- inside a standard scene clip (hyperframes-core) -->
<div class="display">
  <div class="eyebrow" id="eyebrow"></div>
  <div class="title" id="title"></div>
  <div class="body" id="body"></div>
  <div class="progress-bar"><div class="progress-fill" id="progress-fill"></div></div>
</div>
```

```css
.body {
  min-height: 160px; /* reserve space — content height varies; without this, layout jumps */
}
.progress-fill {
  height: 100%;
  width: 0%;
}
```

```js
// N entries, each with its own pacing (optionally a speedFactor multiplier);
// the final entry uses a larger hold (closing beat).
const CONTENT = [
  { eyebrow: "{eyebrow1}", title: "{title1}", body: "{body1}", hold: HOLD_MID },
  // …
  { eyebrow: "{eyebrowN}", title: "{titleN}", body: "{bodyN}", hold: HOLD_FINAL },
];

// Pre-compute absolute start/end ONCE — never in onUpdate.
let cumulative = 0;
const TIMELINE = CONTENT.map((entry) => {
  const dur = BASE_DURATION + entry.body.length * SEC_PER_CHAR + entry.hold;
  const start = cumulative;
  cumulative += dur;
  return { ...entry, start, end: cumulative };
});

function entryAt(time) {
  for (let i = TIMELINE.length - 1; i >= 0; i--) {
    if (time >= TIMELINE[i].start) return TIMELINE[i];
  }
  return TIMELINE[0];
}

const eyebrowEl = document.getElementById("eyebrow");
const titleEl = document.getElementById("title");
const bodyEl = document.getElementById("body");
const progressEl = document.getElementById("progress-fill");

const TOTAL_DURATION = cumulative + TAIL_PAD;
const driver = { t: 0 };
let lastTitle = "";

tl.to(
  driver,
  {
    t: TOTAL_DURATION,
    duration: TOTAL_DURATION,
    ease: "none",
    onUpdate: () => {
      const entry = entryAt(driver.t);
      // Swap content only on transitions — no per-frame DOM thrash
      if (entry.title !== lastTitle) {
        eyebrowEl.textContent = entry.eyebrow;
        titleEl.textContent = entry.title;
        bodyEl.textContent = entry.body;
        lastTitle = entry.title;
      }
      progressEl.style.width = `${(driver.t / TOTAL_DURATION) * 100}%`;
    },
  },
  0,
);
```

## Variations

- **Crossfade between items** — return BOTH adjacent entries during an overlap window (`time ≥ e.start − overlap && time ≤ e.end + overlap`, overlap ≈ 0.3s) and render them with opacities computed from distance to the boundary.
- **Per-item motion variation** — map an `entry.style` key to an existing rule per chapter (e.g. `3d-text-depth-layers` → `hacker-flip-3d` → `counting-dynamic-scale`); the sequencer only orchestrates timing.
- **Auto-extend composition duration** — you can set `data-duration` from the computed `TOTAL_DURATION` in script, but HF reads `data-duration` at composition load and setting it after init may not take effect — author the duration manually from a rough total.

### Accelerating cadence (geometric hold decay)

For rhetorical escalation — "everyone says…", a roll-call, a praise flurry — the beat grid itself accelerates: early entries hold ~1s (read speed), then windows shrink geometrically into a ~0.15–0.3s flurry, braking on an emphasis state before the resolve. The acceleration is pre-computed into the same flat `TIMELINE` — still content-driven, still deterministic, no speed-up tween anywhere:

```js
// Geometric decay on the hold, clamped at a flurry floor; the brake state holds longest.
const HOLDS = CONTENT.map((entry, i) => Math.max(FLURRY_FLOOR, HOLD_START * Math.pow(DECAY, i)));
HOLDS[CONTENT.length - 1] = HOLD_FINAL;

let cumulative = 0;
const TIMELINE = CONTENT.map((entry, i) => {
  // Past ~0.5s states are glanced as motion texture, not read —
  // drop the per-char term or you never reach flurry speed.
  const readable = HOLDS[i] >= READ_THRESHOLD;
  const dur = HOLDS[i] + (readable ? entry.body.length * SEC_PER_CHAR : 0);
  const start = cumulative;
  cumulative += dur;
  return { ...entry, start, end: cumulative };
});
```

Worked example — **praise-chip flurry**: ~16 short quotes hard-cut through a chip beside a pinned wordmark. First 3 states at `HOLD_START = 1.0` (each reads fully); `DECAY = 0.8` shrinks every following window until `FLURRY_FLOOR = 0.2` catches it (≈12 states over ~2.5s — a churn of acclaim, individually glanced); the longest phrase takes `HOLD_FINAL ≈ 1.6` as the brake before the closing lockup.

Values: `HOLD_START` 0.8–1.2s; `DECAY` 0.75–0.88 (higher = longer runway before the flurry bites); `FLURRY_FLOOR` 0.15–0.3s (below ~0.15s swaps strobe); `READ_THRESHOLD` ~0.5s; brake ≥ 4× the floor or the stop doesn't register as a beat. The 3–6 entry guidance relaxes here — 12–18 states are legal precisely because flurry states aren't individually read. The hard-cut discipline (`lastTitle` guard, instant swaps) is what lets 0.2s states render clean.

## Values

| token         | range                 | notes                                                                                                                 |
| ------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| BASE_DURATION | 0.6–1.5s              | minimum per entry regardless of length — even one-word entries get read time                                          |
| SEC_PER_CHAR  | 0.03–0.06 s/char      | ≈17–33 chars/sec; uniform across the sequence so the pace reads as one engine; lean high for wide-character languages |
| HOLD_MID      | 0.5–1.0s              | dwell on a non-final entry; `< HOLD_FINAL`                                                                            |
| HOLD_FINAL    | 1.0–2.0s              | climax dwell — must exceed HOLD_MID by a clear margin so the close reads as a beat                                    |
| SPEED_FACTOR  | 0.5–2.0 (default 1.0) | per-entry only; if every entry shares a factor, fold it into SEC_PER_CHAR                                             |
| TAIL_PAD      | 0.0–1.0s              | quiet beat after the last entry; prefer 0 when the next composition owns the breath                                   |
| CONTENT N     | 3–6 entries           | <3 isn't a sequence; >6 drags (accelerating cadence relaxes this — see above)                                         |

Reference: `../../examples/messaging-multi-phrase.html`.

## Critical Constraints

- **Pre-compute the TIMELINE once at build** — never recompute in `onUpdate`; the reverse search over the flat array is the whole per-frame cost.
- **DOM swap only on entry transition** (`lastTitle`/key guard) — per-frame `textContent` assignment flickers in HF render.
- **`min-height` on the body element** — without reservation, downstream elements (progress bar, brand) jitter as content height varies.
- **Sequential only** — for parallel tracks use a different reduction.
- **Titles fit one line at the chosen size; bodies fit inside `min-height` after wrapping.**

## See also

`discrete-text-sequence` (per-entry typewriter on the body) · `context-sensitive-cursor` (cursor color per chapter) · `vertical-spring-ticker` (animated word swap instead of hard cut) · `scale-swap-transition` (visual morph between entries).

## Selected motion rule: motion-blur-streak

---
name: motion-blur-streak
description: Fake directional velocity blur on a fast entrance or camera push-through — blur peaks at max speed and resolves to 0 at the settle, so the element streaks in then snaps sharp. Two paths — SVG feGaussianBlur on the motion axis, or an echo/ghost trail that collapses into the lead.
metadata:
  tags: motion-blur, velocity, streak, entrance, fly-in, ghost, echo, svg-filter, kinetic, camera, snap
---

# Motion-Blur Streak

Real motion blur isn't available to a seeked renderer (it integrates over shutter time), so this rule **fakes** it for a fast fly-in or hard camera push-through. The whole point is the _coupling_: the blur envelope rides the **same ease and window** as the position tween, so peak blur lands exactly on peak speed and the element is razor-sharp the instant it stops. Two paths:

- **(A) Directional SVG blur** — inline `<feGaussianBlur stdDeviation="X 0">` (X on the motion axis, 0 across it), tweened via a proxy. Cleanest; a true directional smear.
- **(B) Echo / ghost trail** — 2–4 duplicates at decreasing opacity, offset backward along the motion vector, collapsing into the lead as it settles. No filter cost; a stylized "speed-line" trail.

**Entrances and mid-shot moves only — never a mid-composition exit.** A blurred element fleeing off-frame mid-composition reads as a glitch; a hard exit between scenes is the transition's job (`../../transitions/overview.md`). One sanctioned scope extension: the envelope may ride the **camera wrapper** during a travel leg — see the Camera-Travel Carve-Out.

## How It Works

A fast `out`-eased move front-loads velocity — fastest off the start, bleeding to zero at the settle. Map the blur/echo envelope onto that same curve: position travels from an off-frame / pushed-back start to rest over `MOVE_DUR`; in lockstep on the same window and ease the smear goes `PEAK_BLUR → 0` (A) or the ghosts collapse onto the lead (B). By the settle the element is fully crisp and dwells ≥1 s — the contrast between violent streak and still, sharp settle IS the effect. GSAP can't tween an SVG attribute directly: tween a plain `{ v }` proxy and write `setAttribute("stdDeviation", …)` in `onUpdate`, seeding it once at setup so a seek to t=0 shows the streaked start.

## Recipe

```html
<!-- inside a standard scene clip; overflow: hidden on the scene (the smear extends past rest) -->
<svg width="0" height="0" aria-hidden="true" style="position: absolute">
  <filter id="streak" x="-50%" y="-50%" width="200%" height="200%">
    <feGaussianBlur id="streak-blur" in="SourceGraphic" stdDeviation="0 0" />
  </filter>
</svg>
<div class="streak-el" id="streak-el" style="filter: url(#streak)">{phrase}</div>
<!-- Path B instead: N-1 aria-hidden .streak-ghost duplicates BEHIND the lead, no filter -->
```

```js
// Path A — proxy-tweened directional blur.
const blurNode = document.getElementById("streak-blur");
const blurProxy = { v: PEAK_BLUR };
const writeBlur = () => blurNode.setAttribute("stdDeviation", `${blurProxy.v} 0`); // X axis only
writeBlur(); // seed frame 0 — a seek to t=0 must show the streaked start, not a sharp pre-frame

tl.fromTo(
  "#streak-el",
  { x: ENTER_FROM_X, opacity: 0 },
  { x: 0, opacity: 1, duration: MOVE_DUR, ease: MOVE_EASE },
  MOVE_START,
);
tl.to(blurProxy, { v: 0, duration: MOVE_DUR, ease: MOVE_EASE, onUpdate: writeBlur }, MOVE_START);

// Path B — ghosts on the SAME window/ease; per-ghost variation by index.
gsap.utils.toArray(".streak-ghost").forEach((g) => {
  const i = Number(g.dataset.i); // 1..N-1, set in HTML
  tl.fromTo(
    g,
    { x: ENTER_FROM_X - i * ECHO_STEP_PX, opacity: GHOST_BASE_OPACITY / i },
    { x: 0, opacity: 0, duration: MOVE_DUR, ease: MOVE_EASE },
    MOVE_START,
  );
});
```

## Variations

- **Vertical streak** — swap axes: `y`, `stdDeviation="0 Y"`, vertical echo offsets.
- **Camera push-through** — `scale: SCALE_FROM → 1` with a symmetric `"B B"` envelope (depth-wise smear, not directional): the wordmark punches out of soft focus and snaps crisp at the lock.
- **Staggered grid streak-in** — each card streaks into its slot at `MOVE_START + i * CARD_STAGGER` with its own blur proxy / ghosts; sharp the instant it lands.
- **Hold-the-streak** — blur on a marginally slower curve than position (position `expo.out`, blur `power3.out`) so the last wisp resolves just after arrival. Sparingly; default is locked envelopes.

## Camera-Travel Carve-Out

The envelope is also sanctioned at **wrapper level**: on the `.world` / camera wrapper of a virtual-camera scene ([viewport-change.md](viewport-change.md), [multi-phase-camera.md](multi-phase-camera.md), [3d-camera-flight.md](3d-camera-flight.md)) during a **travel leg** — a dive, a whip sweep, a violent final push. This does **not** violate "never a mid-composition exit": the world never leaves frame — the camera travels _through_ it, and every leg ends with the world at rest, sharp, inside the frame. Each leg is an **arrival** at the next pose, so the entrance doctrine applies leg by leg. Three deltas from the element-level recipe:

- **Envelope follows the leg's ease.** An `out` leg (dive, final push) uses the base recipe unchanged. An `inOut` repositioning leg peaks mid-leg: split the envelope at the velocity peak — `0 → PEAK` on the in-half ease over the first half, `PEAK → 0` on the out-half over the second. Seed the proxy at **0** for these (the streaked state lives mid-leg, not at t=0; seed-at-`PEAK_BLUR` belongs to the entrance shape, where the first frame IS the fastest).
- **Filter placement.** 2D camera: `filter: url(#streak)` on the `.world` wrapper. 3D flight: on the **perspective stage** above the 3D context — a `filter` on a `preserve-3d` element flattens it and collapses every `translateZ`. Never per-element inside the world: one frame-wide envelope, not N desynced ones.
- **Full-frame blur is heavy** — cap `PEAK_BLUR` ~18–20 at wrapper level (vs 30 for one element); a brief whip may touch ~24. Axis rule as usual: `"X 0"` for a lateral whip/pan, `"B B"` for a dive/push.

### Whip sweep (named composition)

The heavily-blurred lateral whip that resolves into the next region — two rules on one window:

1. **Position** — [nudge-curve.md](nudge-curve.md)'s three-phase chain on the camera state, tuned burst-dominant (tail still ≥3× ramp-in in time).
2. **Blur** — `0 → PEAK` across the ramp-in, held at `PEAK` through the linear burst (constant velocity = constant smear), `PEAK → 0` across the tail.

Swap or reveal the next region's content DURING the burst — the smear masks the change; the `power4.out` tail lands it sharp. Reveal during the burst, read after the tail.

```js
tl.to(cam, { x: WHIP_X * 0.1, duration: 0.12, ease: "power3.in", onUpdate: applyCamera }, WHIP_AT);
tl.to(
  cam,
  { x: WHIP_X * 0.75, duration: 0.1, ease: "none", onUpdate: applyCamera },
  WHIP_AT + 0.12,
);
tl.to(
  cam,
  { x: WHIP_X, duration: 0.35, ease: "power4.out", onUpdate: applyCamera },
  WHIP_AT + 0.22,
);

tl.to(blurProxy, { v: PEAK_BLUR, duration: 0.12, ease: "power3.in", onUpdate: writeBlur }, WHIP_AT);
// blur holds at PEAK through the linear burst (no tween needed — value rests at PEAK)
tl.to(blurProxy, { v: 0, duration: 0.35, ease: "power4.out", onUpdate: writeBlur }, WHIP_AT + 0.22);
```

## Values

| token              | range                                              | notes                                                                                           |
| ------------------ | -------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| MOVE_EASE          | `expo.out` / `power4.out` (default) / `power3.out` | `out`-family ONLY — `in`/`inOut` puts peak speed in the wrong place; position and blur share it |
| MOVE_DUR           | 0.25–0.6s                                          | over ~0.7s reads as a focus pull, not velocity                                                  |
| ENTER_FROM_X/Y     | 40–120% of the element's own dimension             | enough runway for the streak to read                                                            |
| PEAK_BLUR          | 8–30 (default 18)                                  | >30 erases the glyph at the start; ~18–20 cap at wrapper level                                  |
| SCALE_FROM         | 1.3–2.5                                            | push-through variation                                                                          |
| N (ghosts)         | 2–4                                                | >4 reads as strobe, not streak                                                                  |
| ECHO_STEP_PX       | 12–40px                                            | `N × step ≲ ENTER_FROM` so the furthest ghost starts inside the runway                          |
| GHOST_BASE_OPACITY | 0.3–0.6                                            | opaque ghosts read as duplicate elements                                                        |
| CARD_STAGGER       | 0.05–0.12s                                         | one assembling wave, not separate arrivals                                                      |

## Critical Constraints

- Blur peaks at peak speed and resolves to 0 at the settle — share the ease and window between position and envelope. A blur that lingers after the stop reads as a focus pull.
- Entrances / mid-shot arrivals only — never a mid-composition exit; wrapper-level use only per the carve-out.
- Seed `stdDeviation` at setup: at `PEAK_BLUR` for the entrance shape, at 0 for a whip / `inOut` leg.
- Generous filter region (`x="-50%" y="-50%" width="200%" height="200%"`) or the smear clips at the element's box edge.
- Directional axis: `"X 0"` horizontal, `"0 Y"` vertical, `"B B"` only for a depth/scale move — symmetric blur on a sideways move looks like defocus.
- Dwell ≥1 s sharp after the snap; a streak landing at the last beat reads as "flashed and gone".
- Heavy element on a solid field — thin type (< ~120px / 800 weight) or a busy backdrop swallows the smear.
- `overflow: hidden` on the scene — the smear / furthest ghost extends past the resting position during travel.

## See also

`kinetic-beat-slam` (streak as one beat's entrance) · `center-outward-expansion` (grid streak-in) · `scale-swap-transition` (same-footprint morph — not an arrival) · `nudge-curve` (the whip sweep's position half) · `3d-camera-flight` / `viewport-change` (the carve-out's wrappers).

## Selected motion rule: svg-path-draw

---
name: svg-path-draw
description: Animate SVG paths drawing progressively using stroke-dasharray and stroke-dashoffset.
metadata:
  tags: svg, stroke, draw, path, reveal, icon, vector
---

# SVG Path Draw

Reveals an SVG shape by animating its stroke as if a pen were tracing it. Two stroke properties together: **`stroke-dasharray = <pathLength>`** makes the entire path one dash; **`stroke-dashoffset`** starts at the path length (dash shifted fully out of view → invisible) and tweens to `0` (fully drawn). The length comes from the DOM API `path.getTotalLength()` — measured, never guessed.

Works on anything with a stroke: `<path>`, `<circle>`, `<rect>`, `<line>`, `<polyline>`, `<polygon>`, `<ellipse>`.

## Recipe

```html
<!-- inside a standard scene clip -->
<svg class="logo-mark" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <path id="bar-left" d="M 60 40 L 60 160" />
  <path id="bar-right" d="M 140 40 L 140 160" />
  <path id="bar-mid" d="M 60 100 L 140 100" />
</svg>
```

```css
.logo-mark path {
  fill: none; /* outline-only draw — a fill would appear immediately and ruin the reveal */
  stroke: {accentColor};
  stroke-width: 12;
  stroke-linecap: round; /* softer endpoints */
  stroke-linejoin: round;
}
```

```js
// Setup: measure each path and set its dash pattern. Real measured geometry, not a magic number.
document.querySelectorAll(".logo-mark path").forEach((p) => {
  const len = p.getTotalLength();
  p.style.strokeDasharray = `${len}`;
  p.style.strokeDashoffset = `${len}`;
});

// Stagger draws so the eye reads continuous motion — each segment starts at
// ~70-80% of the previous segment's duration, before it finishes.
tl.to(
  "#bar-left",
  { strokeDashoffset: 0, duration: SEGMENT_DRAW_DUR, ease: "power2.out" },
  SEG_1_START,
);
tl.to(
  "#bar-right",
  { strokeDashoffset: 0, duration: SEGMENT_DRAW_DUR, ease: "power2.out" },
  SEG_2_START,
);
tl.to(
  "#bar-mid",
  { strokeDashoffset: 0, duration: FINAL_SEGMENT_DUR, ease: "power2.out" },
  SEG_3_START,
);

// Companion wordmark fades in only after the last stroke settles.
tl.to(
  ".brand-line",
  { opacity: 1, duration: BRAND_FADE_DUR, ease: "power1.out" },
  BRAND_FADE_START,
);
```

## Variations

- **Ring starting at 12 o'clock** — `<circle>` / `<rect>` strokes start at 3 o'clock by default; rotate the element `-90deg` so a progress ring draws from the top:

```html
<circle
  cx="100"
  cy="100"
  r="60"
  id="ring"
  style="transform-origin: 100px 100px; transform: rotate(-90deg)"
/>
```

- **Linear (constant-speed) draw** — `ease: "none"` for a steady-rate "real pen" trace.
- **Draw then fill** — for filled shapes, tween `fillOpacity: 0 → 1` AFTER the stroke completes (requires `fill-opacity: 0` initially and a real `fill` in CSS):

```js
tl.to(
  "#path",
  { strokeDashoffset: 0, duration: SEGMENT_DRAW_DUR, ease: "power2.out" },
  SEG_1_START,
);
tl.to(
  "#path",
  { fillOpacity: 1, duration: FILL_FADE_DUR, ease: "power1.out" },
  SEG_1_START + SEGMENT_DRAW_DUR,
);
```

## Values

| token             | range                                   | notes                                                                                              |
| ----------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| SEGMENT_DRAW_DUR  | 0.3–0.8s                                | fast snap vs deliberate pen trace; >~1s feels sluggish for a logo reveal                           |
| FINAL_SEGMENT_DUR | 60–80% of SEGMENT_DRAW_DUR              | proportional to segment length — a short connector at full duration reads slower than its siblings |
| SEG_N_START       | previous start + 70–80% of its duration | reads as continuous motion, not N isolated animations                                              |
| SEG_1_START       | 0–0.4s                                  | a small ~0.2s lead-in lets the viewer settle before motion                                         |
| BRAND_FADE_START  | ≥ last stroke end (+ ~0.2s beat)        | earlier and the wordmark competes with the draw                                                    |
| BRAND_FADE_DUR    | 0.3–0.8s                                | snap (urgent) vs glide (premium)                                                                   |

Ease families are discrete choices: **stroke draws** use `power2.out` (a hand lifting at end of stroke) or `none` for constant speed — never `back.out` / `elastic.out` (pens don't bounce). **Fades** use `power1.out`.

## Critical Constraints

- **`fill: none`** for outline-only draws — otherwise the fill appears immediately.
- **Dasharray/dashoffset = the measured `getTotalLength()`**, set at setup; requires the SVG in the DOM (inline SVG is fine; a loaded `<image>` SVG is not).
- **Complex paths**: if `getTotalLength()` looks wrong, overestimate slightly (`len * 1.05`) — too large is invisible at animation start; too small clips the end.
- **Stagger multi-path draws at ~70–80%** of the previous segment's duration.
- **A drawn line must land on something.** When the path is a connector (rail, beam, underline, callout) rather than a shape, both endpoints must sit on real elements and the draw must do a job — reveal, route, validate, or emphasize. A stroke that only decorates empty space reads as filler; attach it or cut it.

## See also

`svg-icon-enrichment` (internal parts animate after the outline draws) · `counting-dynamic-scale` (stroke draws an icon while a number counts up) · `hacker-flip-3d` (logo draws, wordmark decodes beneath).
