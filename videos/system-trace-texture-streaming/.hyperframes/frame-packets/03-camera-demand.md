# Frame packet: 03-camera-demand

## Project inputs

- Project: C:\Users\MORR\.codex\worktrees\pulse-gaming\autonomous-buffer-20260814\videos\system-trace-texture-streaming
- Design tokens: C:\Users\MORR\.codex\worktrees\pulse-gaming\autonomous-buffer-20260814\videos\system-trace-texture-streaming\frame.md
- RULES_DIR: C:\Users\MORR\.codex\skills\hyperframes-animation\rules

## Assigned storyboard block

## Frame 3 - Choose what matters

- scene: A camera cone scores visible surfaces, then routes the needed mip tiles into VRAM while distant tiles leave.
- voiceover: "The streamer estimates which levels matter for the current camera. Useful detail moves in, while less valuable data can move out."
- duration: 8.747s
- poster: 6.3s
- transition_in: crossfade
- status: outline
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
