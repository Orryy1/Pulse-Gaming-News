# Frame packet: 06-timing-flexibility

## Project inputs

- Project: D:\pulse-worktrees\system-trace-display-20260820\videos\system-trace-variable-refresh-rate
- Design tokens: D:\pulse-worktrees\system-trace-display-20260820\videos\system-trace-variable-refresh-rate\frame.md
- RULES_DIR: C:\Users\MORR\.agents\skills\hyperframes-animation\rules

## Assigned storyboard block

## Frame 6 - Timing flexibility

- scene: GPU, display, connection and presentation-path markers link into one supported chain, then resolve into the final rule.
- voiceover: "VRR is therefore timing flexibility, not free performance. The GPU, display, connection and presentation path must all support it."
- duration: 8.9s
- poster: 6.3s
- transition_in: blur-crossfade
- status: outline
- src: compositions/frames/06-timing-flexibility.html
- type: branding
- persuasion: Distillation
- beat: Resolve
- blueprint: titlecard-reveal (Adapt)
- focal: TIMING FLEXIBILITY / NOT FREE PERFORMANCE
- roles: four support markers = foreground mechanism, final rule card = foreground payoff, SYSTEM TRACE marker = supporting
- sfx: none
- diagram_source: Original compatibility chain based on Microsoft's DXGI VRR support requirements and VESA's Adaptive-Sync implementation description: https://learn.microsoft.com/en-us/windows/win32/direct3ddxgi/variable-refresh-rate-displays | https://vesa.org/featured-articles/vesa-adds-adaptive-sync-to-popular-displayport-video-standard/

Adapt: retain the calm single-card landing, using a four-link compatibility chain as the card's one mechanism.

Scene 1 (0.0-2.8s): In the upper 83%, GPU and DISPLAY light on a simple chain through cluster-to-outward expansion (`center-outward-expansion`).

Scene 2 (2.8-5.8s): On "connection and presentation path", the last two links self-draw in sequence (`svg-path-draw`).

Scene 3 (5.8-8.9s): TIMING FLEXIBILITY / NOT FREE PERFORMANCE scale-swaps into the centre (`scale-swap-transition`), then SYSTEM TRACE // 10 reaches a static hold (`gsap-effects`).

narrativeRole: Finishes with the capability boundary and the compatibility requirement.
keyMessage: VRR needs an end-to-end supported path and does not create GPU performance.

## Selected motion rule: center-outward-expansion

---
name: center-outward-expansion
description: Elements start clustered at screen center and expand outward to their final positions, driven by a shared progress value.
metadata:
  tags: expansion, scatter, center, reveal, layout, sync, burst
---

# Center-Outward Expansion

Elements begin at one shared center point and radiate outward to their final positions — the entry beat itself, or motion driven by another animation's progress (a counting number, a beat). Flat 2D cousin of [depth-scatter-assemble.md](depth-scatter-assemble.md) (per-element 3D cloud): here every element shares the SAME origin.

## How It Works

Each element carries its final offset as `data-target-x/y`. Its position lerps between center and target: `x = targetX × progress`. Self-centering is baked as `xPercent/yPercent: -50` so the tweened `x`/`y` are pure offsets from the stage center. Standalone burst = per-item staggered `fromTo`; driven burst = one shared proxy (see Variations).

## Recipe

```html
<!-- inside a standard scene clip (hyperframes-core) -->
<div class="burst-wrap">
  <div class="burst-item" data-target-x="-360" data-target-y="-180">{itemA}</div>
  <div class="burst-item" data-target-x="360" data-target-y="-180">{itemB}</div>
  <div class="burst-item" data-target-x="0" data-target-y="360">{itemC}</div>
</div>
```

```css
.burst-wrap {
  position: relative;
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
}
.burst-item {
  position: absolute;
  top: 50%;
  left: 50%; /* GSAP xPercent/yPercent -50 bakes the centering; x/y tween the offset */
  will-change: transform;
}
```

```js
document.querySelectorAll(".burst-item").forEach((el, i) => {
  tl.fromTo(
    el,
    { xPercent: -50, yPercent: -50, x: 0, y: 0, scale: 0.6, opacity: 0 },
    {
      x: Number(el.dataset.targetX),
      y: Number(el.dataset.targetY),
      scale: 1,
      opacity: 1,
      duration: EXPAND_DUR,
      ease: EXPAND_EASE,
    },
    ENTRY_AT + i * STAGGER,
  );
});
```

## Variations

- **Synced to a driver (chord)**: when the burst shadows a counter / beat, drop the stagger and drive all items from ONE 0→1 proxy tween with the driver's exact duration AND ease; `onUpdate` writes `translate(-50%,-50%) translate(targetX*p, targetY*p)` per item — the two read as one beat.
- **Partially-spread start**: with 6+ items the full cluster piles up — start from `{ x: targetX * START_PROGRESS, ... }`.
- **Idle micro-float**: hand off to [sine-wave-loop.md](sine-wave-loop.md) after landing instead of freezing.

