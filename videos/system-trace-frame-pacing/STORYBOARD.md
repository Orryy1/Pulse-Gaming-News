---
format: 1080x1920
duration: 52s
message: "A steady frame-time rhythm matters as much as the FPS counter"
arc: concept-explainer
audience: "PC and console players who enjoy understanding the technology behind games"
mode: autonomous
music: "restrained minimal electronic pulse, analytical rather than ominous, no vocals"
captions: true
series: "SYSTEM TRACE"
episode: "01"
---

## Video direction

One continuous forensic timing trace runs through the episode. Amber is the
signal, near-black is the system and warm white is the explanation. Every frame
uses smooth long-tail settles, with each element revealed only when its spoken
cue arrives. Frame 3 owns the deliberate rhythmic hold and Frame 6 owns the
quiet final read. During holds, content stays still except for a finite, subtle
trace jitter; there is no breathing, drifting camera or back-half push.

The viewer should feel the difference between a stable cadence and a hidden
hitch before the terminology arrives. Keep phone-safe display type large,
diagrams simple enough to parse in one glance and all important content above
the bottom caption band. Never produce the two failure modes: no slideshow that
dumps a full canvas up front, and no screensaver where every object floats
independently. No generic neon gradients, fake interface chrome or bouncy
entrances.

## Frame 1 — The counter lies

- scene: A giant “60 FPS” counter lands perfectly, then the word “STUTTER?” tears across its steady baseline.
- voiceover: "Sixty frames per second can still feel stuttery. The number is real — but it does not tell you when each frame arrived."
- duration: 7.552s
- poster: 4.5s
- transition_in: cut
- status: animated
- src: compositions/frames/01-counter-lies.html
- type: hook
- persuasion: Counterintuitive claim + curiosity gap
- beat: Surprise + recognition
- blueprint: kinetic-type-beats (Adapt)
- focal: the fixed 60 FPS counter and its STUTTER contradiction
- roles: 60 FPS = foreground subject · STUTTER? = foreground interruption · timing baseline and SYSTEM TRACE marker = supporting · near-black field and amber scanlines = background
- sfx: impact-bass-1, glitch-1

Adapt: keep the fixed centre and in-place beat replacement; trade playful spring
motion for a sharp editorial settle and let the timing baseline become the
payoff element.

Scene 1 (0.0–1.8s): Near-black layered field with faint amber scanlines; SYSTEM
TRACE // 01 sits small in the upper rail while “60 FPS” arrives alone at the
portrait golden centre through a per-word staggered reveal
(`dynamic-content-sequencing`), filling roughly half the usable width.

Scene 2 (1.8–4.9s): As the voice says “still feel stuttery”, the steady baseline
draws left to right (`svg-path-draw`), then develops one deterministic chromatic
glitch (`chromatic-glitch`) and hard-cuts its centre token to “STUTTER?”
(`discrete-text-sequence`). No other copy has appeared yet.

Scene 3 (4.9–7.0s): On “does not tell you when”, the FPS digits hold while uneven
amber arrival ticks puncture the line one by one. A marker sweep circles the
widest gap (`css-marker-patterns`), then the complete contradiction holds still.

narrativeRole: Opens in the player's language and separates a truthful FPS count from the experience of smooth delivery.
keyMessage: A correct average can still hide an uneven sequence.

## Frame 2 — Average versus rhythm

- scene: One second splits into two lanes: both contain sixty frame marks, but only one lane keeps equal gaps.
- voiceover: "FPS is an average across time. Smoothness also lives in the gaps — the rhythm between one finished frame and the next."
- duration: 8.32s
- poster: 5s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/02-average-rhythm.html
- type: product_intro
- persuasion: Comparison of two options + concept naming
- beat: Clarity + orientation
- blueprint: comparison-split (Adapt)
- focal: two one-second timing lanes with identical frame counts and different spacing
- roles: evenly spaced lane = foreground subject · bunched lane = foreground comparison · count badges and gap labels = supporting · dual amber and warm-white side glows = background
- sfx: whoosh-short, click-soft

Adapt: preserve the opposite-wing mirrored-card arrival and paired punctuation;
stack the cards vertically for portrait instead of forcing a wide split.

