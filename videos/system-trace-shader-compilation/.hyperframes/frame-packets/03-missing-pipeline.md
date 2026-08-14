# Frame packet: 03-missing-pipeline

## Project inputs

- Project: C:\Users\MORR\.codex\worktrees\pulse-gaming\autonomous-buffer-20260814\videos\system-trace-shader-compilation
- Design tokens: C:\Users\MORR\.codex\worktrees\pulse-gaming\autonomous-buffer-20260814\videos\system-trace-shader-compilation\frame.md
- RULES_DIR: C:\Users\MORR\.codex\skills\hyperframes-animation\rules

## Assigned storyboard block

## Frame 3 — Missing at the moment

- scene: A new effect reaches the draw gate while its pipeline card is still being assembled, stretching one frame to 38 ms.
- voiceover: "If that pipeline is missing, the game may build it as the effect arrives. That work can interrupt an otherwise steady frame."
- duration: 8.235s
- poster: 7.2s
- transition_in: crossfade
- status: outline
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