## Values

| token          | range                | notes                                                            |
| -------------- | -------------------- | ---------------------------------------------------------------- |
| ITEM_COUNT     | 3–8                  | > 8 = visual chaos mid-expansion; low counts want wider spread   |
| EXPAND_DUR     | 1.0–1.8s             | must equal the driver's duration in the synced variant           |
| EXPAND_EASE    | `power3.out` default | `power2.out` gentler, `expo.out` dramatic stop; NEVER `in` eases |
| STAGGER        | 0.04–0.08s           | tighter = chord; looser = lazy arpeggio                          |
| ENTRY_AT       | 0–0.5s               | a beat of compositional quiet before the burst                   |
| START_PROGRESS | 0–0.5                | 0 = dramatic full cluster; ~0.3 avoids the pile-up               |

## Critical Constraints

- **Tween `x`/`y` over the baked `xPercent/yPercent: -50`** — mutating `left`/`top` fights the centering and causes pixel jitter.
- **Out-easing only** — `in` easings read as items being sucked back mid-air.
- **No other absolute-positioned siblings inside `.burst-wrap`** — they'd steal the centered baseline.
- **❗ The burst IS the beat** — don't park a "real headline" label below it (the eye snaps to the label and ignores the burst). If a label is needed, reveal it post-burst in the same stack.
- Synced variant: identical duration + ease as the driver, or the chord falls apart.

## See also

`counting-dynamic-scale` (the classic chord driver) · `depth-scatter-assemble` (3D per-element cloud) · `card-morph-anchor` (burst out of a morphed card) · `sine-wave-loop` (post-landing life).

## Selected motion rule: gsap-effects

# GSAP Effects for HyperFrames

Drop-in animation patterns. Snippets show mechanism only, inside a standard scene clip (hyperframes-core); assume `tl` exists.

