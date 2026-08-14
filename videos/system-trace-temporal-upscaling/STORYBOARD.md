---
format: 1080x1920
duration: 56s
message: "Temporal upscaling reconstructs a moving high-resolution image from current pixels and motion-aware history"
arc: concept-explainer
audience: "players curious about image reconstruction"
mode: autonomous
music: "restrained minimal electronic pulse, analytical rather than ominous, no vocals"
captions: true
series: "SYSTEM TRACE"
episode: "03"
---

## Video direction

The visual metaphor is an evidence board made of pixels. Every new input earns
its place on screen only when named. Amber is incoming evidence, cyan is history
that survives validation and dim orange is rejected history. Keep the process
legible at phone scale and never show a vendor-branded quality mode.

## Frame 1 — Fewer pixels in

- scene: A sparse 1080P pixel field occupies one quarter of a 4K grid, then temporal samples populate the missing cells.
- voiceover: "That sharp four-K image may start smaller. Many games render fewer pixels, then rebuild detail using information gathered across time."
- duration: 9.387s
- poster: 6.0s
- transition_in: cut
- status: animated
- src: compositions/frames/01-fewer-pixels.html
- type: hook
- persuasion: Counterintuitive reveal
- beat: Surprise + curiosity
- blueprint: kinetic-type-beats (Adapt)
- focal: the state swap from FEWER PIXELS to DENSER OUTPUT over one growing grid
- roles: sparse grid = foreground subject · populated grid = foreground payoff · 1080P and 4K labels = supporting · dark pixel field = background
- sfx: impact-bass-1, glitch-1

Adapt: replace a central word in place while the underlying pixel grid proves
the changed state.

Scene 1 (0.0–2.7s): FEWER PIXELS and a sparse amber grid reveal at the portrait
golden centre; 1080P sits as a small source label.

Scene 2 (2.7–6.0s): A 4K boundary draws around the smaller grid. Empty cells
remain obvious while PULL / NOT STRETCH? interrupts the headline.

Scene 3 (6.0–8.7s): Samples from three earlier time slices sweep into different
cells and the headline swaps to DENSER OUTPUT before a readable hold.

narrativeRole: Opens by separating output resolution from the resolution of one new render.
keyMessage: The final dense image can be reconstructed from fewer newly rendered pixels.

## Frame 2 — Four inputs

- scene: CURRENT FRAME, MOTION, DEPTH and HISTORY arrive as four evidence cards and connect to one resolver.
- voiceover: "A temporal upscaler gets the new frame, motion vectors, depth and samples from earlier frames. Each input answers a different question."
- duration: 9.109s
- poster: 6.8s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/02-four-inputs.html
- type: product_intro
- persuasion: Progressive disclosure + system map
- beat: Orientation + clarity
- blueprint: spatial-pan-stations (Adapt)
- focal: the four evidence cards converging on the RECONSTRUCT resolver
- roles: RECONSTRUCT resolver = foreground subject · current, motion, depth and history cards = supporting stations · connection rails = midground · dark field = background
- sfx: click-soft, whoosh-short

Adapt: pan through four vertical stations, then settle on the resolver that
receives all four.

Scene 1 (0.0–3.1s): CURRENT FRAME enters at the top, followed by MOTION with
small arrow vectors drawn only as the word is spoken.

Scene 2 (3.1–6.5s): The camera pans down to DEPTH and HISTORY. Their planes and
stacked sample tiles reveal independently.

Scene 3 (6.5–9.4s): Four rails converge into RECONSTRUCT. Question labels attach:
WHAT IS NEW? WHERE MOVED? WHAT IS IN FRONT? WHAT CAN RETURN?

narrativeRole: Names the main evidence sources without presenting them as interchangeable.
keyMessage: Reconstruction depends on current colour, motion, depth and history.

## Frame 3 — Reproject the history

- scene: Three history tiles follow motion-vector paths into their new screen positions while depth keeps the foreground tile in front.
- voiceover: "Motion vectors show where surfaces moved. Depth separates foreground from background. History supplies detail that one lower-resolution frame cannot hold."
- duration: 10.603s
- poster: 7.2s
- transition_in: crossfade
- status: animated
- src: compositions/frames/03-reproject-history.html
- type: feature_showcase
- persuasion: Animated mechanism + causal chain
- beat: Comprehension + satisfaction
- blueprint: fixed-anchor-cycle (Adapt)
- focal: a pinned current-view window receiving motion-corrected history tiles
- roles: current-view window = foreground anchor · moving history tiles and vector paths = foreground mechanism · depth layers = supporting · time ruler = background
- sfx: click, whoosh

Adapt: pin the current-view window while adjacent history states cycle and move
into it on explicit vector paths.

Scene 1 (0.0–3.2s): CURRENT VIEW pins. Three older sample tiles wait on a dim
time ruler beside it.

