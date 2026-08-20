---
format: 1080x1920
duration: 53.8s advisory
message: "Frame generation inserts predicted display images between rendered frames, so base rate, pacing and latency still matter"
arc: concept-explainer
frame_system: Broadside
audience: "players curious about AI and optical-flow frame generation"
voice: "local Kokoro bm_george"
language: en-GB
music: none
captions: true
series: "SYSTEM TRACE"
episode: "14"
sources:
  - https://gpuopen.com/manuals/fidelityfx_sdk/techniques/super-resolution-interpolation/
  - https://gpuopen.com/amd-fsr-framegeneration/
  - https://developer.nvidia.com/rtx/dlss
---

## Video direction

The Broadside system uses fire-orange #FF6B1A as its only accent, with cream
type on ink surfaces. Every original timeline, evidence card and rule sits in
the top 83% of the portrait frame, leaving the caption band free. Reveal a
rendered input, then each later evidence layer only as the voiceover names it,
with the back half completing the explanation. Motion is deterministic, finite
and driven by paused GSAP timelines: use smooth power3 long-tail settling, then
end each scene on a deliberate still hold. Frames 4 and 6 are the planned
breathers. Ban front-loaded slideshow assembly, screensaver drift, lazy
breathing, bounce, randomness and repeat.

## Frame 1 - The inserted image

- scene: Two engine-rendered image cards bracket one fire-orange synthetic card on a display timeline.
- voiceover: "Frame generation can make motion look much smoother, but the new image between two frames was not fully rendered by the game."
- duration: 9.0s
- poster: 6.0s
- transition_in: cut
- status: animated
- src: compositions/frames/01-inserted-image.html
- type: hook
- persuasion: Counterintuitive contrast
- beat: Curiosity
- blueprint: kinetic-type-beats (Adapt)
- focal: RENDERED A / SYNTHESISED MID / RENDERED B
- roles: three frame cards = foreground diagram · engine and display rails = supporting · dark field = background
- source_trace: AMD FSR 3 documentation, additional frame generated between two rendered frames
- sfx: none

Scene 1 (0.0-3.0s): In a top-83% full-width engine rail, RENDERED A and RENDERED B land sequentially by waterfall-entry (`waterfall-entry`), preserving the visible gap.

Scene 2 (3.0-6.2s): On "new image between two frames", fire-orange SYNTHESISED MID enters through card morph-anchor (`card-morph-anchor`) on the display rail between them.

Scene 3 (6.2-9.0s): INSERTED FOR DISPLAY arrives by per-word staggered reveal (`dynamic-content-sequencing`), then both top-83% rails power3-settle and hold still.

narrativeRole: Separates the inserted display image from a fully rendered engine frame.
keyMessage: Frame generation adds an intermediate presentation image between rendered frames.

## Frame 2 - The evidence

- scene: Four original evidence cards feed a central interpolation resolver: optical flow, motion vectors, depth and camera data.
- voiceover: "The system examines consecutive frames plus motion evidence such as optical flow, motion vectors, depth and camera data."
- duration: 8.8s
- poster: 6.1s
- transition_in: cut
- status: animated
- src: compositions/frames/02-motion-evidence.html
- type: product_intro
- persuasion: Evidence map
- beat: Orientation
- blueprint: spatial-pan-stations (Adapt)
- focal: OPTICAL FLOW, MOTION VECTORS, DEPTH and CAMERA DATA converging
- roles: evidence cards = foreground mechanism · resolver = foreground anchor · connection rails = supporting · dark field = background
- source_trace: AMD FSR frame-generation documentation and NVIDIA DLSS developer integration inputs
- sfx: none

Scene 1 (0.0-2.8s): In a centred top-83% evidence map, consecutive frames arrive first, followed by OPTICAL FLOW and MOTION VECTORS through cluster→outward expansion (`center-outward-expansion`).

Scene 2 (2.8-6.0s): On their spoken cues, DEPTH and CAMERA DATA join via dynamic-content-sequencing (`dynamic-content-sequencing`) on separate rails with one plain question per card.

Scene 3 (6.0-8.8s): The top-83% rails converge at INTERPOLATE through SVG self-draw (`svg-path-draw`), power3-settle and hold still with no vendor logo or quality-mode label.

narrativeRole: Names the visual evidence that informs the inserted image.
keyMessage: Frame generation uses consecutive images and motion-related rendering data.

## Frame 3 - The in-between prediction

- scene: Original pixel clusters travel along optical-flow paths from rendered A to rendered B, resolving as a middle image.
- voiceover: "It predicts where visible pixels belong between those moments, then synthesises an intermediate image for the display."
- duration: 9.0s
- poster: 6.2s
- transition_in: crossfade
- status: animated
- src: compositions/frames/03-pixel-prediction.html
- type: feature_showcase
- persuasion: Mechanism reveal
- beat: Clarity
- blueprint: fixed-anchor-cycle (Adapt)
- focal: predicted pixel paths resolving into SYNTHESISED MID
- roles: source pixel clusters = foreground evidence · flow paths = foreground mechanism · middle image = foreground payoff · dark grid = background
- source_trace: AMD FSR 3 interpolation documentation, reprojection from two rendered frames with optical flow
- sfx: none

Scene 1 (0.0-3.0s): In a top-83% split vertical strip, A and B reveal one after another by in-place token cycle (`discrete-text-sequence`) around the same object in two positions.

