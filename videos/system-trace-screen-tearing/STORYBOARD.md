---
format: 1080x1920
duration: 52s
music: none
---

# STORYBOARD - system-trace-screen-tearing

**Frame system:** Broadside
**Format:** 1080x1920, 52s, exact captions
**Visual rule:** Original abstract diagrams only. Each diagram translates a named official-source concept and does not reproduce source artwork.

## Video direction

The Broadside frame system uses only fire-orange #FF6B1A, cream and ink: fire-orange marks the active scan or newest event, cream carries completed-frame evidence and ink holds the field. Keep key content in the top 83% and leave the lower 326px clear for captions. Every frame reveals only the element named by the VO at that instant, with later mechanism pieces arriving across the back half through smooth power3 long-tail settling. Motion is deterministic, finite and driven only by paused GSAP timelines; each frame ends on a deliberate still hold. Bans: no front-loaded slideshow, screensaver drift, lazy breathing, bounce, randomness or repeat motion, fake interface chrome or stock imagery.

## Frame 1 - One refresh, two frames

- scene: A single portrait display rectangle resolves into a clean upper image and a conflicting lower image, divided by one hard horizontal seam.
- voiceover: "That horizontal split is not your GPU failing. It is two finished frames sharing one display refresh."
- duration: 8.3s
- poster: 5.8s
- transition_in: cut
- status: animated
- src: compositions/frames/01-one-refresh-two-frames.html
- type: hook
- persuasion: Counterintuitive contrast
- beat: Surprise
- blueprint: kinetic-type-beats (Adapt)
- focal: ONE REFRESH / TWO FRAMES across one scan rectangle
- roles: seam and two frame fields = foreground proof, display outline = supporting, scan grid = background
- sfx: none
- diagram_source: Original scan rectangle based on Apple display synchronisation and VESA fixed-refresh timing concepts: https://developer.apple.com/documentation/quartzcore/cametallayer/displaysyncenabled | https://vesa.org/featured-articles/vesa-adds-adaptive-sync-to-popular-displayport-video-standard/

Adapt: retain the centered type-beat signature, but cast it as a single display seam rather than a word relay.

Scene 1 (0.0-2.6s): In the upper 83%, ONE REFRESH enters above the empty display outline by per-word staggered reveal (`dynamic-content-sequencing`) on a power3 long-tail settle.

Scene 2 (2.6-5.4s): On "two finished frames", the top and lower cream fields assemble into the outline via cluster-to-outward expansion (`center-outward-expansion`), stopping at one fire-orange seam.

Scene 3 (5.4-8.3s): On "sharing one display refresh", TWO FRAMES replaces the first claim by hard-cut word-swap (`discrete-text-sequence`), then the completed seam reaches a static hold (`gsap-effects`).

narrativeRole: Opens on the visible symptom and removes the hardware-failure assumption.
keyMessage: A tear can show portions of two finished frames during one refresh.

## Frame 2 - The display clock

- scene: A display scan ruler moves from the top edge to the bottom edge in equal fixed intervals.
- voiceover: "A fixed-refresh screen scans a new image on its own clock, line by line from top to bottom."
- duration: 8.2s
- poster: 5.9s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/02-display-clock.html
- type: product_intro
- persuasion: System map
- beat: Orientation
- blueprint: spatial-pan-stations (Adapt)
- focal: DISPLAY CLOCK beside a top-to-bottom scan ruler
- roles: scan ruler = foreground mechanism, line bands = supporting, timing grid = background
- sfx: none
- diagram_source: Original fixed-refresh scan abstraction based on VESA's description of displays normally refreshing at a fixed frame rate: https://vesa.org/featured-articles/vesa-adds-adaptive-sync-to-popular-displayport-video-standard/

Adapt: retain the oversized station-and-rail traversal, but use one vertical scan station rather than a lateral set.

Scene 1 (0.0-2.5s): In the upper 83%, DISPLAY CLOCK enters above the blank vertical ruler via per-word staggered reveal (`dynamic-content-sequencing`) with a power3 long-tail settle.

Scene 2 (2.5-5.5s): As "line by line" is spoken, the ruler self-draws (`svg-path-draw`) and the fire-orange scan marker travels top to bottom by viewport change (`viewport-change`).

Scene 3 (5.5-8.2s): On "own clock", one further identical scan pass is shown with SVG self-draw (`svg-path-draw`), then FIXED INTERVAL reaches a static hold (`gsap-effects`).

narrativeRole: Establishes the display's independent refresh schedule.
keyMessage: A fixed-refresh display scans on its own fixed timing.

## Frame 3 - The GPU schedule

- scene: Three completed-frame cards reach a delivery rail at deliberately uneven intervals.
- voiceover: "The GPU finishes frames on a different schedule, and scene complexity changes that delivery time from moment to moment."
- duration: 8.9s
- poster: 6.1s
- transition_in: crossfade
- status: animated
- src: compositions/frames/03-gpu-schedule.html
- type: feature_showcase
- persuasion: Causal chain
- beat: Recognition
- blueprint: dataviz-countup (Adapt)
- focal: GPU DELIVERY with unequal arrival gaps
- roles: frame cards = foreground subject, delivery rail = foreground mechanism, interval labels = supporting, dark timing field = background
- sfx: none
- diagram_source: Original unequal-delivery rail based on VESA's statement that GPU output frame rate varies with rendering complexity: https://vesa.org/featured-articles/vesa-adds-adaptive-sync-to-popular-displayport-video-standard/

