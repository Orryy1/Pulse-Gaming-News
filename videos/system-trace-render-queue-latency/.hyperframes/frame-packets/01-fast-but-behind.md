# Frame packet: 01-fast-but-behind

## Project inputs

- Project: C:\Users\MORR\.codex\worktrees\pulse-gaming\autonomous-buffer-20260814\videos\system-trace-render-queue-latency
- Design tokens: C:\Users\MORR\.codex\worktrees\pulse-gaming\autonomous-buffer-20260814\videos\system-trace-render-queue-latency\frame.md
- RULES_DIR: C:\Users\MORR\.codex\skills\hyperframes-animation\rules

## Assigned storyboard block

## Frame 1 - Fast but behind

- scene: A 144 FPS counter races while a newly pressed input pulse waits behind older timestamped frames.
- voiceover: "A high frame rate can still feel behind your hands. The missing number is how long your newest input waits before reaching the screen."
- duration: 8.427s
- poster: 5.9s
- transition_in: cut
- status: outline
- src: compositions/frames/01-fast-but-behind.html
- type: hook
- persuasion: Counterintuitive contrast
- beat: Surprise + curiosity
- blueprint: kinetic-type-beats (Adapt)
- focal: HIGH FPS replacing FRESH INPUT? above one visibly waiting input pulse
- roles: input pulse and queue = foreground subjects - FPS counter = supporting - timing grid = background
- sfx: impact-bass-1, glitch-1

Adapt: keep the fast counter running while the central claim swaps to expose the hidden waiting time.

Scene 1 (0.0-2.7s): 144 FPS counts rapidly in cyan over a clean dark field.

Scene 2 (2.7-5.7s): A bright INPUT NOW pulse enters a queue behind three older frame cards.

Scene 3 (5.7-8.6s): HIGH FPS swaps to FRESH FRAME? while a LATENCY clock continues ticking.

narrativeRole: Separates throughput from the age of the displayed response.
keyMessage: A fast frame rate does not alone reveal input-to-display delay.
