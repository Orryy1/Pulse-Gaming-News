# Frame packet: 04-split-point

## Project inputs

- Project: D:\pulse-worktrees\system-trace-display-20260820\videos\system-trace-screen-tearing
- Design tokens: D:\pulse-worktrees\system-trace-display-20260820\videos\system-trace-screen-tearing\frame.md
- RULES_DIR: C:\Users\MORR\.agents\skills\hyperframes-animation\rules

## Assigned storyboard block

## Frame 4 - The split point

- scene: A descending scan line crosses a buffer hand-off marker, leaving FRAME A above it and FRAME B below it.
- voiceover: "If the displayed buffer changes mid-scan, the upper lines can show one frame while lower lines show the next."
- duration: 9.0s
- poster: 6.4s
- transition_in: crossfade
- status: outline
- src: compositions/frames/04-split-point.html
- type: feature_showcase
- persuasion: Animated causal proof
- beat: Aha
- blueprint: fixed-anchor-cycle (Adapt)
- focal: BUFFER CHANGES MID-SCAN at the seam
- roles: descending scan and seam = foreground proof, frame labels = supporting, display shell = background
- sfx: none
- diagram_source: Original buffer-change diagram based on Apple's warning that unsynchronised presentation can cause screen tearing: https://developer.apple.com/documentation/quartzcore/cametallayer/displaysyncenabled

Adapt: retain the pinned anchor, using the display shell as the unchanging anchor while the scan state changes around it.

Scene 1 (0.0-2.8s): In the upper 83%, the display shell pins in place with SVG self-draw (`svg-path-draw`) while FRAME A enters by per-word staggered reveal (`dynamic-content-sequencing`).

Scene 2 (2.8-6.2s): On "mid-scan", the fire-orange line reaches centre by viewport change (`viewport-change`); BUFFER CHANGE gets keyword glow (`asr-keyword-glow`) and the lower region hard-swaps to FRAME B (`discrete-text-sequence`).

Scene 3 (6.2-9.0s): On "upper lines" then "lower lines", the two labels reveal sequentially (`dynamic-content-sequencing`), then the completed split reaches a static hold (`gsap-effects`).

narrativeRole: Shows the mechanical cause of the line the player sees.
keyMessage: A buffer change during a scan can place two frames in one displayed image.

## Selected motion rule: asr-keyword-glow

---
name: asr-keyword-glow
description: Keywords glow + scale up when "spoken" — attack/sustain/release envelope synced to per-word timestamps. Even without real audio, hardcoded timings create a "narrator emphasis" effect.
metadata:
  tags: asr, audio-sync, highlight, glow, keyword, text, speech, emphasis
---

# ASR Keyword Glow

Words in a phrase visually activate (glow blur + scale) when "spoken", following an attack-sustain-release envelope over per-word `{ start, end }` timestamps. In a real ASR pipeline the timings come from a word-level transcript (`hyperframes transcribe` — same shape); for promo video, hand-author them to control emphasis pacing. The envelope never falls to zero after a word — it decays to a rest level, leaving a breadcrumb of recent emphasis.

## How It Works

A single linear driver tween (`ease: "none"` — any other ease distorts the per-word envelope; do not change) sweeps scene time; its `onUpdate` loops over ALL words computing each one's envelope: 0 before `start`, linear attack to 1 over `ATTACK_DUR`, sustain at 1 until `end`, decay to `REST_LEVEL` over `RELEASE`, then hold at rest. The envelope drives `text-shadow` blur and `scale` — one driver for the whole phrase, never one tween per word (60+ words would bloat the timeline).

## Recipe

```html
<!-- inside a standard scene clip (hyperframes-core) -->
<div class="phrase">
  <span class="word" data-word="{w1Key}">{w1}</span>
  <span class="word" data-word="{w2Key}">{w2}</span>
  <!-- … the final word may be the brand, with the .brand modifier -->
  <span class="word brand" data-word="{brandKey}">{brandWord}</span>
</div>
```