- [Typewriter](#typewriter) — character-by-character reveal with optional cursor / backspace / word rotation
- [Audio Visualizer](#audio-visualizer) — pre-extract audio data, drive Canvas/DOM rendering from the timeline

## Typewriter

Requires GSAP's TextPlugin alongside the core script:

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/TextPlugin.min.js"></script>
<script>
  gsap.registerPlugin(TextPlugin);
</script>
```

### Basic

```js
const text = "Hello, world!";
const cps = 10; // chars per second — see timing table
tl.to(
  "#typed-text",
  { text: { value: text }, duration: text.length / cps, ease: "none" },
  startTime,
);
```

### Blinking Cursor

Three rules: **one cursor visible at a time** (hide previous before showing next); **cursor must blink when idle** (after typing, during holds); **no gap between text and cursor** (elements flush in HTML).

```html
<span id="typed-text"></span><span id="cursor" class="cursor-blink">|</span>
```

```css
@keyframes blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0;
  }
}
.cursor-blink {
  animation: blink 0.8s step-end infinite;
}
.cursor-solid {
  animation: none;
  opacity: 1;
}
.cursor-hide {
  animation: none;
  opacity: 0;
}
```

Pattern: blink → solid (typing starts) → type → blink (typing done):

```js
tl.call(() => cursor.classList.replace("cursor-blink", "cursor-solid"), [], startTime);
tl.to("#typed-text", { text: { value: text }, duration: dur, ease: "none" }, startTime);
tl.call(() => cursor.classList.replace("cursor-solid", "cursor-blink"), [], startTime + dur);
```

Multi-line handoff: hide previous cursor → blink new → brief pause (~0.5s) → solid when typing. Never go `hidden → solid` (skips the idle blink).

### Backspacing

TextPlugin removes from the front — wrong for backspace. Use manual substring removal:

```js
function backspace(tl, selector, word, startTime, cps) {
  const el = document.querySelector(selector);
  const interval = 1 / cps;
  for (let i = word.length - 1; i >= 0; i--) {
    tl.call(
      () => (el.textContent = word.slice(0, i)),
      [],
      startTime + (word.length - i) * interval,
    );
  }
  return word.length * interval;
}
```

### Spacing With Static Text

A typewriter word next to static text (`<span>Ship something</span><span style="margin-left:14px"><span id="word"></span><span id="cursor">|</span></span>` in a baseline-aligned flex row): use `margin-left` on the wrapper span. Don't use flex `gap` (it spaces the cursor from the text) and don't put a trailing space in the static text (it collapses when the dynamic span is empty).

### Word Rotation

Type → hold → backspace → next word; cursor blinks during every idle moment:

```js
let offset = 0;
words.forEach((word, i) => {
  const typeDur = word.length / 10;
  // cursor: solid while typing, blink during holds (same call pattern as above)
  tl.to("#typed-text", { text: { value: word }, duration: typeDur, ease: "none" }, offset);
  offset += typeDur + 1.5; // hold
  if (i < words.length - 1) offset += backspace(tl, "#typed-text", word, offset, 20) + 0.3;
});
```

### Appending Words

Build a sentence word-by-word into the same element: keep an `accumulated` string, each step tweens `text: { value: accumulated + " " + word }` with `duration: newChars / cps`, then advances the offset.

### Timing Guide

| CPS   | Feel             | Good for                   |
| ----- | ---------------- | -------------------------- |
| 3-5   | Slow, deliberate | Dramatic reveals, suspense |
| 8-12  | Natural typing   | Dialogue, narration        |
| 15-20 | Fast, energetic  | Tech demos, code           |
| 30+   | Near-instant     | Filling long blocks        |

## Audio Visualizer

Pre-extract audio data, drive Canvas / DOM rendering from the timeline. **Do not use the Web Audio API at render time** — there's no playback during seek.

### Extract Audio Data

Bundled extractor (requires `ffmpeg` + Python `numpy`):

```bash
python skills/hyperframes-creative/scripts/extract-audio-data.py audio.mp3 -o audio-data.json
python skills/hyperframes-creative/scripts/extract-audio-data.py video.mp4 --fps 30 --bands 16 -o audio-data.json
```

Output: `{ "fps": 30, "totalFrames": 5415, "frames": [{ "time": 0.0, "rms": 0.42, "bands": [0.8, 0.6, 0.3] }] }` — `rms` (0-1) is overall loudness; `bands[]` (0-1) are frequency magnitudes, index 0 = bass, each band normalized independently.

### Loading (Synchronously)

Inline the JSON for small files (< ~500 KB), or sync XHR for large ones:

```js
const xhr = new XMLHttpRequest();
xhr.open("GET", "audio-data.json", false); // synchronous — deliberate
xhr.send();
const AUDIO_DATA = JSON.parse(xhr.responseText);
```

**Do NOT use async `fetch()`** — HyperFrames reads `window.__timelines` synchronously after page load; building the timeline inside `.then()` means it isn't ready when capture starts.

### Driving the Timeline

Canvas 2D is the workhorse (bars, waveforms, circles, gradients) — one `tl.call` per frame:

```js
const ctx = document.getElementById("viz").getContext("2d");
for (let f = 0; f < AUDIO_DATA.totalFrames; f++) {
  tl.call(
    () => {
      const frame = AUDIO_DATA.frames[f];
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // draw using frame.rms and frame.bands
    },
    [],
    f / AUDIO_DATA.fps,
  );
}
```

WebGL / Three.js: HyperFrames patches `THREE.Clock` for deterministic time — update uniforms from audio data each frame. DOM elements: fine under ~20 elements, slower than Canvas beyond that.

### Smoothing

```js
let prev = null;
const smoothing = 0.25; // 0.1-0.2 snappy, 0.3-0.5 flowing
function smooth(f) {
  const raw = AUDIO_DATA.frames[f];
  if (!prev) prev = { rms: raw.rms, bands: [...raw.bands] };
  else {
    prev = {
      rms: prev.rms * smoothing + raw.rms * (1 - smoothing),
      bands: raw.bands.map((b, i) => prev.bands[i] * smoothing + b * (1 - smoothing)),
    };
  }
  return prev;
}
```

### Design Guide

- **Spatial mapping** — horizontal: bass left, treble right; vertical: bass bottom; circular: bass at 12 o'clock, wrap clockwise (mirror for a full circle).
- **Bass drives big moves** (scale, glow, position); **treble drives detail** (shimmer, flicker, edges); **RMS drives globals** (background brightness, overall energy).
- Pick 2-3 animated properties — more looks noisy. Keep minimums above zero so quiet sections still have life.
- **Band count**: 4 = background glow/pulse, 8 = bar charts, 16 = detailed EQ (default), 32 = dense radial layouts.
- **Layering**: stack canvases with `z-index` — a background layer driven by bass/rms under a foreground layer driven by individual bands gives depth without per-element complexity.

## Selected motion rule: scale-swap-transition

---
name: scale-swap-transition
description: Coordinated shrink-out + spring pop-in morph-like transition between two elements — no SVG path interpolation needed.
metadata:
  tags: transition, morph, scale, swap, spring, pop
---

# Scale-Swap Transition

Simulates a "morph" between two DOM elements by overlapping exit and entrance scale animations. Lighter weight than [card-morph-anchor.md](card-morph-anchor.md) (which morphs container dimensions — use that for SHAPE changes; this rule is for SAME-shape state swaps) and easier than SVG path interpolation.

At a single trigger, two coordinated tweens fire:

1. **Outgoing**: scale `1.0 → EXIT_SCALE` + opacity `1 → 0`, fast `power2.in` (rushing away).
2. **Incoming**: scale `EXIT_SCALE → 1.0` + opacity `0 → 1`, `back.out(BOUNCE_FACTOR)` (arriving with weight).

A small `OVERLAP` window during which both are mid-tween creates the morph illusion; the incoming sits on top via z-index so the outgoing's fade-tail doesn't bleed through.

## Recipe

```html
<!-- Both cards position: absolute; inset: 0 in one fixed-size wrapper — same
     footprint, same transform-origin: 50% 50%. Incoming starts opacity: 0,
     transform: scale(EXIT_SCALE), z-index above the outgoing. -->