Scene 1 (0.0–1.9s): “SAME COUNT” slides down into the upper third on a smooth
long-tail settle. Beneath it, an empty one-second ruler spans the usable width;
only this framing line is visible.

Scene 2 (1.9–5.8s): On “average across time”, the EVEN card enters from the left
into the upper stack and the UNEVEN card enters from the right into the lower
stack, carrying mirrored book-open tilts (`split-tilt-cards`). Sixty tiny marks
resolve as grouped textures, not individually readable labels.

Scene 3 (5.8–8.0s): As “the rhythm” lands, inner-edge badges reveal “EQUAL GAPS”
and “BUNCHED GAPS” one after the other with restrained punctuation
(`spring-pop-entrance`). The title flips from SAME COUNT to DIFFERENT FEEL by an
instant state swap (`discrete-text-sequence`), then the vertical pair holds.

narrativeRole: Names frame pacing by first showing the distinction the term explains.
keyMessage: Frame count and frame delivery cadence are different measurements.

## Frame 3 — The clean cadence

- scene: A horizontal time ruler advances through evenly spaced 16.7 ms gates while a frame tile clicks into every gate.
- voiceover: "At a clean sixty, a new image arrives about every sixteen point seven milliseconds. Tick — tick — tick — an even visual cadence."
- duration: 8.981s
- poster: 6s
- transition_in: crossfade
- status: animated
- src: compositions/frames/03-clean-cadence.html
- type: feature_showcase
- persuasion: Concretization + demonstration
- beat: Comprehension + satisfaction
- blueprint: fixed-anchor-cycle (Adapt)
- focal: the pinned 16.7 ms budget
- roles: 16.7 ms = foreground anchor · six frame tiles and time gates = supporting cycle · horizontal ruler = midground · dark field and amber edge glow = background
- sfx: click-soft

Adapt: keep the anchor absolutely pinned while the adjacent region cycles; the
states are successive frame gates rather than product skins.

Scene 1 (0.0–2.6s): A large “16.7 ms” anchor reveals at the upper golden centre
and pins permanently. The lower full-width ruler self-draws beneath it
(`svg-path-draw`); no frame tiles exist yet.

Scene 2 (2.6–7.2s): Each spoken “tick” advances one amber frame tile into the
next equal gate through a discrete stepped cycle (`discrete-text-sequence`). The
anchor never moves. Small gate labels illuminate in sequence, giving the frame
its clean metronomic rhythm.

Scene 3 (7.2–9.0s): On “even visual cadence”, all six gates illuminate together,
the ruler snaps from muted to warm white and the finished rhythm holds fully
still for the allocated breather.

narrativeRole: Makes the ideal cadence tangible as a repeating time budget rather than an abstract frame-rate target.
keyMessage: Even 60 FPS delivery means roughly one frame every 16.7 milliseconds.

## Frame 4 — The hidden hitch

- scene: The same ruler develops one 40 ms red spike; later frame marks bunch together while the average badge remains near sixty.
- voiceover: "Now let one frame take forty milliseconds. Faster frames can pull the average back up, yet your eye still catches that single pause."
- duration: 8.64s
- poster: 6.5s
- transition_in: crossfade
- status: animated
- src: compositions/frames/04-hidden-hitch.html
- type: social_proof
- persuasion: Worked example with real numbers + counterexample
- beat: Aha + tension
- blueprint: dataviz-countup (Adapt)
- focal: one 40 ms frame-time spike inside an otherwise steady graph
- roles: frame-time trace and 40 ms spike = foreground subject · near-60 average badge = supporting evidence · 16.7 ms target line = midground reference · dark chart field and faint grid = background
- sfx: glitch-2, impact-bass-1

Adapt: keep the number-plus-chart hero and the camera traversal; replace the
multi-card dashboard with one legible portrait frame-time instrument.

Scene 1 (0.0–2.3s): A dark full-height chart stage appears with a 16.7 ms target
line. The first steady points self-draw left to right (`svg-path-draw`) while a
small “AVG ≈ 60” badge counts into place (`counting-dynamic-scale`).

Scene 2 (2.3–6.3s): On “forty milliseconds”, the virtual camera pans to the
centre of the instrument (`viewport-change`) as one amber point rises to a huge
40 ms spike. Motion blur peaks during the rise and resolves sharp
(`motion-blur-streak`); the trace briefly holds on the missed interval.