```css
.phrase {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  color: {restColor};
}
.word {
  display: inline-block; /* required for transform on <span> */
  transform-origin: 50% 50%;
  text-shadow: 0 0 0 {glowColorTransparent};
}
.word.brand {
  color: {brandAccentColor};
}
```

```js
// Per-word spoken windows — one entry per span; brand word 1.5-2× a normal word's window.
const TIMINGS = {
  // {w1Key}: { start: …, end: … },  — seconds, local to the scene
};

function envelope(time, start, end) {
  if (time < start) return 0;
  if (time < end) return Math.min((time - start) / ATTACK_DUR, 1);
  const releaseEnd = end + RELEASE;
  if (time < releaseEnd) return 1 - ((time - end) / RELEASE) * (1 - REST_LEVEL);
  return REST_LEVEL;
}

const words = document.querySelectorAll(".word");
const driver = { t: 0 };
tl.to(
  driver,
  {
    t: SCENE_DURATION,
    duration: SCENE_DURATION,
    ease: "none", // linear — t maps 1:1 to scene time
    onUpdate: () => {
      words.forEach((el) => {
        const timing = TIMINGS[el.dataset.word];
        if (!timing) return;
        const env = envelope(driver.t, timing.start, timing.end);
        el.style.textShadow = `0 0 ${MAX_BLUR * env}px ${glowColorRgba(env)}`;
        el.style.transform = `scale(${1 + MAX_SCALE_BOOST * env})`;
      });
    },
  },
  0,
);
```

`glowColorRgba(env)` returns the glow color with `env`-modulated alpha.

## Variations

- **Karaoke style (RECOMMENDED for video narration)** — the default amplitudes read too subtle in video: inactive words still dominate. Render inactive words DIM and lerp the active word toward bright + larger; at any moment 1–2 words are bright (spoken + lingering rest) and the rest is dim. Use for short phrases (5–10 words) where one word at a time should POP; keep the subtle default for long dense text. Pushes MAX_BLUR, MAX_SCALE_BOOST, and REST↔ACTIVE contrast; everything else identical:

```js
function lerpChannel(a, b, t) {
  return Math.round(a + (b - a) * t);
}
function colorAt(env, isBrand) {
  const target = isBrand ? BRAND_RGB : ACTIVE_RGB;
  return `rgb(${lerpChannel(REST_RGB.r, target.r, env)}, ${lerpChannel(REST_RGB.g, target.g, env)}, ${lerpChannel(REST_RGB.b, target.b, env)})`;
}
// in onUpdate: el.style.color = colorAt(env, el.classList.contains("brand"));
```

- **Multi-octave glow** — multiply the sustain by `1 + sin(driver.t × PULSE_HZ) × PULSE_AMPLITUDE` so high-emphasis words breathe at peak.
- **Color shift on the peak** — same channel-lerp from `restColor` → `peakColor` as `env` rises (non-karaoke form).
- **3D pop-out** — add `translateZ(env × MAX_POP_Z)` so the spoken word leans toward camera; requires `perspective` on the parent.
- **From real ASR transcripts** — convert `{ word, start_ms, end_ms }` entries to seconds and feed in identically.

## Values

| token           | default style        | karaoke style | notes                                                      |
| --------------- | -------------------- | ------------- | ---------------------------------------------------------- |
| ATTACK_DUR      | 0.1–0.25s            | same          | must be < the shortest word's window or it never reaches 1 |
| RELEASE         | 0.2–0.5s             | same          | decay to rest                                              |
| REST_LEVEL      | 0.15–0.4             | 0.05–0.2      | > 0 (breadcrumb), < 1                                      |
| MAX_BLUR        | 15–25px              | 30–45px       | bigger = "shouting"                                        |
| MAX_SCALE_BOOST | 0.03–0.10            | 0.15–0.25     | additive at peak (0.08 ⇒ scale 1.08)                       |
| PULSE_HZ / AMP  | 4–10 rad/s / 0.1–0.3 | —             | multi-octave variation                                     |
| MAX_POP_Z       | 20–60px              | —             | 3D variation                                               |
| SCENE_DURATION  | = `data-duration`    | same          | driver must end in sync with the scene's seek window       |