Adapt: retain the data-led hero and traversal, but turn the metric into unequal frame-delivery gaps.

Scene 1 (0.0-2.6s): In the upper 83%, GPU DELIVERY enters over the quiet three-slot rail through per-word staggered reveal (`dynamic-content-sequencing`) on a power3 settle.

Scene 2 (2.6-6.2s): As each frame is named, FRAME A, B and C fill the rail with unequal gaps using bars and progress fill (`stat-bars-and-fills`).

Scene 3 (6.2-8.9s): On "scene complexity", COMPLEX SCENE receives keyword glow (`asr-keyword-glow`) as the final gap widens, then the completed rail reaches a static hold (`gsap-effects`).

narrativeRole: Contrasts variable render completion with the fixed display cadence.
keyMessage: GPU frame delivery varies as rendering work varies.

## Frame 4 - The split point

- scene: A descending scan line crosses a buffer hand-off marker, leaving FRAME A above it and FRAME B below it.
- voiceover: "If the displayed buffer changes mid-scan, the upper lines can show one frame while lower lines show the next."
- duration: 9.0s
- poster: 6.4s
- transition_in: crossfade
- status: animated
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

## Frame 5 - Two ways to align

- scene: A compact split comparison shows V-Sync waiting at a boundary and VRR moving the boundary to a completed frame.
- voiceover: "V-Sync waits for a refresh boundary, while variable refresh rate changes the display timing to meet a finished frame."
- duration: 9.0s
- poster: 6.3s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/05-two-ways-to-align.html
- type: social_proof
- persuasion: Comparison
- beat: Clarity
- blueprint: comparison-split (Adapt)
- focal: WAIT FOR BOUNDARY versus CHANGE THE TIMING
- roles: paired timing rails = foreground proof, frame-complete marker = supporting, display labels = background
- sfx: none
- diagram_source: Original presentation comparison based on Microsoft's VRR presentation guidance and VESA Adaptive-Sync description: https://learn.microsoft.com/en-us/windows/win32/direct3ddxgi/variable-refresh-rate-displays | https://vesa.org/featured-articles/vesa-adds-adaptive-sync-to-popular-displayport-video-standard/

Adapt: retain the two equal comparison surfaces, stacking the timing rails for portrait rather than placing wide cards side by side.

Scene 1 (0.0-3.0s): In the upper 83%, the V-SYNC rail draws itself (`svg-path-draw`) with the completed-frame marker held before the fixed gate.

Scene 2 (3.0-6.3s): On "variable refresh rate", the VRR rail opens beneath via split-tilt card entry (`split-tilt-cards`), then its gate moves to the marker by viewport change (`viewport-change`) inside the cream band.

Scene 3 (6.3-9.0s): On each named rule, the paired labels receive keyword glow (`asr-keyword-glow`), then both rails reach a static hold (`gsap-effects`).

narrativeRole: Names the two timing strategies without promising identical results.
keyMessage: Synchronisation can wait for a fixed boundary or vary the display timing on compatible hardware.

## Frame 6 - The diagnosis

- scene: The display clock rail and GPU delivery rail cross once, then resolve into a final diagnostic card.
- voiceover: "So tearing is a presentation mismatch, not a broken texture or low resolution. Two clocks simply crossed mid-picture."
- duration: 8.6s
- poster: 5.8s
- transition_in: blur-crossfade
- status: animated
- src: compositions/frames/06-presentation-mismatch.html
- type: branding
- persuasion: Distillation
- beat: Resolve
- blueprint: titlecard-reveal (Adapt)
- focal: PRESENTATION MISMATCH / TWO CLOCKS CROSSED MID-PICTURE
- roles: crossing rails = foreground subject, final rule card = foreground payoff, SYSTEM TRACE marker = supporting
- sfx: none
- diagram_source: Original crossed-clock summary based on VESA's explanation of unsynchronised display and render rates: https://vesa.org/featured-articles/vesa-adds-adaptive-sync-to-popular-displayport-video-standard/

Adapt: retain the one restrained title-card landing, using the crossed-clock diagram as its single mechanism.

Scene 1 (0.0-2.8s): In the upper 83%, DISPLAY CLOCK and GPU DELIVERY draw as separate rails by SVG self-draw (`svg-path-draw`).

Scene 2 (2.8-5.8s): On "crossed mid-picture", the rails meet at one fire-orange seam through coordinate-target zoom (`coordinate-target-zoom`), then the labels contract by scale-swap (`scale-swap-transition`).

Scene 3 (5.8-8.6s): PRESENTATION MISMATCH reveals centrally through per-word staggered reveal (`dynamic-content-sequencing`), then SYSTEM TRACE // 08 and the card reach a static hold (`gsap-effects`).

narrativeRole: Ends on the accurate diagnosis and rules out unrelated visual-quality myths.
keyMessage: Tearing is a timing mismatch in presentation.
