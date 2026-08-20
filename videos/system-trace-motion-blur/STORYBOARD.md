---
format: 1080x1920
duration: 53s advisory
message: "Motion blur spreads visible movement across time but does not add game updates or responsiveness"
arc: concept-explainer
frame_system: Broadside
audience: "players curious about frame rate and motion"
voice: "local Kokoro bm_george"
language: en-GB
music: none
captions: true
series: "SYSTEM TRACE"
episode: "13"
sources:
  - https://developer.nvidia.com/gpugems/gpugems3/part-iv-image-effects/chapter-27-motion-blur-post-processing-effect
  - https://dev.epicgames.com/documentation/en-us/unreal-engine/setting-up-motion-blur
  - https://dev.epicgames.com/documentation/en-us/unreal-engine/introduction-to-performance-profiling-and-configuration-in-unreal-engine
---

## Video direction

The Broadside system uses fire-orange #FF6B1A as its only accent, with cream
type on ink surfaces. Every original path diagram and timing rule stays inside
the top 83% of the portrait frame so captions retain their band. Reveal each
path component when its voiceover cue arrives, with sequential evidence still
developing across the back half of the shot. Motion is deterministic, finite
and driven by paused GSAP timelines: use smooth power3 long-tail settling, then
end each scene on a deliberate still hold. Frames 4 and 6 are the planned
breathers. Ban front-loaded slideshow assembly, screensaver drift, lazy
breathing, bounce, randomness and repeat.

## Frame 1 - A softer gap

- scene: Two sampled positions of a moving square sit apart, then a translucent path fills the gap without adding a third sample.
- voiceover: "Motion blur cannot create extra frames, yet it can make the movement between existing frames feel less harsh."
- duration: 8.8s
- poster: 6.0s
- transition_in: cut
- status: animated
- src: compositions/frames/01-softer-gap.html
- type: hook
- persuasion: Expectation reversal
- beat: Curiosity
- blueprint: kinetic-type-beats (Adapt)
- focal: FRAME GAPS becoming one MOTION PATH without a new sample marker
- roles: sampled squares = foreground proof · translucent path = foreground mechanism · timing ruler = supporting · dark field = background
- source_trace: NVIDIA GPU Gems motion-blur post-processing explanation
- sfx: none

Scene 1 (0.0-2.8s): In a centred top-83% timing strip, two fire-orange sampled positions arrive sequentially by cluster→outward expansion (`center-outward-expansion`).

Scene 2 (2.8-5.9s): On "make the movement", a single fire-orange trail extends between them using motion-blur streak (`motion-blur-streak`) while the ruler remains fixed.

Scene 3 (5.9-8.8s): VISUAL CONTINUITY / SAME FRAME COUNT lands through hard-cut word-swap (`discrete-text-sequence`), settles with power3 and holds still in the top 83%.

narrativeRole: Opens by separating a smoother-looking path from additional rendered frames.
keyMessage: Blur can soften the visual gap without creating a new frame.

## Frame 2 - The shutter path

- scene: An original shutter window spans a moving object path, accumulating a streak during exposure.
- voiceover: "A real camera gathers light while its shutter is open, so a fast object leaves a streak across that exposure."
- duration: 8.7s
- poster: 6.1s
- transition_in: cut
- status: animated
- src: compositions/frames/02-shutter-path.html
- type: product_intro
- persuasion: Physical analogy
- beat: Orientation
- blueprint: spatial-pan-stations (Adapt)
- focal: SHUTTER OPEN spanning a moving object and its streak
- roles: shutter window = foreground diagram · moving square = foreground subject · exposure ruler = supporting · dark field = background
- source_trace: Epic motion-blur documentation, blur as movement during image capture
- sfx: none

Scene 1 (0.0-2.7s): In a top-83% layered-depth diagram, SHUTTER OPEN reveals word-by-word (`dynamic-content-sequencing`) above the motion path.

Scene 2 (2.7-5.8s): When "moves while its shutter is open" is spoken, the square crosses the window by nudge-curve (`nudge-curve`) and leaves one finite fire-orange motion-blur streak (`motion-blur-streak`).

Scene 3 (5.8-8.7s): FAST OBJECT / LONGER STREAK reveals by in-place token cycle (`discrete-text-sequence`), power3-settles and holds still beside the top-83% path.

narrativeRole: Grounds the effect in exposure over time.
keyMessage: Motion blur represents movement that occurs while an image is captured.

## Frame 3 - The game estimate

- scene: Per-pixel arrows drive an original sample-and-blend rail along a moving object's direction.
- voiceover: "Games often estimate the same path with per-pixel velocity, then sample and blend colour along the direction of travel."
- duration: 9.2s
- poster: 6.2s
- transition_in: crossfade
- status: animated
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

