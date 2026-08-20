---
format: 1080x1920
duration: 53s
music: none
---

# STORYBOARD - system-trace-hdr-tone-mapping

**Frame system:** Broadside
**Format:** 1080x1920, 53s, exact captions
**Visual rule:** Original abstract luminance diagrams only. Diagrams are source-traceable translations of official HDR concepts and never reproduce vendor diagrams or game imagery.

## Video direction

The Broadside frame system makes luminance legible as one vertical range using only fire-orange #FF6B1A, cream and ink: fire-orange marks intense scene light, cream is the available display range and ink carries the unlit field. Keep key content in the top 83% and leave the lower 326px clear for captions. Each later tonal element arrives only on its spoken cue, with sequential back-half development and smooth power3 long-tail settling. Motion is deterministic, finite and driven by paused GSAP timelines, then ends on deliberate still holds. Bans: no front-loaded slideshow, screensaver drift, lazy breathing, bounce, randomness or repeat motion, fake interface chrome, stock imagery or HDR sales gloss.

## Frame 1 - More scene light than screen light

- scene: A tall SCENE LIGHT range rises beyond a shorter DISPLAY LIMIT range on the same luminance ruler.
- voiceover: "An HDR game can calculate brighter highlights and deeper contrast than one real screen can reproduce at the same time."
- duration: 8.7s
- poster: 6.0s
- transition_in: cut
- status: animated
- src: compositions/frames/01-scene-light-display-limit.html
- type: hook
- persuasion: Scale contrast
- beat: Surprise
- blueprint: kinetic-type-beats (Adapt)
- focal: SCENE LIGHT extending beyond DISPLAY LIMIT
- roles: luminance ranges = foreground proof, upper highlight marker = supporting, dark scale field = background
- sfx: none
- diagram_source: Original input-to-output range comparison based on Microsoft's HDR tone-map effect description of adapting image dynamic range to output-display capability: https://learn.microsoft.com/en-us/windows/win32/direct2d/hdr-tone-map-effect

Adapt: retain the centered type-beat contrast, but make two luminance ranges the statement's visible proof.

Scene 1 (0.0-2.7s): In the upper 83%, DISPLAY LIMIT rises to a fixed ceiling by SVG self-draw (`svg-path-draw`) on a power3 long-tail settle.

Scene 2 (2.7-5.9s): On "brighter highlights", SCENE LIGHT extends above that ceiling through bars and progress fill (`stat-bars-and-fills`) with one fire-orange highlight marker.

Scene 3 (5.9-8.7s): MORE SCENE LIGHT THAN SCREEN LIGHT reveals via per-word staggered reveal (`dynamic-content-sequencing`), then the two ranges reach a static hold (`gsap-effects`).

narrativeRole: Shows why an HDR renderer still encounters a real output limit.
keyMessage: Scene luminance can exceed what one display can reproduce at once.

## Frame 2 - Two sets of limits

- scene: A paired data card compares input scene-light values with display minimum, maximum and full-frame limits.
- voiceover: "The renderer knows the scene's light values, while the display reports minimum, maximum and full-frame brightness limits."
- duration: 8.9s
- poster: 6.2s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/02-two-sets-of-limits.html
- type: product_intro
- persuasion: System map
- beat: Orientation
- blueprint: spatial-pan-stations (Adapt)
- focal: INPUT RANGE versus OUTPUT RANGE
- roles: source and display cards = foreground mechanism, three limit ticks = supporting, shared ruler = background
- sfx: none
- diagram_source: Original luminance-data card based on Microsoft GDK's MinTML, MaxTML and MaxFFTML HDR display values: https://learn.microsoft.com/en-us/gaming/gdk/docs/reference/system/xdisplay/structs/xdisplayhdrmodeinfo

Adapt: retain the station traversal, but use stacked input and output data cards joined by one portrait mapping arrow.

Scene 1 (0.0-2.6s): In the upper 83%, INPUT RANGE enters with a scene-light ramp through per-word staggered reveal (`dynamic-content-sequencing`).

