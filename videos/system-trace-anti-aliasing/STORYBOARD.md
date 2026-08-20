---
format: 1080x1920
duration: 53s advisory
message: "Anti-aliasing replaces hard pixel steps with coverage or image evidence, each with a different compromise"
arc: concept-explainer
frame_system: Broadside
audience: "players curious about image quality"
voice: "local Kokoro bm_george"
language: en-GB
music: none
captions: true
series: "SYSTEM TRACE"
episode: "12"
sources:
  - https://learn.microsoft.com/en-us/windows/win32/direct3d11/d3d10-graphics-programming-guide-rasterizer-stage-rules
  - https://dev.epicgames.com/documentation/en-us/unreal-engine/cinematic-rendering-image-quality-settings-in-unreal-engine
---

## Video direction

The Broadside system uses fire-orange #FF6B1A as its only accent, with cream
type on ink surfaces. Every original diagram and rule card stays inside the top
83% of the portrait frame, leaving the caption band clear. Reveal only the
element named by the voiceover, then place later evidence on its spoken cue,
especially across the back half of each shot. Motion is deterministic, finite
and driven by paused GSAP timelines: use smooth power3 long-tail settling,
then end each scene on a deliberate still hold. Frames 3 and 6 are the planned
breathers. Ban front-loaded slideshow assembly, screensaver drift, lazy
breathing, bounce, randomness and repeat.

## Frame 1 - The pixel staircase

- scene: An original square pixel grid carries one diagonal vector line that resolves into a visible stepped edge.
- voiceover: "A perfectly straight diagonal can look like a staircase in a game because the screen still draws a square pixel grid."
- duration: 8.8s
- poster: 6.0s
- transition_in: cut
- status: animated
- src: compositions/frames/01-pixel-staircase.html
- type: hook
- persuasion: Counterintuitive reveal
- beat: Curiosity
- blueprint: kinetic-type-beats (Adapt)
- focal: a clean DIAGONAL EDGE becoming a PIXEL STAIRCASE
- roles: diagonal line and square grid = foreground diagram · SYSTEM TRACE // 12 = supporting marker · dark field = background
- source_trace: Microsoft Direct3D rasterisation rules, pixel coverage and multisample context
- sfx: none

Scene 1 (0.0-2.8s): In a centred, layered-depth portrait layout within the top 83%, PERFECTLY STRAIGHT enters by per-word staggered reveal (`dynamic-content-sequencing`) as a fire-orange diagonal draws via SVG self-draw (`svg-path-draw`).

Scene 2 (2.8-5.9s): On the spoken "staircase" cue, top-83% grid cells reveal sequentially through cluster→outward expansion (`center-outward-expansion`), then PIXEL STAIRCASE lands by hard-cut word-swap (`discrete-text-sequence`).

Scene 3 (5.9-8.8s): The large top-83% vector and stepped edge receive one finite fire-orange keyword glow (`asr-keyword-glow`) on "visible steps", then power3-settle and hold still for the read.

narrativeRole: Establishes why a continuous edge becomes discontinuous on a pixel grid.
keyMessage: A diagonal can look stepped because pixels are square and discrete.

## Frame 2 - A binary edge

- scene: A Broadside comparison shows edge cells marked FULL or EMPTY beside the same diagonal.
- voiceover: "Without anti-aliasing, each edge pixel becomes fully covered or fully empty, creating a hard sequence of visible steps."
- duration: 8.7s
- poster: 6.1s
- transition_in: cut
- status: animated
- src: compositions/frames/02-binary-edge.html
- type: product_intro
- persuasion: Binary contrast
- beat: Recognition
- blueprint: spatial-pan-stations (Adapt)
- focal: FULL OR EMPTY edge cells making a saw-tooth outline
- roles: binary cell pair = foreground diagram · diagonal guide = supporting · sample labels = background
- source_trace: Microsoft Direct3D rasterisation rules, coverage testing before multisampling
- sfx: none

Scene 1 (0.0-2.7s): In a top-83% full-width strip, the guide line enters with SVG self-draw (`svg-path-draw`) across four initially unmarked cells.

Scene 2 (2.7-5.8s): As "fully covered or fully empty" is spoken, the cells resolve in a fixed-anchor cycle (`discrete-text-sequence`) to FULL or EMPTY, keeping the guide line pinned above.

Scene 3 (5.8-8.7s): BINARY EDGE arrives by per-word staggered reveal (`dynamic-content-sequencing`) beside the top-83% saw-tooth, settles with power3 and holds still.

narrativeRole: Makes the visible steps a consequence of an all-or-nothing edge decision.
keyMessage: A binary coverage decision creates hard pixel steps.

## Frame 3 - Coverage, not a guess

- scene: Four sub-pixel probes test a single edge cell and combine into a partial-coverage fill.
- voiceover: "MSAA checks several sub-pixel coverage positions, letting an edge pixel represent a blend instead of a binary answer."
- duration: 8.9s
- poster: 6.2s
- transition_in: crossfade
- status: animated
- src: compositions/frames/03-msaa-coverage.html
- type: feature_showcase
- persuasion: Mechanism reveal
- beat: Clarity
- blueprint: fixed-anchor-cycle (Adapt)
- focal: four SUB-PIXEL CHECKS resolving to PARTIAL COVERAGE
- roles: probe positions = foreground mechanism · edge cell = foreground proof · coverage meter = supporting · grid = background
- source_trace: Microsoft Direct3D MSAA documentation, multiple sub-sample coverage and depth-stencil tests
- sfx: none