<div class="swap-wrap">
  <div class="card outgoing" id="outgoing">{outgoingIcon} {outgoingLabel}</div>
  <div class="card incoming" id="incoming">
    {incomingIcon} {incomingLabel}
    <div class="sub" id="sub">{incomingSubline}</div>
  </div>
</div>
```

```js
// Outgoing: shrink + fade fast
tl.to(
  "#outgoing",
  { scale: EXIT_SCALE, opacity: 0, duration: EXIT_DUR, ease: "power2.in" },
  TRIGGER,
);

// Incoming: pops in with overshoot, starting OVERLAP before the exit finishes
tl.to(
  "#incoming",
  { scale: 1.0, opacity: 1, duration: ENTER_DUR, ease: `back.out(${BOUNCE_FACTOR})` },
  TRIGGER + EXIT_DUR - OVERLAP,
);

// Inner content reveals AFTER the incoming settles
tl.fromTo(
  "#sub",
  { opacity: 0, y: SUB_REVEAL_Y_PX },
  { opacity: 1, y: 0, duration: SUB_REVEAL_DUR, ease: "power3.out" },
  TRIGGER + EXIT_DUR + SUB_REVEAL_DELAY,
);
```

## Variations

- **Delayed inner content reveal** — the classic pattern above: morph the container, then reveal inner text once it settles; the 0.2–0.4 s gap lets the eye land on the new shape before reading.
- **Triple swap (3-state cycle)** — chain A→B→C with triggers `TRIGGER_AB` / `TRIGGER_BC`; each transition is its own tween pair, the previous incoming becoming the next outgoing. State-evolution narratives (early → mid → final labels).
- **Color-shift transition (no scale)** — for a flat morph between same-shape states, drop the scale and keep opacity + a brief background hue tween; less dramatic, more product-UI tone.

## Values

| token            | range                                 | notes                                                                                                  |
| ---------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| TRIGGER          | ≥ outgoing settled + a presence-dwell | the outgoing must "land" before transforming                                                           |
| EXIT_DUR         | 0.3–0.5 s                             |                                                                                                        |
| ENTER_DUR        | 0.45–0.7 s                            | longer than `EXIT_DUR` so the overshoot can settle                                                     |
| OVERLAP          | 0.1–0.2 s                             | >0.3 s both are clearly visible together (no morph); <0.05 s leaves a visible empty gap                |
| EXIT_SCALE       | 0.6–0.8                               | smaller exits feel dramatic but risk reading as "vanish" instead of "morph"                            |
| BOUNCE_FACTOR    | 1.4 soft · 1.8 firm · 2.2 cartoony    |                                                                                                        |
| SUB_REVEAL_DELAY | 0.2–0.4 s                             | reveals during the morph compete with the swap for attention                                           |
| BRAND_REVEAL_AT  | < TRIGGER                             | context (brand, eyebrow) sets the stage early; revealed AT the swap it competes with the headline beat |

## Critical Constraints

- **Incoming z-index ABOVE outgoing** — otherwise the outgoing's fade-tail (opacity 0.3–0.5) bleeds through and double-exposes the frame.
- **Both elements share `transform-origin: 50% 50%`** — different origins make the morph read as one thing teleporting elsewhere.
- **Bouncy ease ONLY on the incoming** — outgoing `power2.in`, incoming `back.out`; reversed, the swap feels mechanical.
- **Both cards `position: absolute; inset: 0`** in the same fixed-size wrapper (sized to fit both states; the wrap never resizes).
- **Don't `display: none` the outgoing** after the fade — leave it at `opacity: 0` so layout doesn't reflow.
- **Inner content reveals after the container settles**; **climax dwell ≥ 1 s** after the final state + subline land.

## See also

`press-release-spring` (a button press TRIGGERS the swap — cause and effect) · `card-morph-anchor` (shape-changing alternative) · `reactive-displacement` (when the replacement should read as a causal collision) · `sine-wave-loop` (idle breathing on the final state).

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
