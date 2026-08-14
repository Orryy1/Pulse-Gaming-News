# Frame packet: 04-working-set

## Project inputs

- Project: C:\Users\MORR\.codex\worktrees\pulse-gaming\autonomous-buffer-20260814\videos\system-trace-texture-streaming
- Design tokens: C:\Users\MORR\.codex\worktrees\pulse-gaming\autonomous-buffer-20260814\videos\system-trace-texture-streaming\frame.md
- RULES_DIR: C:\Users\MORR\.codex\skills\hyperframes-animation\rules

## Assigned storyboard block

## Frame 4 - A working set

- scene: A fixed-size VRAM grid continuously exchanges texture tiles as the camera moves through three positions.
- voiceover: "That makes V-RAM a changing working set, not a warehouse. Residency updates as you move, turn and reveal new parts of the scene."
- duration: 8.96s
- poster: 6.5s
- transition_in: push-slide LEFT
- status: outline
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