Scene 2 (3.0-6.2s): As "predicts where visible pixels belong" is spoken, fire-orange pixel clusters travel along explicit curves with SVG self-draw (`svg-path-draw`) and nudge-curve (`nudge-curve`).

Scene 3 (6.2-9.0s): SYNTHESISED MID resolves through scale-swap (`scale-swap-transition`), then the top-83% middle card holds still.

narrativeRole: Turns abstract interpolation into a readable original pixel-path diagram.
keyMessage: The generated image predicts intermediate visible pixel positions.

## Frame 4 - Two rates remain

- scene: The display rail contains rendered and synthetic cards while a separate simulation-and-input rail advances only on rendered-frame ticks.
- voiceover: "The displayed frame rate rises, while game simulation and input sampling still follow the underlying rendered frames."
- duration: 8.8s
- poster: 6.3s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/04-two-rates.html
- type: feature_showcase
- persuasion: Rate comparison
- beat: Understanding
- blueprint: comparison-split (Adapt)
- focal: DISPLAY RATE above SIMULATION RATE with different tick counts
- roles: display rail = foreground payoff · simulation rail = foreground constraint · input pulse = supporting · timing ruler = background
- source_trace: AMD FSR 3 documentation, generated frame between rendered frames, plus AMD frame-generation latency guidance
- sfx: none

Scene 1 (0.0-2.8s): In a stacked top-83% rate comparison, the simulation rail ticks at A then B via dynamic-content-sequencing (`dynamic-content-sequencing`), each tagged ENGINE STEP.

Scene 2 (2.8-5.9s): On "displayed frame rate rises", the display rail adds fire-orange SYNTHESISED MID through card morph-anchor (`card-morph-anchor`) and shows the denser rhythm.

Scene 3 (5.9-8.8s): DISPLAY RATE RISES / SIMULATION RATE HOLDS arrives by hard-cut word-swap (`discrete-text-sequence`), power3-settles and holds still as the planned breather.

narrativeRole: Prevents higher displayed FPS from being mistaken for more simulation or input samples.
keyMessage: Generated presentation frames do not add engine simulation steps.

## Frame 5 - Weak evidence shows

- scene: A pacing meter sits beside three original challenge tiles for rapid motion, scene changes and interface elements.
- voiceover: "Interpolation also needs careful pacing and can distort rapid motion, scene changes or interface elements when its evidence is weak."
- duration: 9.2s
- poster: 6.4s
- transition_in: cut
- status: animated
- src: compositions/frames/05-pacing-and-limits.html
- type: feature_showcase
- persuasion: Honest qualification
- beat: Nuance
- blueprint: dataviz-countup (Adapt)
- focal: PACE THE PRESENT beside three uncertain-image tiles
- roles: pacing meter = foreground rule · challenge tiles = foreground warning · source-frame rails = supporting · dark field = background
- source_trace: AMD FSR 3 technical manual, frame pacing and UI composition requirements
- sfx: none

Scene 1 (0.0-3.1s): In a top-83% data instrument, the display pacing meter fills with bars / progress fill (`stat-bars-and-fills`) to align rendered and synthetic presents on a stable ruler.

Scene 2 (3.1-6.4s): On each spoken caution, RAPID MOTION, SCENE CHANGE and UI ELEMENT tiles reveal sequentially through waterfall-entry (`waterfall-entry`) and expose ink uncertain regions.

Scene 3 (6.4-9.2s): PACE THE PRESENT / CHECK THE EVIDENCE lands through keyword glow (`asr-keyword-glow`), then the top-83% rule holds still.

narrativeRole: Explains why visual prediction needs paced delivery and careful handling of difficult content.
keyMessage: Weak or changing evidence can produce visible interpolation artefacts.

## Frame 6 - A healthy base

- scene: A final original ladder places a stable rendered cadence below a smoother display cadence, joined by one bounded rule.
- voiceover: "Frame generation is best understood as visual interpolation: smoother presentation built on top of a healthy base frame rate."
- duration: 9.0s
- poster: 6.5s
- transition_in: blur-crossfade
- status: animated
- src: compositions/frames/06-healthy-base.html
- type: branding
- persuasion: Distillation
- beat: Resolve
- blueprint: titlecard-reveal (Adapt)
- focal: HEALTHY BASE / INTERPOLATE THE VIEW
- roles: cadence ladder = foreground diagram · rendered and display rails = supporting · SYSTEM TRACE // 14 = background marker
- source_trace: AMD FSR 3 documentation, minimum pre-interpolation frame-rate guidance and frame-pacing requirements
- sfx: none

Scene 1 (0.0-2.8s): In a centred top-83% two-rung ladder, the stable fire-orange rendered cadence enters sequentially via dynamic-content-sequencing (`dynamic-content-sequencing`).

Scene 2 (2.8-5.9s): On "smoother presentation", fire-orange synthesised cards fill the display rung through cluster→outward expansion (`center-outward-expansion`) while the base remains visible underneath.

Scene 3 (5.9-8.7s): HEALTHY BASE / INTERPOLATE THE VIEW resolves with one restrained scale-swap (`scale-swap-transition`), power3-settles and holds still with SYSTEM TRACE // 14.

narrativeRole: Closes on frame generation as a presentation layer that depends on a sound rendered baseline.
keyMessage: Frame generation improves perceived presentation when the base rendered cadence is healthy.