## Critical Constraints

- **Timings monotonic, non-overlapping** — every entry's `end` < the next entry's `start`; overlapping windows make the envelope ambiguous.
- **Brand word window 1.5–2× a normal word** — the brand is the headline; let it sustain.
- **Driver ease stays `"none"`** — any other ease warps every word's envelope timing.
- **`text-shadow`, not `box-shadow`** — the glow must hug the GLYPH (speaking emphasis), not the inline-block rectangle.
- **One driver looping all words** — never one tween per word.
- **Commit to a style** — values between the default and karaoke columns yield awkward "half-loud" emphasis.
- **Climax dwell ≥1s** after the final word's emphasis — the last word IS the headline beat.

## See also

`3d-text-depth-layers` (depth on the active word at peak) · `sine-wave-loop` (idle breathe between emphasis moments) · `context-sensitive-cursor` (typewriter matching the ASR cadence) · `/media-use` for `hyperframes transcribe` and caption rendering.

## Selected motion rule: discrete-text-sequence

---
name: discrete-text-sequence
description: Replace entire text states at frame thresholds for non-linear typing effects — typos, bulk additions, pauses, backspaces, simulated thinking.
metadata:
  tags: text, typing, discrete, threshold, non-linear, sequence
---

# Discrete Text Sequence

Instead of character-by-character typewriter, replace entire string states at time thresholds — enabling non-linear effects (typos, backspaces, bulk paste, "thinking" gaps) that smooth per-char typing can't achieve. If your effect is "type each character, no edits", this rule is overkill — use the smooth-slice variation below.

## How It Works

The typing is authored as a sparse array of `{ t, text }` states; on every `onUpdate` a **reverse search** finds the latest entry whose `t` has passed and renders its text. Display jumps between states with no animation between them — the realism comes from the schedule shape: fast keystroke clusters (0.06–0.20s apart), pauses at word breaks (0.3–0.6s), a typo, backspaces peeling back to the fork, then a bulk paste replacing many chars in one entry. A block cursor blinks via a deterministic sin square wave on the same timeline.

## Recipe

```html
<!-- inside a standard scene clip (hyperframes-core) -->
<div class="terminal">
  <div class="prompt">$</div>
  <div class="text-wrap">
    <span class="text" id="text"></span><span class="cursor" id="cursor">_</span>
  </div>
</div>
```

```css
.terminal {
  font-family: {monoFont}; /* monospace required — proportional jitters even in a fixed box */
  display: flex;
  align-items: baseline;
  font-size: TERMINAL_FONT_SIZE;
}
.text-wrap {
  display: inline-flex;
  align-items: baseline;
  min-width: TEXT_WRAP_MIN_WIDTH; /* ≥ widest state — stops right-edge jitter */
  white-space: nowrap;
}
.cursor {
  display: inline-block; /* inline ignores width */
  width: CURSOR_WIDTH;
}
```

```js
// Each entry shows from its t until the NEXT entry's t.
// Shape: keystrokes → typo → backspace to the fork → bulk paste → completion mark.
const SEQUENCE = [
  { t: 0.0, text: "" },
  { t: T_K1, text: "{p1}" }, // first keystrokes (~3-5 chars, 0.1-0.2s apart)
  { t: T_K2, text: "{p1 + ' ' + p2_typo}" }, // continuation containing a typo
  { t: T_BS, text: "{p1 + ' ' + p2_partial}" }, // backspace(s) — peel back to the fork
  { t: T_BULK, text: "{fullCorrectedText}" }, // bulk paste — many chars in one jump
  { t: T_DONE, text: "{fullCorrectedText + ' ✓'}" }, // completion marker
];

// Reverse-search for the latest entry whose t has passed
function textAt(time) {
  for (let i = SEQUENCE.length - 1; i >= 0; i--) {
    if (time >= SEQUENCE[i].t) return SEQUENCE[i].text;
  }
  return "";
}

const textEl = document.getElementById("text");
const cursorEl = document.getElementById("cursor");

const driver = { t: 0 };
tl.to(
  driver,
  {
    t: TOTAL_DURATION,
    duration: TOTAL_DURATION,
    ease: "none",
    onUpdate: () => {
      textEl.textContent = textAt(driver.t);
    },
  },
  0,
);

// Cursor blink — deterministic sin square wave, never a CSS animation
const blink = { p: 0 };
tl.to(
  blink,
  {
    p: Math.PI * 2 * BLINK_CYCLES,
    duration: TOTAL_DURATION,
    ease: "none",
    onUpdate: () => {
      cursorEl.style.opacity = Math.sin(blink.p) > 0 ? "1" : "0";
    },
  },
  0,
);
```