## Frame 4 - A continuous-looking path

- scene: A 30 FPS timing ruler shows discrete object positions on one Broadside panel and blurred intervals on the other.
- voiceover: "That spread hides some of the step between two positions, which can make thirty frames per second look more continuous."
- duration: 8.6s
- poster: 6.3s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/04-continuous-path.html
- type: feature_showcase
- persuasion: Side-by-side proof
- beat: Recognition
- blueprint: comparison-split (Adapt)
- focal: 30 FPS positions compared with a blended MOTION PATH
- roles: discrete positions = foreground comparison · blur intervals = foreground payoff · timing ruler = supporting · dark field = background
- source_trace: NVIDIA GPU Gems statement that motion blur can smooth a game's appearance at 30 FPS or lower
- sfx: none

Scene 1 (0.0-2.8s): In a stacked top-83% comparison, three discrete positions land one by one via waterfall-entry (`waterfall-entry`) on the 30 FPS ruler.

Scene 2 (2.8-5.9s): On "spread hides some of the step", one finite fire-orange motion-blur streak (`motion-blur-streak`) bridges each interval while the ruler stays locked.

Scene 3 (5.9-8.6s): MORE CONTINUOUS / NOT MORE FRAMES enters by hard-cut word-swap (`discrete-text-sequence`), then the deliberate breather holds still.

narrativeRole: Connects the blur trail to the perception of less abrupt movement.
keyMessage: Blur can make the same low-rate positions look more continuous.

## Frame 5 - What blur cannot repair

- scene: A velocity-buffer diagram marks reflections, shadows and crossing objects as separate cases with incomplete motion evidence.
- voiceover: "It does not update controls sooner, repair a stutter or perfectly handle every reflection, shadow and crossing object."
- duration: 9.2s
- poster: 6.4s
- transition_in: cut
- status: animated
- src: compositions/frames/05-blur-limits.html
- type: feature_showcase
- persuasion: Honest qualification
- beat: Nuance
- blueprint: dataviz-countup (Adapt)
- focal: SAME UPDATE RATE beside three dim limitation markers
- roles: input clock = foreground rule · reflection, shadow and crossing markers = foreground warnings · velocity grid = supporting · dark field = background
- source_trace: Epic motion-blur documentation, one vector per pixel, secondary-motion limits and crossing-object artefacts
- sfx: none

Scene 1 (0.0-3.1s): In an asymmetric top-83% panel, the INPUT clock enters through per-word staggered reveal (`dynamic-content-sequencing`) while the path gets one finite motion-blur streak (`motion-blur-streak`).

Scene 2 (3.1-6.3s): As each limitation is named, REFLECTION LIMIT, SHADOW LIMIT and CROSSING LIMIT reveal in a vertical cascade via waterfall-entry (`waterfall-entry`) over their original diagrams.

Scene 3 (6.3-9.2s): SAME UPDATE RATE lands with an in-place token cycle (`discrete-text-sequence`), power3-settles and holds still while the ink limitation markers remain readable.

narrativeRole: States the technique's perceptual benefit without confusing it with responsiveness or perfect reconstruction.
keyMessage: Motion blur cannot supply missing updates or reliably model every moving visual element.

## Frame 6 - Visual glue

- scene: A final original rule card joins sampled positions with a blur path while the update clock stays unchanged.
- voiceover: "Motion blur is therefore visual glue, not more performance. It can soften the gap, while the game still updates at the same rate."
- duration: 8.6s
- poster: 6.5s
- transition_in: blur-crossfade
- status: animated
- src: compositions/frames/06-visual-glue.html
- type: branding
- persuasion: Distillation
- beat: Resolve
- blueprint: titlecard-reveal (Adapt)
- focal: SOFTEN THE GAP / SAME UPDATE RATE
- roles: final rule card = foreground diagram · sampled path and update clock = supporting · SYSTEM TRACE // 13 = background marker
- source_trace: NVIDIA and Epic motion-blur documentation
- sfx: none

Scene 1 (0.0-2.8s): In a centred top-83% rule card, two sampled positions and the update clock reveal in sequence through dynamic-content-sequencing (`dynamic-content-sequencing`).

Scene 2 (2.8-5.9s): On "soften the gap", one finite fire-orange motion-blur streak (`motion-blur-streak`) joins the positions without altering the clock.

Scene 3 (5.9-8.6s): SOFTEN THE GAP / SAME UPDATE RATE resolves through one restrained scale-swap (`scale-swap-transition`), then holds still with SYSTEM TRACE // 13.

narrativeRole: Closes on the exact boundary between visual smoothing and performance.
keyMessage: Motion blur is a presentation effect layered over the existing update rate.
