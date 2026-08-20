---
format: 1080x1920
duration: 53.7s
music: none
---

# STORYBOARD - system-trace-variable-refresh-rate

**Frame system:** Broadside
**Format:** 1080x1920, 53s, exact captions
**Visual rule:** Original abstract timing diagrams only. Each diagram names its official source concept and does not reproduce source imagery.

## Video direction

The Broadside frame system turns VRR into a bounded timing problem using only fire-orange #FF6B1A, cream and ink: cream is a completed GPU frame, fire-orange is the active refresh opportunity and cream marks the supported window against ink. Keep key content in the top 83% and leave the lower 326px clear for captions. Reveal only what the VO has reached, then add later timing evidence sequentially across the back half with smooth power3 long-tail settling. Motion is deterministic, finite and driven by paused GSAP timelines, followed by deliberate still holds. Bans: no front-loaded slideshow, screensaver drift, lazy breathing, bounce, randomness or repeat motion, fake interface chrome or stock imagery.

## Frame 1 - VRR changes timing

- scene: A monitor refresh gate moves to meet a completed-frame marker, while a GPU speedometer stays unchanged in the corner.
- voiceover: "Variable refresh rate does not make the GPU faster. It changes when a compatible monitor begins its next refresh."
- duration: 8.6s
- poster: 5.9s
- transition_in: cut
- status: animated
- src: compositions/frames/01-vrr-changes-timing.html
- type: hook
- persuasion: Myth correction
- beat: Surprise
- blueprint: kinetic-type-beats (Adapt)
- focal: VRR CHANGES TIMING / NOT GPU SPEED
- roles: moving gate = foreground mechanism, static GPU meter = supporting proof, timing rail = background
- sfx: none
- diagram_source: Original moving-refresh abstraction based on VESA's statement that Adaptive-Sync dynamically matches display update rate to GPU rendering rate: https://vesa.org/featured-articles/vesa-adds-adaptive-sync-to-popular-displayport-video-standard/

Adapt: retain the centered type-beat correction, but make the unchanged GPU meter the counterpoint to a moving refresh gate.

Scene 1 (0.0-2.7s): In the upper 83%, the fixed GPU meter pins via static hold (`gsap-effects`) while FRAME READY lands on the rail by per-word staggered reveal (`dynamic-content-sequencing`).

Scene 2 (2.7-5.8s): On "begins its next refresh", the fire-orange gate moves to the marker through viewport change (`viewport-change`) inside the cream timing band.

Scene 3 (5.8-8.6s): VRR CHANGES TIMING replaces the initial label by hard-cut word-swap (`discrete-text-sequence`), then the meter and gate reach a static hold (`gsap-effects`).

narrativeRole: Corrects the assumption that VRR raises render performance.
keyMessage: VRR changes display timing, not GPU rendering speed.

## Frame 2 - Fixed display, variable delivery

- scene: A fixed clock ticks in equal intervals above game-frame markers that arrive early, late and between the ticks.
- voiceover: "A fixed display keeps ticking at one rate, even while game frames finish early, late or somewhere between."
- duration: 8.8s
- poster: 6.2s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/02-fixed-display-variable-delivery.html
- type: product_intro
- persuasion: Contrast map
- beat: Orientation
- blueprint: spatial-pan-stations (Adapt)
- focal: FIXED DISPLAY over VARIABLE DELIVERY
- roles: display clock = foreground anchor, frame markers = foreground contrast, interval grid = background
- sfx: none
- diagram_source: Original timing contrast based on VESA's description of fixed monitor refresh and variable GPU output with scene complexity: https://vesa.org/featured-articles/vesa-adds-adaptive-sync-to-popular-displayport-video-standard/

Adapt: retain the station traversal, but stack fixed-display gates and variable-delivery markers into one portrait timing world.

Scene 1 (0.0-2.6s): In the upper 83%, FIXED DISPLAY reveals by per-word staggered reveal (`dynamic-content-sequencing`) as three equally spaced fire-orange gates self-draw (`svg-path-draw`).

Scene 2 (2.6-6.0s): On "early, late or somewhere between", three cream frame markers enter at their unequal positions via cluster-to-outward expansion (`center-outward-expansion`).

Scene 3 (6.0-8.8s): VARIABLE DELIVERY appears beneath the unequal gaps through per-word staggered reveal (`dynamic-content-sequencing`), then the contrast reaches a static hold (`gsap-effects`).

narrativeRole: Establishes the mismatch VRR is designed to manage.
keyMessage: Fixed refresh timing and variable frame delivery do not naturally align.

## Frame 3 - Refresh when ready

- scene: A compatible monitor refreshes at the arrival of three frame markers inside a highlighted VRR band.
- voiceover: "With VRR, the monitor can refresh when the next frame is ready, reducing repeated frames, stutter and tearing inside its range."
- duration: 9.1s
- poster: 6.4s
- transition_in: crossfade
- status: animated
- src: compositions/frames/03-refresh-when-ready.html
- type: feature_showcase
- persuasion: Mechanism demonstration
- beat: Understanding
- blueprint: dataviz-countup (Adapt)
- focal: FRAME READY / REFRESH NOW inside the supported band
- roles: paired ready-and-refresh markers = foreground proof, VRR band = foreground boundary, timing ruler = supporting
- sfx: none
- diagram_source: Original within-window sequence based on VESA Adaptive-Sync's frame-by-frame matching and AMD's VRR-window guidance: https://vesa.org/featured-articles/vesa-adds-adaptive-sync-to-popular-displayport-video-standard/ | https://gpuopen.com/manuals/fidelityfx_sdk/techniques/frame-interpolation-swap-chain/