Scene 3 (6.3–8.6s): On “pull the average back up”, several shorter points draw
after the spike and the average badge settles near sixty. The camera eases back
to show the whole graph (`multi-phase-camera`), the spike receives one marker
circle and the complete proof holds.

narrativeRole: Demonstrates how one long frame can remain visible even when later quick frames rescue the average.
keyMessage: Averages can mathematically recover after a hitch, but the displayed pause has already happened.

## Frame 5 — The hand-off

- scene: Three labelled stations — ENGINE, DRIVER, DISPLAY — pass frame tiles along one amber rail; irregular hand-offs become a steady flow.
- voiceover: "That is uneven frame pacing. The engine, driver and display must hand frames over steadily — not merely finish sixty somewhere inside a second."
- duration: 9.899s
- poster: 7s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/05-hand-off.html
- type: feature_showcase
- persuasion: Causal chain + progressive disclosure
- beat: Mastery + momentum
- blueprint: spatial-pan-stations (Adapt)
- focal: one amber frame tile travelling through ENGINE, DRIVER and DISPLAY
- roles: travelling frame tile = foreground subject · three labelled stations = supporting causal chain · amber rail and queue ticks = midground · dark oversized world = background
- sfx: click, whoosh

Adapt: keep the oversized world and station-to-station pan; use three vertical
portrait stations linked by one amber presentation rail.

Scene 1 (0.0–2.6s): The camera opens on ENGINE in the upper station. A frame tile
assembles from three layers and its label reveals only as the word “engine” is
spoken. The amber rail begins drawing towards the next stop (`svg-path-draw`).

Scene 2 (2.6–5.8s): The world pans down to DRIVER (`viewport-change`); the same
tile crosses the hand-off gate and a queue-depth tick briefly appears. On the
spoken “driver”, the station illuminates and passes the tile onward.

Scene 3 (5.8–8.2s): The pan lands on DISPLAY as the last rail segment completes.
The display grid accepts the tile and emits one clean scan line, with the other
stations remaining visible as dim context above.

Scene 4 (8.2–10.0s): On “steadily”, the camera settles into a wider view of all
three stations. Three evenly spaced tiles traverse the completed rail, then the
system freezes on the stable rhythm.

narrativeRole: Shows frame pacing as an end-to-end delivery problem without blaming one universal component.
keyMessage: Smooth output depends on a paced hand-off through the rendering and presentation chain.

## Frame 6 — Watch the graph

- scene: An FPS badge shrinks into the corner while a frame-time graph takes centre stage and highlights the single spike.
- voiceover: "So when a game feels rough, watch the frame-time graph as well as the FPS counter. The average can hide the hitch."
- duration: 7.701s
- poster: 5s
- transition_in: blur-crossfade
- status: animated
- src: compositions/frames/06-watch-graph.html
- type: branding
- persuasion: Callback + distillation
- beat: Clarity + resolve
- blueprint: titlecard-reveal (Adapt)
- focal: the frame-time graph and its single highlighted hitch
- roles: FRAME TIME graph = foreground subject · FPS counter = supporting context · highlighted spike and takeaway = supporting emphasis · dark field and quiet amber halo = background
- sfx: notification, chime

Adapt: keep one restrained reveal and the long static landing; the clean proof
card is a frame-time graph rather than a brand lockup.

Scene 1 (0.0–2.2s): “FPS” occupies the centre while “FRAME TIME” waits below the
fold. The FPS badge gently settles from large to supporting scale
(`scale-swap-transition`); the camera remains static.

Scene 2 (2.2–5.7s): On “watch the frame-time graph”, FRAME TIME slides into the
golden centre and a compact trace draws across it. The earlier 40 ms spike
reappears in amber and receives one hand-drawn circle as “hide the hitch” lands.

Scene 3 (5.7–8.0s): The source rail appears beneath the graph: “MEASURE THE
RHYTHM, NOT ONLY THE COUNT.” Everything settles and holds still to the last
frame; SYSTEM TRACE // 01 remains as the sole small series marker.

narrativeRole: Returns to the opening contradiction and gives the viewer one durable diagnostic principle.
keyMessage: Frame-time variation reveals hitches an average FPS counter can conceal.
