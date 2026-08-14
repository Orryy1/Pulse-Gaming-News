# Frame packet: 03-reproject-history

## Project inputs

- Project: C:\Users\MORR\.codex\worktrees\pulse-gaming\autonomous-buffer-20260814\videos\system-trace-temporal-upscaling
- Design tokens: C:\Users\MORR\.codex\worktrees\pulse-gaming\autonomous-buffer-20260814\videos\system-trace-temporal-upscaling\frame.md
- RULES_DIR: C:\Users\MORR\.codex\skills\hyperframes-animation\rules

## Assigned storyboard block

## Frame 3 — Reproject the history

- scene: Three history tiles follow motion-vector paths into their new screen positions while depth keeps the foreground tile in front.
- voiceover: "Motion vectors show where surfaces moved. Depth separates foreground from background. History supplies detail that one lower-resolution frame cannot hold."
- duration: 10.603s
- poster: 7.2s
- transition_in: crossfade
- status: outline
- src: compositions/frames/03-reproject-history.html
- type: feature_showcase
- persuasion: Animated mechanism + causal chain
- beat: Comprehension + satisfaction
- blueprint: fixed-anchor-cycle (Adapt)
- focal: a pinned current-view window receiving motion-corrected history tiles
- roles: current-view window = foreground anchor · moving history tiles and vector paths = foreground mechanism · depth layers = supporting · time ruler = background
- sfx: click, whoosh

Adapt: pin the current-view window while adjacent history states cycle and move
into it on explicit vector paths.

Scene 1 (0.0–3.2s): CURRENT VIEW pins. Three older sample tiles wait on a dim
time ruler beside it.

Scene 2 (3.2–7.0s): Motion arrows self-draw and each tile travels into a new
location. The destination flashes cyan when aligned.

Scene 3 (7.0–9.8s): A foreground depth plane slides above the background plane,
preventing one tile from crossing the boundary. DETAIL FROM HISTORY holds.

narrativeRole: Shows how historical detail is moved and layered into the present view.
keyMessage: Motion and depth make temporal reuse spatially meaningful.
