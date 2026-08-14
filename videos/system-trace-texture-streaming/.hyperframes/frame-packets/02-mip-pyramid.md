# Frame packet: 02-mip-pyramid

## Project inputs

- Project: C:\Users\MORR\.codex\worktrees\pulse-gaming\autonomous-buffer-20260814\videos\system-trace-texture-streaming
- Design tokens: C:\Users\MORR\.codex\worktrees\pulse-gaming\autonomous-buffer-20260814\videos\system-trace-texture-streaming\frame.md
- RULES_DIR: C:\Users\MORR\.codex\skills\hyperframes-animation\rules

## Assigned storyboard block

## Frame 2 - Mip levels

- scene: One original texture resolves into a pyramid of detailed to tiny mip levels, each mapped to a different screen size.
- voiceover: "Textures come in mip levels: large detailed versions for close views and progressively smaller versions for distant or tiny surfaces."
- duration: 9.387s
- poster: 6.2s
- transition_in: push-slide LEFT
- status: outline
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
