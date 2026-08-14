# Frame packet: 02-cpu-gpu-queue

## Project inputs

- Project: C:\Users\MORR\.codex\worktrees\pulse-gaming\autonomous-buffer-20260814\videos\system-trace-render-queue-latency
- Design tokens: C:\Users\MORR\.codex\worktrees\pulse-gaming\autonomous-buffer-20260814\videos\system-trace-render-queue-latency\frame.md
- RULES_DIR: C:\Users\MORR\.codex\skills\hyperframes-animation\rules

## Assigned storyboard block

## Frame 2 - Keep the GPU busy

- scene: CPU and GPU work lanes pass prepared frame cards through a short queue to maintain continuous GPU activity.
- voiceover: "The CPU prepares rendering work and the GPU executes it. A system may queue frames ahead to keep the GPU busy."
- duration: 8.832s
- poster: 6.0s
- transition_in: push-slide LEFT
- status: outline
- src: compositions/frames/02-cpu-gpu-queue.html
- type: product_intro
- persuasion: System map
- beat: Orientation + clarity
- blueprint: spatial-pan-stations (Adapt)
- focal: CPU PREP to FRAME QUEUE to GPU EXECUTE
- roles: three pipeline stations = foreground subject - frame cards = foreground mechanism - utilisation meter = supporting - dark rails = background
- sfx: click-soft, whoosh-short

Adapt: pan through the three processing stations while one frame card keeps its timestamp.

Scene 1 (0.0-2.7s): CPU PREP creates FRAME A and stamps it T-2.

Scene 2 (2.7-5.6s): FRAME A joins B and C in a short FRAME QUEUE.

Scene 3 (5.6-8.4s): GPU EXECUTE consumes cards continuously and BUSY / 99% holds.

narrativeRole: Shows why queued work can improve GPU utilisation.
keyMessage: Prepared frames may wait so the GPU always has work available.
