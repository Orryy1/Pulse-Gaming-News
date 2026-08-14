# Frame packet: 04-history-gate

## Project inputs

- Project: C:\Users\MORR\.codex\worktrees\pulse-gaming\autonomous-buffer-20260814\videos\system-trace-temporal-upscaling
- Design tokens: C:\Users\MORR\.codex\worktrees\pulse-gaming\autonomous-buffer-20260814\videos\system-trace-temporal-upscaling\frame.md
- RULES_DIR: C:\Users\MORR\.codex\skills\hyperframes-animation\rules

## Assigned storyboard block

## Frame 4 — Keep or reject

- scene: A history-validation gate keeps aligned samples and rejects a tile exposed by a newly revealed background region.
- voiceover: "The system reprojects useful history into the current view and rejects what no longer belongs. Done well, the result looks far denser."
- duration: 8.96s
- poster: 6.4s
- transition_in: push-slide LEFT
- status: outline
- src: compositions/frames/04-history-gate.html
- type: social_proof
- persuasion: Decision rule + payoff
- beat: Tension + confidence
- blueprint: comparison-split (Adapt)
- focal: the KEEP / REJECT validation gate applied to matched and exposed samples
- roles: KEEP panel = foreground payoff · REJECT panel = foreground comparison · disocclusion mask and sample tiles = supporting · dark split field = background
- sfx: click-soft, notification

Adapt: stack KEEP and REJECT vertically with matched sample geometry, then merge
only the accepted samples into the output.

Scene 1 (0.0–2.8s): An aligned sample enters KEEP and turns cyan. Its current and
historical outlines overlap exactly.

Scene 2 (2.8–6.1s): A foreground shape moves away, exposing new background. The
old foreground sample enters REJECT and fades to a dim strike-through.

Scene 3 (6.1–8.8s): Accepted history combines with new pixels in a denser output
grid. USEFUL PAST / CURRENT TRUTH holds.

narrativeRole: Makes validation as important as accumulation.
keyMessage: Temporal detail helps only when stale information is rejected.