## Variations

- **Smooth character slice** (continuous typewriter — no pauses, no edits): faster to author but uniformly "machine-typed", missing the human realism:

```js
const fullText = "{fullPhrase}";
const len = { v: 0 };
tl.to(
  len,
  {
    v: fullText.length,
    duration: TYPE_DUR,
    ease: "power1.inOut",
    onUpdate: () => {
      textEl.textContent = fullText.substring(0, Math.floor(len.v));
    },
  },
  0,
);
```

- **Thinking pause** — hold one state for `THINK_HOLD_DUR` (0.8–2.0s; under 0.5s reads as a stutter, not thought) simply by leaving a gap before the next entry's `t`.
- **State pulse on completion** — when the final state lands, `tl.to(".text", { scale: 1.03–1.08, duration: 0.15–0.3, yoyo: true, repeat: 1 }, T_DONE)`.
- **Per-state color shift** — in `onUpdate`, branch on `driver.t` vs the milestones: success color after `T_DONE`, dim mid-edit, normal while typing.

## Values

| token               | range                                        | notes                                                                  |
| ------------------- | -------------------------------------------- | ---------------------------------------------------------------------- |
| TERMINAL_FONT_SIZE  | 48–96px                                      | full-bleed comps; smaller for terminal-style detail                    |
| TEXT_WRAP_MIN_WIDTH | ≥ widest state                               | measure with a hidden probe after `document.fonts.ready` if unsure     |
| milestone `t`s      | keystrokes 0.06–0.20s apart; pauses 0.3–0.6s | monotonically increasing; `T_DONE ≤ TOTAL_DURATION − ~1s` climax dwell |
| TYPE_DUR (smooth)   | `chars × 0.06–0.12s`                         | fast → relaxed                                                         |
| BLINK_CYCLES        | one cycle per 0.5–0.8s                       | `TOTAL_DURATION / 0.8 ≤ BLINK_CYCLES ≤ TOTAL_DURATION / 0.5`           |
| CURSOR_WIDTH        | ~0.3× font size                              | gap to text single-digit px so the cursor feels attached               |

## Critical Constraints

- **Reverse-search the array each frame** — O(n) with small n (≤30 typical); don't index by frame, the sequence is sparse.
- **`min-width` on the text wrap is mandatory** — without it the right edge jitters as state length changes.
- **Discrete jumps must be INSTANT** — any transition on the text turns the jump into a smear and kills the "typing" feel.
- **Cursor blink is sin/sequence-driven on the timeline**, `display: inline-block`, monospace font, `white-space: nowrap` (wrapping mid-state breaks the illusion; trailing spaces must survive).
- **Discrete vs smooth** — use discrete only for non-linear states (typos, pauses, bulk paste); plain typing takes the smooth-slice variation.

## See also

`context-sensitive-cursor` (same SEQUENCE pattern + segment-colored cursor) · `3d-text-depth-layers` (discrete text with layered depth) · `counting-dynamic-scale` (discrete label beside a smooth counter) · `press-release-spring` (post-completion press beat).

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

## Selected motion rule: viewport-change

---
name: viewport-change
description: Virtual camera — simulate zoom / pan / focus-lock by transforming a wrapper around all scene content. Camera moves right → world translates left.
metadata:
  tags: viewport, camera, zoom, pan, focus-lock, virtual-camera
---

# Viewport Change (Virtual Camera)

