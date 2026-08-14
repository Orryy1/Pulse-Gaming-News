# Frame packet: 04-narrow-search

## Project inputs

- Project: C:\Users\MORR\.codex\worktrees\pulse-gaming\autonomous-buffer-20260814\videos\system-trace-ray-tracing-bvh
- Design tokens: C:\Users\MORR\.codex\worktrees\pulse-gaming\autonomous-buffer-20260814\videos\system-trace-ray-tracing-bvh\frame.md
- RULES_DIR: C:\Users\MORR\.codex\skills\hyperframes-animation\rules

## Assigned storyboard block

## Frame 4 - Narrow the search

- scene: A ray traverses one surviving branch through world, branch and leaf boxes before testing three final triangles.
- voiceover: "The search narrows from world-sized regions to smaller boxes, then to the few triangles that might be hit. Empty space becomes cheap."
- duration: 9.216s
- poster: 6.4s
- transition_in: push-slide LEFT
- status: outline
- src: compositions/frames/04-narrow-search.html
- type: feature_showcase
- persuasion: Causal traversal
- beat: Progress + understanding
- blueprint: spatial-pan-stations (Adapt)
- focal: one highlighted traversal path narrowing to a triangle hit
- roles: active path = foreground subject - nested boxes = foreground mechanism - rejected siblings = supporting - traversal stack = background
- sfx: click-soft, notification

Adapt: pan down the active hierarchy path while rejected siblings remain dim but visible.

Scene 1 (0.0-2.8s): WORLD / HIT sends the ray into one cyan branch.

Scene 2 (2.8-5.9s): BRANCH / HIT opens one leaf while two siblings reject.

Scene 3 (5.9-8.8s): LEAF / HIT exposes three triangles, one intersection lights and EMPTY SPACE: CHEAP holds.

narrativeRole: Shows the narrowing search from coarse bounds to precise geometry.
keyMessage: Traversal spends detailed tests only where intersections remain possible.
