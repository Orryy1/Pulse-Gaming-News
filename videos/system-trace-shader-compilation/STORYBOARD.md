---
format: 1080x1920
duration: 57s
message: "A one-time hitch can come from preparing a graphics pipeline that later runs from cache"
arc: concept-explainer
audience: "PC players curious about first-run stutter"
mode: autonomous
music: "restrained minimal electronic pulse, analytical rather than ominous, no vocals"
captions: true
series: "SYSTEM TRACE"
episode: "02"
---

## Video direction

Treat the pipeline as a precise foldable recipe, not a magical black box. The
episode begins with a recognisable first-run hitch, travels inside the missing
recipe and ends by returning to the diagnostic pattern. Amber means unresolved
work, cyan means a verified reusable cache hit and warm white is neutral system
state. Never imply that the clue proves the diagnosis.

## Frame 1 — First time only

- scene: A clean 60 FPS trace catches once on a new effect, then the same trace repeats without the hitch.
- voiceover: "Ever notice a PC game hitch when an effect first appears, then glide through the same moment later? The scene may not be the problem."
- duration: 8.576s
- poster: 6.4s
- transition_in: cut
- status: animated
- src: compositions/frames/01-first-time-only.html
- type: hook
- persuasion: Recognition + open loop
- beat: Suspicion + curiosity
- blueprint: kinetic-type-beats (Adapt)
- focal: the state swap from FIRST TIME to SECOND RUN around one timing hitch
- roles: FIRST TIME counter = foreground subject · SECOND RUN counter = foreground payoff · repeated effect glyph and timing rail = supporting · near-black signal field = background
- sfx: impact-bass-1, glitch-1

Adapt: preserve the fixed-centre beat replacement and turn it into a two-pass
trace comparison with the same effect glyph.

Scene 1 (0.0–2.8s): SYSTEM TRACE // 02 and a large FIRST TIME settle into the
upper half; an even timing rail begins drawing below.

Scene 2 (2.8–6.6s): A new-effect star enters and the rail tears into one amber
gap. HITCH stamps directly over the missing beat with one deterministic glitch.

Scene 3 (6.6–9.4s): The label swaps in place to SECOND RUN. The same star crosses
again, the rail stays even and SMOOTHER lands in cyan before a clean hold.

narrativeRole: Opens on the repeatable player experience without prematurely naming its cause.
keyMessage: A one-time hitch followed by a smooth repeat is a diagnostic pattern.

## Frame 2 — The recipe

- scene: Shader, blend, depth and raster blocks fold into one sealed PIPELINE RECIPE card.
- voiceover: "Modern graphics APIs bundle shaders and fixed settings into pipeline state objects. The GPU needs the right combination before it draws."
- duration: 10.176s
- poster: 6.8s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/02-pipeline-recipe.html
- type: product_intro
- persuasion: Concrete model + progressive disclosure
- beat: Orientation + clarity
- blueprint: spatial-pan-stations (Adapt)
- focal: the sealed PIPELINE RECIPE assembled from four system blocks
- roles: recipe card = foreground subject · SHADER, BLEND, DEPTH and RASTER blocks = supporting stations · folding rails = midground · dark system grid = background
- sfx: click-soft, whoosh-short

Adapt: pan through four compact stations, then fold their outputs into one
fixed card in the portrait golden centre.

Scene 1 (0.0–3.1s): SHADER and BLEND illuminate one at a time as their amber
rails draw towards an empty central card.

Scene 2 (3.1–6.7s): DEPTH and RASTER enter lower in the world; the camera pans
down as all four rails converge.

Scene 3 (6.7–9.5s): The card folds shut and stamps PIPELINE STATE. A small GPU
READY gate turns from outline to warm white, then holds.

narrativeRole: Turns a technical object into a legible bundle of draw-state choices.
keyMessage: The GPU needs a complete matching pipeline state before drawing.

## Frame 3 — Missing at the moment

- scene: A new effect reaches the draw gate while its pipeline card is still being assembled, stretching one frame to 38 ms.
- voiceover: "If that pipeline is missing, the game may build it as the effect arrives. That work can interrupt an otherwise steady frame."
- duration: 8.235s
- poster: 7.2s
- transition_in: crossfade
- status: animated
- src: compositions/frames/03-missing-pipeline.html
- type: feature_showcase
- persuasion: Causal chain + worked example
- beat: Tension + explanation
- blueprint: fixed-anchor-cycle (Adapt)
- focal: the pinned DRAW NOW gate waiting on an unfinished pipeline card
- roles: DRAW NOW gate = foreground anchor · unfinished recipe layers and 38 ms timer = foreground interruption · frame queue = supporting cycle · dark timing grid = background
- sfx: click, glitch-2

Adapt: keep DRAW NOW pinned while the adjacent recipe cycles through unfinished
states and the timer grows.

Scene 1 (0.0–3.0s): DRAW NOW pins at the top; three steady 16.7 ms frame tiles
cross its gate in sequence.

Scene 2 (3.0–7.4s): A new-effect tile arrives without its recipe. The gate holds,
recipe layers assemble one by one and an amber timer counts up to 38 ms.