Simulates camera effects (zoom / pan / focus-lock on a moving element) by transforming a wrapper around ALL scene content. The "world" moves opposite to the perceived camera. Distinct from [multi-phase-camera](multi-phase-camera.md) (2-3 discrete phases + drift) — viewport-change is a single continuous zoom/pan, often used for focus-lock following a moving element.

## How It Works

Camera intent → world transform. Camera **pans right** → world `translateX(-distance)`; camera **zooms in** → world `scale(>1)`; camera **follows element X** → world `translateX(viewportCenter - elementWorldX)` per-frame. Get the sign right or everything moves the wrong way. The single `.world` wrapper holds the camera transform; elements inside are positioned in world space, unchanged.

**Single-element composite transform (this rule's form).** Both scale and translate live on ONE wrapper as `translate(x, y) scale(S)`. CSS applies scale FIRST, then translate (right-to-left matrix composition), so a point at world offset `(ox, oy)` lands on screen at `(S × ox + x, S × oy + y)`. To map the target to viewport center, solve `S × offset + T = 0`:

```
T = -offset × S
```

This is **different from [coordinate-target-zoom](coordinate-target-zoom.md)**, which uses two nested wrappers (outer scales, inner translates) and derives `T = -offset` (independent of S). Mixing up the two forms drifts the target off-center as scale changes. Use this single-wrapper form when you want one source of truth for camera state (`cam.scale`, `cam.x`, `cam.y`) written via `onUpdate`; use nested wrappers when scale and translate can tween independently with shared ease.

## Recipe

```html
<div class="world" id="world">
  <div class="content">
    <div class="hero">{Brand}</div>
    <div class="tagline">{tagline}</div>
    <div class="cta" id="cta">{ctaUrl}</div>
  </div>
</div>
```

```css
.scene {
  overflow: hidden; /* REQUIRED — any non-1.0 scale reveals edges or pushes content off-frame */
  background: {bgGradient}; /* on .scene, NOT .world — a world-borne background warps with the camera */
}
.world {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  transform-origin: 50% 50%; /* centered scaling is what the math assumes */
  will-change: transform;
}
```

```js
const world = document.getElementById("world");

// Camera state — single source of truth. The world transform is composed from
// this object in ONE place so the transform string order is stable.
const cam = { scale: 1, x: 0, y: 0 };
function applyCamera() {
  world.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.scale})`;
}
applyCamera(); // seed frame 0

// Zoom in on the CTA: single-element composite transform → T = -offset × S.
// TARGET_OFFSET_Y is the target's measured offset from viewport center at
// neutral camera (sign matters — positive = below center).
const counterY = -TARGET_OFFSET_Y * TARGET_SCALE;