Scene 1 (0.0-3.0s): In a centred top-83% macro cell, the diagonal guide draws with SVG self-draw (`svg-path-draw`) and four probe positions reveal by cluster→outward expansion (`center-outward-expansion`).

Scene 2 (3.0-6.2s): On "several sub-pixel coverage positions", covered probes take the fire-orange emphasis through keyword glow (`asr-keyword-glow`) while the top-83% coverage meter fills by bars / progress fill (`stat-bars-and-fills`).

Scene 3 (6.2-8.9s): PARTIAL COVERAGE resolves with an in-place token cycle (`discrete-text-sequence`) beside the blended cell, then the Broadside card holds still.

narrativeRole: Introduces MSAA as a coverage measurement rather than a simple blur.
keyMessage: MSAA can represent fractional edge coverage with multiple sub-pixel samples.

## Frame 4 - The fast image pass

- scene: A finished image passes through an original edge detector that softens only its jagged outline.
- voiceover: "FXAA searches the finished image for jagged patterns and smooths them quickly, though fine detail can become softer."
- duration: 8.9s
- poster: 6.3s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/04-fxaa-finish-pass.html
- type: feature_showcase
- persuasion: Before-after comparison
- beat: Understanding
- blueprint: comparison-split (Adapt)
- focal: FINISHED IMAGE entering an EDGE PASS and leaving smoother but softer
- roles: image tiles = foreground diagram · edge detector = foreground mechanism · fine-detail inset = supporting · dark field = background
- source_trace: Epic cinematic rendering documentation, FXAA as fast screen-space smoothing with lower fine-detail precision
- sfx: none

Scene 1 (0.0-2.9s): In a stacked top-83% comparison, the jagged FINISHED IMAGE tile enters through a scale-swap (`scale-swap-transition`) into the EDGE PASS aperture.

Scene 2 (2.9-6.1s): When "smooths them quickly" lands, the outline hand-off uses card morph-anchor (`card-morph-anchor`) while the fine-detail inset receives a finite selective-blur (`depth-of-field-blur`).

Scene 3 (6.1-8.9s): FAST PASS and DETAIL SOFTER arrive by hard-cut word-swap (`discrete-text-sequence`), settle with power3 and hold still in the top 83%.

narrativeRole: Separates a finished-image filter from geometry coverage sampling.
keyMessage: FXAA is quick screen-space smoothing that can soften fine detail.

## Frame 5 - Borrowed history

- scene: Previous-frame samples reproject toward a moving edge, with one misaligned sample becoming a ghost trail.
- voiceover: "Temporal methods borrow evidence from earlier frames, improving stability but risking ghosting when history no longer matches motion."
- duration: 9.1s
- poster: 6.4s
- transition_in: cut
- status: animated
- src: compositions/frames/05-temporal-history.html
- type: feature_showcase
- persuasion: Cautionary contrast
- beat: Nuance
- blueprint: dataviz-countup (Adapt)
- focal: TEMPORAL HISTORY aligning once and ghosting once
- roles: current edge = foreground anchor · history samples = foreground mechanism · ghost trail = supporting warning · time ruler = background
- source_trace: Epic cinematic rendering documentation, TemporalAA history use and ghosting risk
- sfx: none

Scene 1 (0.0-3.0s): In an asymmetric top-83% layout, the current edge pins while the previous sample travels along an SVG self-drawn motion arrow (`svg-path-draw`).

Scene 2 (3.0-6.2s): On "improving stability", the aligned sample lands through scale-swap (`scale-swap-transition`); on "ghosting", the late sample leaves one deterministic echo using motion-blur streak (`motion-blur-streak`).

Scene 3 (6.2-9.1s): STABLE HISTORY and GHOSTING RISK reveal on their spoken cues by per-word staggered reveal (`dynamic-content-sequencing`), then both top-83% paths hold still.

narrativeRole: Shows why temporal stability depends on history still matching present motion.
keyMessage: Earlier-frame evidence can stabilise edges but can also leave ghosting.

## Frame 6 - The trade-off

- scene: A final original decision board places MSAA, FXAA and temporal methods on separate compromise paths.
- voiceover: "So anti-aliasing is not one filter. Every method trades cleaner edges against cost, softness or artefacts across time."
- duration: 8.8s
- poster: 6.5s
- transition_in: blur-crossfade
- status: animated
- src: compositions/frames/06-choose-the-trade-off.html
- type: branding
- persuasion: Distillation
- beat: Resolve
- blueprint: titlecard-reveal (Adapt)
- focal: CLEANER EDGES / CHOOSE THE TRADE-OFF
- roles: decision board = foreground diagram · method cards = supporting · SYSTEM TRACE // 12 = background marker
- source_trace: Microsoft MSAA documentation and Epic anti-aliasing method documentation
- sfx: none

Scene 1 (0.0-2.9s): In a vertical top-83% rail stack, MSAA, FXAA and TEMPORAL enter sequentially by waterfall-entry (`waterfall-entry`) rather than together.

Scene 2 (2.9-6.0s): Each compromise appears only on its spoken cue through in-place token cycle (`discrete-text-sequence`), with a finite fire-orange keyword glow (`asr-keyword-glow`) on COST, SOFTNESS and HISTORY ARTEFACTS.

Scene 3 (6.0-8.8s): CLEANER EDGES / CHOOSE THE TRADE-OFF arrives through one restrained scale-swap (`scale-swap-transition`), power3-settles and holds still.

narrativeRole: Ends with method choice rather than a claim that one technique is universally best.
keyMessage: Anti-aliasing methods trade edge quality against different costs and artefacts.