Scene 3 (7.4–10.0s): The pipeline seals, the delayed frame finally crosses and
the trace resumes. One marker circles the stretched interval.

narrativeRole: Shows where pipeline preparation can interrupt the delivery of a frame.
keyMessage: Work created at first use can land directly on the frame-time path.

## Frame 4 — Cache changes the replay

- scene: Identical FIRST RUN and SECOND RUN traces reveal one 38 ms spike versus a clean cached pass.
- voiceover: "Once cached, that pipeline can be reused. A second run may feel smoother even when the graphics settings have not changed."
- duration: 8.021s
- poster: 6.8s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/04-cache-replay.html
- type: social_proof
- persuasion: Controlled comparison + evidence
- beat: Aha + relief
- blueprint: comparison-split (Adapt)
- focal: paired timing traces with the same effect and different pipeline readiness
- roles: FIRST RUN trace = foreground comparison · SECOND RUN trace = foreground payoff · cache drawer and HIT badge = supporting · dual dark fields = background
- sfx: whoosh-short, notification

Adapt: stack the paired panels vertically and keep the effect glyph perfectly
matched so readiness is the only changed variable.

Scene 1 (0.0–2.7s): FIRST RUN enters from the left with the familiar 38 ms spike
and an empty cache drawer.

Scene 2 (2.7–6.5s): SECOND RUN enters from the right. The drawer opens, the same
recipe slides out and CACHE HIT lights in cyan.

Scene 3 (6.5–9.4s): Both traces align. The lower trace remains even while the
upper spike receives an amber marker; SAME SETTINGS / DIFFERENT WAIT holds.

narrativeRole: Explains why a repeat can improve without a settings change.
keyMessage: Reusing a prepared pipeline removes that preparation from the replay path.

## Frame 5 — Too many combinations

- scene: A four-by-four state grid multiplies into hundreds of pipeline combinations, then a DRIVER UPDATE stamp retires one cache stack.
- voiceover: "Engines pre-build likely pipelines and preserve caches, but the possible combinations are huge. Driver updates may also invalidate old data."
- duration: 10.24s
- poster: 7.0s
- transition_in: crossfade
- status: animated
- src: compositions/frames/05-combination-grid.html
- type: feature_showcase
- persuasion: Scale demonstration + caveat
- beat: Respect + constraint
- blueprint: dataviz-countup (Adapt)
- focal: the rapidly multiplying pipeline combination grid
- roles: combination grid and total = foreground subject · pre-built cyan cells = supporting success · driver-update stamp and retired cache stack = supporting caveat · system grid = background
- sfx: click-soft, impact-bass-1

Adapt: use the number-plus-chart hero, but make the chart a multiplying matrix
whose state remains fully legible in portrait.

Scene 1 (0.0–3.2s): Four labelled choices form a modest 2×2 matrix; a PRE-BUILD
rail colours likely cells cyan.

Scene 2 (3.2–7.0s): More states arrive and the matrix expands into a dense field.
The combination count rises while most cells remain amber outlines.

Scene 3 (7.0–9.7s): DRIVER UPDATE stamps beside one cache stack, which moves to
REBUILD MAY BE NEEDED — never ALWAYS. The matrix holds behind it.

narrativeRole: Shows why complete up-front preparation is valuable but difficult.
keyMessage: Large state spaces and cache changes make first-use work hard to eliminate entirely.

## Frame 6 — Treat it as a clue

- scene: A diagnostic card asks ONE-TIME? NEW EFFECT? SMOOTHER REPLAY? before revealing PIPELINE as one possible lead.
- voiceover: "Not every hitch is shader compilation. But a one-time pause tied to a new effect is a clue: the game may be building tomorrow's smooth frame today."
- duration: 9.856s
- poster: 6.4s
- transition_in: blur-crossfade
- status: animated
- src: compositions/frames/06-diagnostic-clue.html
- type: branding
- persuasion: Caveat + practical heuristic
- beat: Resolve + curiosity
- blueprint: titlecard-reveal (Adapt)
- focal: the three-question diagnostic card resolving to PIPELINE?
- roles: diagnostic questions = foreground subject · PIPELINE? = foreground conclusion · NOT EVERY STUTTER caveat = supporting · quiet trace and SYSTEM TRACE marker = background
- sfx: notification, chime

Adapt: use one restrained diagnostic reveal and preserve a long, readable final
hold rather than adding a promotional outro.

Scene 1 (0.0–3.1s): ONE-TIME? appears, then NEW EFFECT? and SMOOTHER REPLAY?
arrive one per beat with simple amber checks.

Scene 2 (3.1–6.7s): The three checks contract into one outlined PIPELINE? card.
NOT EVERY STUTTER appears directly beneath as the governing caveat.

Scene 3 (6.7–9.4s): A small cyan cache rail completes behind the card and the
takeaway lands: FIRST USE CAN BUILD THE NEXT SMOOTH RUN. Everything holds.

narrativeRole: Gives the viewer a cautious way to recognise the pattern without overdiagnosing it.
keyMessage: A one-time effect-linked hitch is evidence to investigate, not proof by itself.
