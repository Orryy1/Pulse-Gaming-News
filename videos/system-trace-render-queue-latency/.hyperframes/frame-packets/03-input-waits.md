# Frame packet: 03-input-waits

## Project inputs

- Project: C:\Users\MORR\.codex\worktrees\pulse-gaming\autonomous-buffer-20260814\videos\system-trace-render-queue-latency
- Design tokens: C:\Users\MORR\.codex\worktrees\pulse-gaming\autonomous-buffer-20260814\videos\system-trace-render-queue-latency\frame.md
- RULES_DIR: C:\Users\MORR\.codex\skills\hyperframes-animation\rules

## Assigned storyboard block

## Frame 3 - Fresh input waits

- scene: A new input packet enters behind three old frame cards while their age clocks increase despite high throughput.
- voiceover: "An input sampled now can sit behind older prepared frames. The counter stays high, while the response arrives later."
- duration: 7.979s
- poster: 5.5s
- transition_in: crossfade
- status: outline
- src: compositions/frames/03-input-waits.html
- type: feature_showcase
- persuasion: Animated causal proof
- beat: Tension + understanding
- blueprint: fixed-anchor-cycle (Adapt)
- focal: INPUT NOW remaining behind OLD WORK in the fixed queue
- roles: input packet = foreground subject - queued frame cards = foreground obstacle - FPS and age meters = supporting - pipeline rail = background
- sfx: click, whoosh

Adapt: pin the queue and cycle completion while the newest input retains a visible waiting clock.

Scene 1 (0.0-2.4s): INPUT NOW arrives behind FRAME T-3, T-2 and T-1.

Scene 2 (2.4-5.1s): The GPU completes one frame at a time. FPS remains high while INPUT AGE rises.

Scene 3 (5.1-7.6s): The new input finally reaches execution and COUNTER FAST / RESPONSE LATE holds.

narrativeRole: Connects queue depth directly to response age.
keyMessage: New input can wait behind already prepared frames.