tl.to(
  cam,
  {
    scale: TARGET_SCALE,
    y: counterY,
    duration: ZOOM_DUR,
    ease: "power3.inOut",
    onUpdate: applyCamera,
  },
  ZOOM_START,
);
```

## Scale Value Guide

| Effect      | Scale       | Feel                                |
| ----------- | ----------- | ----------------------------------- |
| Subtle      | 1.02 - 1.05 | Barely perceptible — "professional" |
| Medium      | 1.05 - 1.15 | "Ta-da" emphasis                    |
| Noticeable  | 1.15 - 1.30 | Focus on region                     |
| Dramatic    | 1.5 - 2.5   | Element fills screen                |
| Full-screen | 3.0+        | Element covers viewport             |

Perception: < 5% scale change is imperceptible; 10-15% is comfortable emphasis; > 30% is cinematic/dramatic. For a natural product feel, prefer 1.05-1.15× over 2-3s; save big > 1.3× zooms for dramatic narrative moments.

### Extreme range — 4–12× outward (workspace reveal)

The same single-cam math runs far past the table: a zoom-out workspace reveal opens punched-in at **4–12×** on one detail (a single cell, message, or button) and pulls out to the full workspace in one continuous move. The mechanics don't change — one `cam` object, `T = -offset × S`, one `applyCamera()` writer — only the authoring direction does:

- **Build the workspace at its final (1×) layout and OPEN scaled-in** (`cam.scale = 8`, counter-translate aiming the opening detail; state it in a `fromTo` / seed via `applyCamera()` so a seek to t=0 lands punched-in). The wide landing frame is then everything at native design size — text crisp, raster assets at source resolution.
- **Never the inverse** — authoring the close-up at 1× and scaling the world down to 0.08–0.25 for the wide frame drops every label below legible pixel size and softens raster media; the reveal lands on mush.
- **Measure the opening target** — at S = 8, a 1 px error in the baked offset is 8 px on screen at the opening pose. Take the offset from the target's real laid-out center (`getBoundingClientRect` after `fonts.ready`, once at setup — the measuring doctrine in [coordinate-target-zoom.md](coordinate-target-zoom.md)), never from a layout formula.
- **The opening detail must survive ×S** — it renders at `S ×` its design size on the first frames (vector/DOM text is safe; raster needs `sourceResolution ≥ rendered × S`).

## Variations

- **Focus-lock (camera follows a moving cursor/character)** — keep the element at a fixed screen X by computing the world offset per-frame inside the driver's `onUpdate`:

```js
const focusEl = document.querySelector(".moving-cursor");
const targetScreenX = VIEWPORT_WIDTH * FOCUS_SCREEN_X_FRAC; // 0.4–0.7; 0.5 = dead center
const focusUpdate = { p: 0 };
tl.to(
  focusUpdate,
  {
    p: 1,
    duration: FOLLOW_DUR, // matches how long the focused element is in motion
    ease: "power2.inOut",
    onUpdate: () => {
      const rect = focusEl.getBoundingClientRect();
      cam.x = targetScreenX - (rect.left + rect.width / 2);
      applyCamera();
    },
  },
  FOLLOW_START,
);
```

- **Composite scale (multi-phase)** — two proxy tweens multiplied through one writer: `cam.scale = scaleUp.v * scaleDown.v; applyCamera()`. Combine a slow push-in (~1.15) with a brief release (~0.9) for a breath/punch shape.
- **Camera mode transition (centered → follow)** — crossfade two camera modes via a 0→1 weight tween; intermediate frames interpolate between the modes' offsets.

## Values

| token           | range                                | notes                                                                                       |
| --------------- | ------------------------------------ | ------------------------------------------------------------------------------------------- |
| TARGET_OFFSET_Y | measured, not a free parameter       | target's offset from viewport center at neutral camera; measure via `getBoundingClientRect` |
| TARGET_SCALE    | 1.3× modest → 1.6–2.0× typical → 3×+ | raster media needs `sourceResolution ≥ rendered × TARGET_SCALE`                             |
| ZOOM_START      | content landed + ~0.5s scan time     | let the viewer read before the camera moves                                                 |
| ZOOM_DUR        | 1.0–2.0s                             | under 0.8s teleports, over 2.5s drags                                                       |
| DWELL           | ≥ 1.0s after the zoom settles        | the viewer must be able to read the focal point (climax dwell)                              |
| VIEWPORT_WIDTH  | = the root's `data-width`            | real value, not abstract                                                                    |

## Critical Constraints

- **One `.world` wrapper carries the whole camera** — every scene element lives inside it; a second transformed wrapper is a second camera.
- **Single source of truth via the `cam` object + `applyCamera()`** — when scale and translate both change, write them in ONE place; never split them across tweens that touch `world.style.transform` directly (the transform string composition order becomes unpredictable).
- **Single-wrapper counter-translate is `T = -offset × S`** — don't import the nested-wrapper `T = -offset` formula.
- **`overflow: hidden` on `.scene`**; **`transform-origin: 50% 50%` on `.world`**; **background on `.scene`, never on `.world`**.

## See also

[coordinate-target-zoom.md](coordinate-target-zoom.md) (nested-wrapper alternative, `T = -offset`) · [multi-phase-camera.md](multi-phase-camera.md) (viewport-change inside one phase) · [sine-wave-loop.md](sine-wave-loop.md) (idle micro-drift after the viewport settles).
