---
format: 1080x1920
duration: 53s
music: none
---

# STORYBOARD - system-trace-vsync-latency

**Frame system:** Broadside
**Format:** 1080x1920, 53s, exact captions
**Visual rule:** Original abstract timing diagrams only. Diagrams trace back to the listed official documentation and do not reproduce source visuals.

## Video direction

The Broadside frame system treats every frame as a timing instrument using only fire-orange #FF6B1A, cream and ink: fire-orange is the newest event, cream is the currently displayed frame and ink carries queued work. Keep key content in the top 83% and leave the lower 326px clear for captions. Reveal each new mechanism piece only on its spoken cue, extending sequentially through the back half on smooth power3 long-tail settling. Motion is deterministic, finite and driven by paused GSAP timelines, then stops for deliberate still holds. Bans: no front-loaded slideshow, screensaver drift, lazy breathing, bounce, randomness or repeat motion, fake interface chrome or stock imagery.

## Frame 1 - Tear-free, but waiting

- scene: A torn display seam resolves into a clean frame, followed by a small waiting clock beside the image.
- voiceover: "V-Sync can remove the visible tear, yet the same setting may make a fast game feel slightly less immediate."
- duration: 8.4s
- poster: 5.9s
- transition_in: cut
- status: animated
- src: compositions/frames/01-tear-free-but-waiting.html
- type: hook
- persuasion: Trade-off contrast
- beat: Curiosity
- blueprint: kinetic-type-beats (Adapt)
- focal: TEAR-FREE beside a newly revealed wait clock
- roles: clean display = foreground benefit, wait clock = foreground tension, scan grid = background
- sfx: none
- diagram_source: Original synchronised-presentation abstraction based on AMD's V-Sync presentation guidance: https://gpuopen.com/manuals/fidelityfx_sdk/techniques/frame-interpolation-swap-chain/

Adapt: retain the centered type-beat signature, but resolve a visual seam into a clean display instead of cycling a phrase relay.

Scene 1 (0.0-2.6s): In the upper 83%, a horizontal seam enters across the ink display field with SVG self-draw (`svg-path-draw`) on a power3 settle.

Scene 2 (2.6-5.3s): On "remove the visible tear", the seam hard-swaps to TEAR-FREE (`discrete-text-sequence`) and the cream display field settles.

Scene 3 (5.3-8.4s): On "less immediate", the clock enters by restrained value-scaled counter (`counting-dynamic-scale`), then the full comparison reaches a static hold (`gsap-effects`).

narrativeRole: Establishes the visible benefit and the possible responsiveness cost.
keyMessage: Tear-free presentation can involve extra waiting.

## Frame 2 - Wait for refresh

- scene: A finished-frame marker stops before a fixed vertical refresh gate, then releases exactly on the next gate.
- voiceover: "With synchronisation enabled, a completed frame is presented on the display's refresh boundary instead of arriving whenever it finishes."
- duration: 9.0s
- poster: 6.2s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/02-wait-for-refresh.html
- type: product_intro
- persuasion: Mechanism reveal
- beat: Orientation
- blueprint: spatial-pan-stations (Adapt)
- focal: FRAME READY waiting for a REFRESH gate
- roles: frame marker and gate = foreground mechanism, time ruler = supporting, near-black field = background
- sfx: none
- diagram_source: Original refresh-gate diagram based on AMD's statement that V-Sync presentation is synchronised to the display vertical blanking period: https://gpuopen.com/manuals/fidelityfx_sdk/techniques/frame-interpolation-swap-chain/

Adapt: retain the station traversal, but use one presentation rail and its refresh gate as the compact timing world.

Scene 1 (0.0-2.8s): In the upper 83%, FRAME READY reaches the rail by cluster-to-outward expansion (`center-outward-expansion`) just after the gate closes.

Scene 2 (2.8-6.0s): As "refresh boundary" is spoken, the next gate self-draws (`svg-path-draw`) into view at a fixed interval while the marker stays pinned.

Scene 3 (6.0-9.0s): On "instead of arriving", the frame crosses by viewport change (`viewport-change`) and the displayed-image card updates by hard-cut swap (`discrete-text-sequence`), then holds still (`gsap-effects`).

narrativeRole: Defines what synchronised presentation changes.
keyMessage: V-Sync ties frame presentation to a refresh boundary.

## Frame 3 - Missed the gate

- scene: A completed-frame marker arrives just after a boundary and the old image remains visible until the next one.
- voiceover: "Miss that boundary by a fraction and the previous image may remain visible until another refresh opportunity arrives."
- duration: 8.5s
- poster: 6.0s
- transition_in: crossfade
- status: animated
- src: compositions/frames/03-missed-gate.html
- type: feature_showcase
- persuasion: Counterfactual demonstration
- beat: Tension
- blueprint: fixed-anchor-cycle (Adapt)
- focal: MISSED THE GATE with the previous frame held
- roles: late frame marker = foreground cause, old image = foreground consequence, two refresh gates = supporting
- sfx: none
- diagram_source: Original missed-boundary sequence based on AMD's example where the prior frame is shown for two refresh intervals after a late present: https://gpuopen.com/manuals/fidelityfx_sdk/techniques/frame-interpolation-swap-chain/

Adapt: retain the pinned anchor, using the fixed gate as the unchanged anchor while the late-frame state changes around it.

Scene 1 (0.0-2.7s): In the upper 83%, the fixed refresh gate pins via SVG self-draw (`svg-path-draw`) while the first interval remains empty.

Scene 2 (2.7-5.5s): On "by a fraction", FRAME READY enters by cluster-to-outward expansion (`center-outward-expansion`) after the gate and MISSED THE GATE receives keyword glow (`asr-keyword-glow`).