Adapt: retain the data-led timing instrument, but make matched ready-and-refresh pairs the visible series.

Scene 1 (0.0-2.6s): In the upper 83%, INSIDE THE WINDOW appears around an empty timing rail via per-word staggered reveal (`dynamic-content-sequencing`).

Scene 2 (2.6-6.4s): As each frame is named, FRAME READY and REFRESH NOW build as matched pairs through bars and progress fill (`stat-bars-and-fills`) inside the cream band.

Scene 3 (6.4-9.1s): On "inside its range", the matched pairs receive keyword glow (`asr-keyword-glow`), then the band reaches a static hold (`gsap-effects`) without a prior-frame card.

narrativeRole: Demonstrates the intended timing relationship on compatible hardware.
keyMessage: Within its supported range, VRR can align a refresh with a completed frame.

## Frame 4 - The timing window

- scene: A vertical range instrument labels the allowed zone from 64 to 120 Hz and rejects impossible values outside it.
- voiceover: "That range has limits. A display might vary between sixty-four and one hundred and twenty hertz, not from zero to infinity."
- duration: 8.9s
- poster: 6.1s
- transition_in: crossfade
- status: animated
- src: compositions/frames/04-timing-window.html
- type: social_proof
- persuasion: Boundary setting
- beat: Clarity
- blueprint: fixed-anchor-cycle (Adapt)
- focal: 64-120 HZ inside one bounded timing window
- roles: range instrument = foreground proof, upper and lower rails = supporting, excluded outside field = background
- sfx: none
- diagram_source: Original example range based on AMD's documented 64-120 Hz VRR-window example: https://gpuopen.com/manuals/fidelityfx_sdk/techniques/frame-interpolation-swap-chain/

Adapt: retain the pinned range anchor while the lower and upper bounds enter around it.

Scene 1 (0.0-2.5s): In the upper 83%, the tall range instrument pins by SVG self-draw (`svg-path-draw`) and the lower 64 HZ boundary receives keyword glow (`asr-keyword-glow`).

Scene 2 (2.5-5.8s): On "one hundred and twenty hertz", the upper 120 HZ boundary enters through hard-cut state sequence (`discrete-text-sequence`) and completes the cream window.

Scene 3 (5.8-8.9s): An outside marker approaches each boundary by viewport change (`viewport-change`) and stops cleanly; NOT FROM ZERO TO INFINITY then reaches a static hold (`gsap-effects`).

narrativeRole: Stops the explanation from sounding like unlimited refresh freedom.
keyMessage: Every VRR display has a supported operating window.

## Frame 5 - Outside the range

- scene: A split instrument shows a prior frame shown again below the range and a fixed-rate gate sequence above it.
- voiceover: "Fall below the lower bound and frames may be repeated. Exceed the top and familiar fixed-refresh constraints return."
- duration: 8.7s
- poster: 6.2s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/05-outside-the-range.html
- type: feature_showcase
- persuasion: Before-and-after consequence
- beat: Nuance
- blueprint: comparison-split (Adapt)
- focal: BELOW RANGE: PRIOR FRAME / ABOVE RANGE: FIXED RULES
- roles: prior-frame card and fixed gates = foreground proof, boundary labels = supporting, range window = background
- sfx: none
- diagram_source: Original outside-window comparison based on AMD's VRR guidance that the prior frame can be shown again below the window and fixed-refresh behaviour returns above it: https://gpuopen.com/manuals/fidelityfx_sdk/techniques/frame-interpolation-swap-chain/

Adapt: retain the balanced pair, stacking the below-range and above-range outcomes for portrait comparison.

Scene 1 (0.0-2.8s): In the upper 83%, BELOW RANGE reveals by per-word staggered reveal (`dynamic-content-sequencing`) as the same prior-frame card is shown once more through hard-cut state sequence (`discrete-text-sequence`).

Scene 2 (2.8-5.9s): On "exceed the top", ABOVE RANGE opens below by split-tilt card entry (`split-tilt-cards`) and fixed display gates self-draw (`svg-path-draw`).

Scene 3 (5.9-8.7s): The dimmed 64-120 HZ window receives keyword glow (`asr-keyword-glow`), then both constrained outcomes reach a static hold (`gsap-effects`).

narrativeRole: Shows the limits that the range instrument implies.
keyMessage: Below or above the VRR window, timing constraints return.

## Frame 6 - Timing flexibility

- scene: GPU, display, connection and presentation-path markers link into one supported chain, then resolve into the final rule.
- voiceover: "VRR is therefore timing flexibility, not free performance. The GPU, display, connection and presentation path must all support it."
- duration: 9.6s
- poster: 6.3s
- transition_in: blur-crossfade
- status: animated
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
