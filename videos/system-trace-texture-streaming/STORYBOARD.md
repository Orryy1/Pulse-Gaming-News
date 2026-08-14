---
format: 1080x1920
duration: 54s
message: "Texture streaming maintains a changing VRAM working set of useful mip levels"
arc: concept-explainer
audience: "players curious about texture pop-in and VRAM"
mode: autonomous
music: "restrained minimal electronic pulse, analytical rather than ominous, no vocals"
captions: true
series: "SYSTEM TRACE"
episode: "05"
---

## Video direction

The visual metaphor is a memory logistics board. Amber is requested detail,
cyan is resident and ready, dim orange is evicted or late. Use a single original
checker-and-contour texture family so the changing mip level is unmistakable.
Keep all labels short and phone-readable.

## Frame 1 - Too much to hold

- scene: A huge texture archive towers above a compact VRAM bay that can accept only a small fraction of its tiles.
- voiceover: "A modern game can contain far more texture data than graphics memory can hold. The solution is not to load the whole world."
- duration: 8.683s
- poster: 6.0s
- transition_in: cut
- status: animated
- src: compositions/frames/01-too-much.html
- type: hook
- persuasion: Scale contrast
- beat: Surprise + tension
- blueprint: kinetic-type-beats (Adapt)
- focal: WORLD DATA replacing FITS IN VRAM over a visibly undersized memory bay
- roles: texture archive and VRAM bay = foreground subjects - capacity gauge = supporting - tile field = background
- sfx: impact-bass-1, glitch-1

Adapt: use one central capacity comparison and swap the false assumption for the working constraint.

Scene 1 (0.0-2.6s): LOAD THE WHOLE WORLD? appears above a tall stack of texture tiles.

Scene 2 (2.6-5.9s): A compact VRAM bay draws in below. The stack exceeds its capacity line by several multiples.

Scene 3 (5.9-8.8s): The headline swaps to KEEP WHAT MATTERS and only selected tiles enter the bay.

narrativeRole: Establishes why full residency is impossible for large modern worlds.
keyMessage: Texture data can exceed available graphics memory.

## Frame 2 - Mip levels

- scene: One original texture resolves into a pyramid of detailed to tiny mip levels, each mapped to a different screen size.
- voiceover: "Textures come in mip levels: large detailed versions for close views and progressively smaller versions for distant or tiny surfaces."
- duration: 9.387s
- poster: 6.2s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/02-mip-pyramid.html
- type: product_intro
- persuasion: Progressive disclosure
- beat: Orientation + clarity
- blueprint: spatial-pan-stations (Adapt)
- focal: the descending MIP 0 to MIP 4 pyramid and its close-to-far mapping
- roles: mip pyramid = foreground subject - camera-distance cards = supporting - resolution labels = supporting - dark field = background
- sfx: click-soft, whoosh-short

Adapt: pan down the pyramid as each level halves in dimension, then reveal the matching view distance.

Scene 1 (0.0-2.8s): MIP 0 arrives as the largest detailed tile labelled CLOSE.

Scene 2 (2.8-5.8s): Smaller levels step down beneath it while dimensions halve.

Scene 3 (5.8-8.7s): A camera cone maps CLOSE / MID / FAR to appropriate levels and holds.

narrativeRole: Defines the prefiltered resolution levels used by the streamer.
keyMessage: The same texture has multiple detail levels for different projected sizes.

## Frame 3 - Choose what matters

- scene: A camera cone scores visible surfaces, then routes the needed mip tiles into VRAM while distant tiles leave.
- voiceover: "The streamer estimates which levels matter for the current camera. Useful detail moves in, while less valuable data can move out."
- duration: 8.747s
- poster: 6.3s
- transition_in: crossfade
- status: animated
- src: compositions/frames/03-camera-demand.html
- type: feature_showcase
- persuasion: Causal system map
- beat: Comprehension + motion
- blueprint: fixed-anchor-cycle (Adapt)
- focal: the camera cone and live RESIDENCY DECISION rail
- roles: camera/visible surfaces = foreground anchor - incoming/outgoing tiles = foreground mechanism - demand scores = supporting - world grid = background
- sfx: click, whoosh

Adapt: pin the camera while three surfaces cycle through changing projected sizes and residency decisions.

Scene 1 (0.0-2.8s): CURRENT CAMERA pins and a visibility cone selects three surfaces.