Scene 2 (2.6-5.9s): On "minimum, maximum and full-frame", OUTPUT RANGE enters below by viewport change (`viewport-change`) as MIN, MAX and FULL-FRAME ticks self-draw (`svg-path-draw`).

Scene 3 (5.9-8.9s): On "brightness limits", the central mapping arrow self-draws (`svg-path-draw`), then the paired cards reach a static hold (`gsap-effects`).

narrativeRole: Identifies the source information and display information a mapping must reconcile.
keyMessage: The renderer and the display provide different luminance constraints.

## Frame 3 - Bend the range

- scene: A wide luminance curve compresses into the display range while labels keep highlights, mid-tones and shadow detail distinct.
- voiceover: "Tone mapping bends that wide range into the output range, deciding how highlights, mid-tones and dark detail share the available brightness."
- duration: 9.2s
- poster: 6.5s
- transition_in: crossfade
- status: animated
- src: compositions/frames/03-bend-the-range.html
- type: feature_showcase
- persuasion: Mechanism demonstration
- beat: Aha
- blueprint: dataviz-countup (Adapt)
- focal: INPUT RANGE bending into OUTPUT RANGE
- roles: mapping curve = foreground subject, tonal labels = foreground proof, display ruler = supporting
- sfx: none
- diagram_source: Original tone curve abstraction based on Microsoft's HDR tone-map effect and its input/output maximum luminance properties: https://learn.microsoft.com/en-us/windows/win32/direct2d/hdr-tone-map-effect

Adapt: retain the data-led hero, but make the mapping curve the primary chart series rather than a numeric counter.

Scene 1 (0.0-2.6s): In the upper 83%, the wide INPUT RANGE draws up the left side through SVG self-draw (`svg-path-draw`).

Scene 2 (2.6-6.5s): On "tone mapping bends", the single curve self-draws (`svg-path-draw`) through the display limit; HIGHLIGHTS, MID-TONES and SHADOW DETAIL reveal sequentially (`dynamic-content-sequencing`).

Scene 3 (6.5-9.2s): On "available brightness", OUTPUT RANGE enters on the right by bars and progress fill (`stat-bars-and-fills`), then the complete mapping reaches a static hold (`gsap-effects`).

narrativeRole: Gives tone mapping a concrete visual job rather than treating it as a menu label.
keyMessage: Tone mapping allocates limited output brightness across the scene's tonal range.

## Frame 4 - Avoid clipping

- scene: A highlight rail compares a clipped flat-white patch with a mapped patch that retains an internal brightness contour.
- voiceover: "Simply clipping everything above the panel limit would turn bright clouds, sparks or reflections into flat white patches."
- duration: 8.6s
- poster: 6.1s
- transition_in: crossfade
- status: animated
- src: compositions/frames/04-avoid-clipping.html
- type: social_proof
- persuasion: Counterexample
- beat: Recognition
- blueprint: fixed-anchor-cycle (Adapt)
- focal: CLIPPED WHITE versus PRESERVED CONTOUR
- roles: paired highlight patches = foreground proof, panel ceiling = supporting, luminance ruler = background
- sfx: none
- diagram_source: Original clipping comparison inferred from Microsoft's requirement to lower HDR image light levels to a target output level rather than leave values above it unchanged: https://learn.microsoft.com/en-us/windows/win32/direct2d/hdr-tone-map-effect

Adapt: retain the pinned anchor, using the display-limit line as the fixed reference while the two highlight outcomes change beneath it.

Scene 1 (0.0-2.5s): In the upper 83%, the DISPLAY LIMIT line pins via SVG self-draw (`svg-path-draw`) as a bright signal rises through bars and progress fill (`stat-bars-and-fills`).

Scene 2 (2.5-5.7s): On "flat white patches", the left field hard-swaps to CLIPPED WHITE (`discrete-text-sequence`).