Scene 3 (5.5-8.5s): On "previous image", the cream old-image card remains; the new card hard-swaps at the next gate (`discrete-text-sequence`) and the result reaches a static hold (`gsap-effects`).

narrativeRole: Makes the extra wait visible without claiming it happens on every frame.
keyMessage: A finished frame that narrowly misses a boundary can wait for another opportunity.

## Frame 4 - One refresh period

- scene: Two vertical timing cards compare the duration of a 60 Hz and a 120 Hz refresh interval.
- voiceover: "At sixty hertz one refresh lasts about sixteen point seven milliseconds. At one hundred and twenty, it is roughly eight point three."
- duration: 8.7s
- poster: 6.1s
- transition_in: crossfade
- status: animated
- src: compositions/frames/04-one-refresh-period.html
- type: social_proof
- persuasion: Concrete comparison
- beat: Comprehension
- blueprint: dataviz-countup (Adapt)
- focal: 60 HZ = 16.7 MS versus 120 HZ = 8.3 MS
- roles: timing cards = foreground proof, interval rulers = supporting, fire-orange gates = background
- sfx: none
- diagram_source: Original duration comparison based on the refresh-period values described by Apple: https://developer.apple.com/documentation/xcode/understanding-hitches-in-your-app

Adapt: retain the data-led hero, but use two refresh-duration instruments rather than a scrolling chart.

Scene 1 (0.0-2.5s): In the upper 83%, 60 HZ = 16.7 MS builds with a long interval ruler through bars and progress fill (`stat-bars-and-fills`).

Scene 2 (2.5-5.8s): On "one hundred and twenty", 120 HZ = 8.3 MS enters as the shorter ruler fills through bars and progress fill (`stat-bars-and-fills`).

Scene 3 (5.8-8.7s): On "roughly eight point three", both gates receive one finite SVG icon accent (`svg-icon-enrichment`) at proportional spacing, then settle to a static hold (`gsap-effects`).

narrativeRole: Gives the viewer a scale for a potential refresh-boundary wait.
keyMessage: The duration of one refresh interval depends on the display refresh rate.

## Frame 5 - The deeper queue

- scene: FRESH INPUT enters behind three older CPU-prepared frame cards as an age counter rises.
- voiceover: "A deep frame queue can add more waiting because fresh input sits behind work the CPU prepared earlier."
- duration: 8.9s
- poster: 6.3s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/05-deeper-queue.html
- type: feature_showcase
- persuasion: Causal chain
- beat: Understanding
- blueprint: spatial-pan-stations (Adapt)
- focal: FRESH INPUT behind OLDER WORK
- roles: input pulse and queued cards = foreground proof, queue-depth meter = supporting, CPU rail = background
- sfx: none
- diagram_source: Original queue diagram based on Microsoft's warning that CPU work running ahead can build a frame queue and increase input latency: https://learn.microsoft.com/en-us/windows/win32/direct3d12/swap-chains

Adapt: retain the station path, but use a stacked portrait CPU-to-GPU rail with queue cards as the travelling evidence.

Scene 1 (0.0-2.7s): In the upper 83%, the CPU-to-GPU rail self-draws (`svg-path-draw`) and three ink frame cards assemble by cluster-to-outward expansion (`center-outward-expansion`).

Scene 2 (2.7-5.8s): On "fresh input", FRESH INPUT enters behind the cards through viewport change (`viewport-change`) and the age counter begins with value-scaled counter (`counting-dynamic-scale`).

Scene 3 (5.8-8.9s): On "prepared earlier", QUEUE DEPTH fills to three via bars and progress fill (`stat-bars-and-fills`), then the newest pulse and cards reach a static hold (`gsap-effects`).

narrativeRole: Separates display-boundary waiting from latency added by queued work.
keyMessage: Frames queued ahead can make fresh input wait longer.

## Frame 6 - The trade-off

- scene: A balance instrument settles between TEAR-FREE and PACING DECIDES, with a small note that the outcome is not one fixed number.
- voiceover: "V-Sync is therefore a trade-off, not a fixed lag number: tear-free presentation in exchange for timing that needs careful pacing."
- duration: 9.5s
- poster: 6.4s
- transition_in: blur-crossfade
- status: animated
- src: compositions/frames/06-the-trade-off.html
- type: branding
- persuasion: Honest qualification
- beat: Resolve
- blueprint: titlecard-reveal (Adapt)
- focal: TEAR-FREE IS A TRADE-OFF
- roles: balance instrument = foreground summary, timing rails = supporting, SYSTEM TRACE marker = background
- sfx: none
- diagram_source: Original trade-off summary based on AMD's V-Sync latency guidance and Microsoft's queue-depth warning: https://gpuopen.com/manuals/fidelityfx_sdk/techniques/frame-interpolation-swap-chain/ | https://learn.microsoft.com/en-us/windows/win32/direct3d12/swap-chains

Adapt: retain the calm single-card landing, using the balance instrument as the card's one measured mechanism.

Scene 1 (0.0-3.0s): In the upper 83%, TEAR-FREE enters on one side of the balance via per-word staggered reveal (`dynamic-content-sequencing`) on a power3 settle.

Scene 2 (3.0-6.4s): On "careful pacing", PACING DECIDES reveals opposite through per-word staggered reveal (`dynamic-content-sequencing`) and the queue card contracts through bars and progress fill (`stat-bars-and-fills`).

Scene 3 (6.4-9.5s): TEAR-FREE IS A TRADE-OFF scale-swaps into the centre (`scale-swap-transition`), then SYSTEM TRACE // 09 and the instrument reach a static hold (`gsap-effects`).

narrativeRole: Ends with a precise trade-off instead of a universal latency claim.
keyMessage: V-Sync behaviour depends on refresh timing and frame pacing, not a single fixed lag value.