Scene 2 (2.8-5.9s): NEED MIP 0 / NEED MIP 2 / NEED MIP 4 scores resolve beside the surfaces.

Scene 3 (5.9-8.7s): Needed tiles move IN in cyan while one distant tile moves OUT in dim orange.

narrativeRole: Shows that camera demand drives mip residency.
keyMessage: The streamer prioritises detail that matters for the current view.

## Frame 4 - A working set

- scene: A fixed-size VRAM grid continuously exchanges texture tiles as the camera moves through three positions.
- voiceover: "That makes V-RAM a changing working set, not a warehouse. Residency updates as you move, turn and reveal new parts of the scene."
- duration: 8.96s
- poster: 6.5s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/04-working-set.html
- type: feature_showcase
- persuasion: Animated process
- beat: Flow + understanding
- blueprint: fixed-anchor-cycle (Adapt)
- focal: a constant-capacity VRAM grid whose contents change with the camera
- roles: VRAM grid = foreground anchor - tile swaps = foreground mechanism - camera path = supporting - archive = background
- sfx: click-soft, notification

Adapt: keep memory capacity fixed while three camera positions change which tiles occupy it.

Scene 1 (0.0-3.0s): CAMERA A fills the VRAM grid with a clearly labelled initial set.

Scene 2 (3.0-6.2s): CAMERA B reveals a new zone. Two tiles evict and two higher-priority tiles enter.

Scene 3 (6.2-9.0s): CAMERA C turns again while the gauge remains constant. WORKING SET holds.

narrativeRole: Reframes VRAM as a managed cache rather than permanent storage.
keyMessage: Residency changes continuously within a fixed memory budget.

## Frame 5 - When detail arrives late

- scene: A soft mip and sharp mip are compared beside a transfer timer and a tight-budget eviction gauge.
- voiceover: "If a detailed mip arrives late, a soft surface may snap into focus. With a tight budget, sharper levels may not stay resident."
- duration: 8.704s
- poster: 6.5s
- transition_in: crossfade
- status: animated
- src: compositions/frames/05-late-detail.html
- type: social_proof
- persuasion: Failure-mode comparison
- beat: Recognition + nuance
- blueprint: comparison-split (Adapt)
- focal: LATE ARRIVAL versus TIGHT BUDGET as distinct paths to lower detail
- roles: soft/sharp tiles = foreground proof - transfer and budget instruments = supporting - split panels = foreground comparison - dark grid = background
- sfx: glitch-2, impact-bass-1

Adapt: stack two causes vertically and change the same original texture in each panel.

Scene 1 (0.0-3.0s): LATE ARRIVAL shows MIP 3 first, then snaps to MIP 0 when the transfer completes.

Scene 2 (3.0-6.4s): TIGHT BUDGET loads MIP 0 briefly, then evicts it as the gauge reaches its limit.

Scene 3 (6.4-9.0s): POP-IN / NOT RESIDENT hold as separate diagnostic labels.

narrativeRole: Explains two possible reasons high detail may be absent.
keyMessage: Detail can arrive late or be displaced by memory pressure.

## Frame 6 - Ready for this moment

- scene: An ON DISK mip pyramid feeds a CURRENT VIEW selector that outputs only the best ready level.
- voiceover: "So the texture on disk is not always the texture on screen. You see the best level the streaming system has ready for that moment."
- duration: 8.277s
- poster: 6.6s
- transition_in: blur-crossfade
- status: animated
- src: compositions/frames/06-ready-now.html
- type: branding
- persuasion: Distillation + callback
- beat: Resolve + memorability
- blueprint: titlecard-reveal (Adapt)
- focal: BEST READY LEVEL / RIGHT NOW
- roles: final rule card = foreground subject - disk pyramid, VRAM selector and screen tile = supporting - SYSTEM TRACE marker = background
- sfx: notification, chime

Adapt: reduce the full process into one three-stage path, then hold the operative rule.

Scene 1 (0.0-3.0s): ON DISK shows the complete mip pyramid.

Scene 2 (3.0-6.6s): IN VRAM highlights only a selected subset and sends one level to CURRENT VIEW.

Scene 3 (6.6-9.0s): BEST READY LEVEL / RIGHT NOW holds with SYSTEM TRACE // 05.

narrativeRole: Resolves the storage-versus-display distinction.
keyMessage: The displayed texture level is the best suitable mip currently resident.