Scene 2 (3.2–7.0s): Motion arrows self-draw and each tile travels into a new
location. The destination flashes cyan when aligned.

Scene 3 (7.0–9.8s): A foreground depth plane slides above the background plane,
preventing one tile from crossing the boundary. DETAIL FROM HISTORY holds.

narrativeRole: Shows how historical detail is moved and layered into the present view.
keyMessage: Motion and depth make temporal reuse spatially meaningful.

## Frame 4 — Keep or reject

- scene: A history-validation gate keeps aligned samples and rejects a tile exposed by a newly revealed background region.
- voiceover: "The system reprojects useful history into the current view and rejects what no longer belongs. Done well, the result looks far denser."
- duration: 8.96s
- poster: 6.4s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/04-history-gate.html
- type: social_proof
- persuasion: Decision rule + payoff
- beat: Tension + confidence
- blueprint: comparison-split (Adapt)
- focal: the KEEP / REJECT validation gate applied to matched and exposed samples
- roles: KEEP panel = foreground payoff · REJECT panel = foreground comparison · disocclusion mask and sample tiles = supporting · dark split field = background
- sfx: click-soft, notification

Adapt: stack KEEP and REJECT vertically with matched sample geometry, then merge
only the accepted samples into the output.

Scene 1 (0.0–2.8s): An aligned sample enters KEEP and turns cyan. Its current and
historical outlines overlap exactly.

Scene 2 (2.8–6.1s): A foreground shape moves away, exposing new background. The
old foreground sample enters REJECT and fades to a dim strike-through.

Scene 3 (6.1–8.8s): Accepted history combines with new pixels in a denser output
grid. USEFUL PAST / CURRENT TRUTH holds.

narrativeRole: Makes validation as important as accumulation.
keyMessage: Temporal detail helps only when stale information is rejected.

## Frame 5 — When history fails

- scene: A clean reference trace splits into GHOSTING and SHIMMER failure instruments around fast reveals and thin geometry.
- voiceover: "Fast reveals, thin geometry and particles can break history. Old samples may ghost, while fresh pixels may shimmer before enough evidence arrives."
- duration: 10.091s
- poster: 7.3s
- transition_in: crossfade
- status: animated
- src: compositions/frames/05-history-failures.html
- type: feature_showcase
- persuasion: Failure-mode comparison
- beat: Recognition + nuance
- blueprint: dataviz-countup (Adapt)
- focal: paired GHOSTING and SHIMMER instruments tied to different history problems
- roles: ghost trail and shimmer samples = foreground subjects · fast-reveal and thin-edge triggers = supporting · confidence meters = supporting · dark analysis grid = background
- sfx: glitch-2, impact-bass-1

Adapt: keep two compact proof instruments and reveal each failure only when its
cause is named.

Scene 1 (0.0–3.1s): A fast-moving tile leaves one dim historical silhouette.
GHOSTING and an OLD SAMPLE meter enter.

Scene 2 (3.1–7.0s): A thin diagonal edge alternates between sparse sample
patterns. SHIMMER and a LOW EVIDENCE meter enter beneath it.

Scene 3 (7.0–10.0s): The instruments align side by side. HISTORY TOO STICKY and
NOT ENOUGH HISTORY label the distinct failures before a clean hold.

narrativeRole: Explains why temporal artefacts appear without suggesting every implementation behaves identically.
keyMessage: Bad history can linger, while insufficient history can leave unstable detail.

## Frame 6 — Borrow, do not haunt

- scene: A PAST sample stack feeds a PRESENT grid through a validation gate, leaving one final rule card.
- voiceover: "Temporal upscaling is not a fancy stretch. It reconstructs a moving image — borrowing from the past without letting it haunt the present."
- duration: 8.747s
- poster: 6.5s
- transition_in: blur-crossfade
- status: animated
- src: compositions/frames/06-borrow-past.html
- type: branding
- persuasion: Distillation + callback
- beat: Resolve + memorability
- blueprint: titlecard-reveal (Adapt)
- focal: the rule BORROW THE PAST / KEEP THE PRESENT TRUE
- roles: rule card = foreground subject · past stack, validation gate and present grid = supporting · quiet sample field and SYSTEM TRACE marker = background
- sfx: notification, chime

Adapt: reveal one final process line and hold the rule without a promotional
call to action.

Scene 1 (0.0–3.0s): PAST tiles feed towards a small VALIDATE gate while a sparse
PRESENT grid waits beyond.

Scene 2 (3.0–6.5s): Accepted cyan samples pass and rejected orange samples fall
away. The present grid becomes dense but retains one crisp current outline.

Scene 3 (6.5–9.3s): The system contracts into BORROW THE PAST / KEEP THE PRESENT
TRUE. SYSTEM TRACE // 03 remains small while everything settles.

narrativeRole: Converts the mechanism and failure modes into one durable principle.
keyMessage: Temporal reconstruction succeeds by reusing history selectively.
