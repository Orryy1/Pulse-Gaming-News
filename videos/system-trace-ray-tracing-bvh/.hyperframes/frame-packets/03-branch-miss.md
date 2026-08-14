# Frame packet: 03-branch-miss

## Project inputs

- Project: C:\Users\MORR\.codex\worktrees\pulse-gaming\autonomous-buffer-20260814\videos\system-trace-ray-tracing-bvh
- Design tokens: C:\Users\MORR\.codex\worktrees\pulse-gaming\autonomous-buffer-20260814\videos\system-trace-ray-tracing-bvh\frame.md
- RULES_DIR: C:\Users\MORR\.codex\skills\hyperframes-animation\rules

## Assigned storyboard block

## Frame 3 - Miss one box

- scene: A ray misses a large branch box and the entire enclosed triangle count collapses to zero tests.
- voiceover: "A ray first tests a large box. If it misses, every triangle inside that branch is rejected at once."
- duration: 7.531s
- poster: 5.6s
- transition_in: crossfade
- status: outline
- src: compositions/frames/03-branch-miss.html
- type: feature_showcase
- persuasion: One decisive proof
- beat: Satisfaction + speed
- blueprint: fixed-anchor-cycle (Adapt)
- focal: the ray missing one box and cancelling an entire branch
- roles: ray/branch box = foreground mechanism - enclosed triangles = supporting - test counter = foreground proof - grid = background
- sfx: click, whoosh

Adapt: pin the ray origin and animate one geometric miss, then show its multiplied consequence.

Scene 1 (0.0-2.5s): RAY TEST 1 begins against a large amber branch box.

Scene 2 (2.5-5.3s): The ray passes outside its boundary. MISS flashes once.

Scene 3 (5.3-7.8s): Forty enclosed triangle markers dim together and TRIANGLE TESTS: 0 holds.

narrativeRole: Demonstrates the core pruning advantage of a hierarchy.
keyMessage: A box miss rejects every object in that branch.