Scene 3 (5.7-8.6s): On "clouds, sparks or reflections", the right mapped patch builds three contour bands sequentially (`dynamic-content-sequencing`), then both outcomes reach a static hold (`gsap-effects`).

narrativeRole: Shows the visual cost of treating all over-limit highlights as identical white.
keyMessage: Mapping can preserve differences in bright detail that a hard ceiling would flatten.

## Frame 5 - A curve for this display

- scene: The same scene-light rail feeds two display cards with different maximum-range ceilings and corresponding curves.
- voiceover: "Different displays have different capabilities, so the same scene may need a different curve to preserve its intended balance."
- duration: 8.7s
- poster: 6.3s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/05-curve-for-this-display.html
- type: feature_showcase
- persuasion: Comparative proof
- beat: Nuance
- blueprint: comparison-split (Adapt)
- focal: DISPLAY-SPECIFIC CURVE
- roles: shared input rail and paired curves = foreground proof, capability ceilings = supporting, dark measurement grid = background
- sfx: none
- diagram_source: Original paired-output comparison based on Microsoft's distinct HDR and SDR/WCG tone-map curves and display-derived output maximum luminance: https://learn.microsoft.com/en-us/windows/win32/direct2d/hdr-tone-map-effect

Adapt: retain the paired comparison surface, stacking two display cards beneath one shared scene-light rail for portrait reading.

Scene 1 (0.0-2.7s): In the upper 83%, one shared SCENE LIGHT rail self-draws (`svg-path-draw`) above two blank display cards.

Scene 2 (2.7-5.9s): On "different capabilities", the two cards open through split-tilt card entry (`split-tilt-cards`) and each OUTPUT LIMIT receives its own curve by SVG self-draw (`svg-path-draw`).

Scene 3 (5.9-8.7s): DISPLAY-SPECIFIC CURVE receives keyword glow (`asr-keyword-glow`) across both cards, then the pair reaches a static hold (`gsap-effects`).

narrativeRole: Explains why matching output capability is part of HDR presentation.
keyMessage: Different output capabilities can require different tone-map curves for the same scene.

## Frame 6 - Controlled compromise

- scene: Highlights, mid-tones and shadows flow through one measured curve into a final card asking which light survives.
- voiceover: "HDR is not just more brightness. Tone mapping is the controlled compromise that decides which light survives on this screen."
- duration: 8.9s
- poster: 6.3s
- transition_in: blur-crossfade
- status: animated
- src: compositions/frames/06-controlled-compromise.html
- type: branding
- persuasion: Distillation
- beat: Resolve
- blueprint: titlecard-reveal (Adapt)
- focal: CONTROLLED COMPROMISE / WHICH LIGHT SURVIVES?
- roles: final curve = foreground summary, three tonal markers = supporting, SYSTEM TRACE marker = background
- sfx: none
- diagram_source: Original tone-map summary based on Microsoft's dynamic-range adjustment for output-display capability and Microsoft GDK display tone-map limits: https://learn.microsoft.com/en-us/windows/win32/direct2d/hdr-tone-map-effect | https://learn.microsoft.com/en-us/gaming/gdk/docs/reference/system/xdisplay/structs/xdisplayhdrmodeinfo

Adapt: retain the calm single-card landing, using the one measured curve as the card's sole mechanism.

Scene 1 (0.0-2.8s): In the upper 83%, HIGHLIGHTS, MID-TONES and SHADOW DETAIL enter sequentially on one input rail (`dynamic-content-sequencing`).

Scene 2 (2.8-5.8s): On "controlled compromise", the measured curve self-draws (`svg-path-draw`) into the cream display field.

Scene 3 (5.8-8.9s): CONTROLLED COMPROMISE / WHICH LIGHT SURVIVES? scale-swaps into centre (`scale-swap-transition`), then SYSTEM TRACE // 11 reaches a static hold (`gsap-effects`).

narrativeRole: Ends with the real function of tone mapping as a display-specific allocation decision.
keyMessage: HDR tone mapping decides how scene light fits this display's available output range.
