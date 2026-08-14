# Frame packet: 04-reduce-queue

## Project inputs

- Project: C:\Users\MORR\.codex\worktrees\pulse-gaming\autonomous-buffer-20260814\videos\system-trace-render-queue-latency
- Design tokens: C:\Users\MORR\.codex\worktrees\pulse-gaming\autonomous-buffer-20260814\videos\system-trace-render-queue-latency\frame.md
- RULES_DIR: C:\Users\MORR\.codex\skills\hyperframes-animation\rules

## Assigned storyboard block

## Frame 4 - Reduce the queue

- scene: A deep queue contracts as CPU pacing follows GPU capacity, with a separate frame-cap limiter preventing overproduction.
- voiceover: "Latency controls reduce that wait by matching CPU work more closely to GPU capacity. A sensible frame cap can also prevent a deep queue."
- duration: 11.008s
- poster: 6.6s
- transition_in: push-slide LEFT
- status: outline
- src: compositions/frames/04-reduce-queue.html
- type: feature_showcase
- persuasion: Before-and-after mechanism
- beat: Relief + clarity
- blueprint: comparison-split (Adapt)
- focal: DEEP QUEUE versus PACED QUEUE with lower input age
- roles: queue comparisons = foreground proof - CPU/GPU clocks = supporting - input-age meter = foreground payoff - dark grid = background
- sfx: click-soft, notification

Adapt: stack uncontrolled and paced pipelines vertically, preserving the same GPU capacity.

Scene 1 (0.0-3.0s): UNPACED shows four prepared frames and a rising input-age meter.

Scene 2 (3.0-6.3s): PACED synchronises CPU release to GPU completion and contracts the queue to one.

Scene 3 (6.3-9.2s): A FRAME CAP limiter prevents another card entering early. LESS WAITING holds.

narrativeRole: Shows how pacing can reduce queue-based latency.
keyMessage: Matching production to consumption can keep work fresher.
