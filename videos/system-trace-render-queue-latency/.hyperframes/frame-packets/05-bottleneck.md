# Frame packet: 05-bottleneck

## Project inputs

- Project: C:\Users\MORR\.codex\worktrees\pulse-gaming\autonomous-buffer-20260814\videos\system-trace-render-queue-latency
- Design tokens: C:\Users\MORR\.codex\worktrees\pulse-gaming\autonomous-buffer-20260814\videos\system-trace-render-queue-latency\frame.md
- RULES_DIR: C:\Users\MORR\.codex\skills\hyperframes-animation\rules

## Assigned storyboard block

## Frame 5 - The bottleneck matters

- scene: GPU-BOUND, CPU-BOUND and DISPLAY-BOUND paths compare how much queue control changes total latency.
- voiceover: "The result depends on the bottleneck. If the game is not GPU-bound, or another stage dominates, the same change may help less."
- duration: 8.789s
- poster: 6.4s
- transition_in: crossfade
- status: outline
- src: compositions/frames/05-bottleneck.html
- type: social_proof
- persuasion: Honest qualification
- beat: Nuance + confidence
- blueprint: dataviz-countup (Adapt)
- focal: three latency bars with different dominant stages
- roles: stage bars = foreground proof - bottleneck labels = supporting - total-latency ruler = foreground comparison - lab grid = background
- sfx: glitch-2, impact-bass-1

Adapt: use three compact path instruments and change only the dominant segment.

Scene 1 (0.0-2.8s): GPU-BOUND shows a long queue/GPU segment and a strong queue-control reduction.

Scene 2 (2.8-5.9s): CPU-BOUND shifts the longest segment to simulation, producing a smaller reduction.

Scene 3 (5.9-8.8s): DISPLAY-BOUND retains a long scan segment. BOTTLENECK DECIDES holds.

narrativeRole: Prevents one latency technique from sounding universally transformative.
keyMessage: The dominant stage determines how much queue reduction can help.
