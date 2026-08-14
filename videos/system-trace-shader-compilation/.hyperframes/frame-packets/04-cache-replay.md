# Frame packet: 04-cache-replay

## Project inputs

- Project: C:\Users\MORR\.codex\worktrees\pulse-gaming\autonomous-buffer-20260814\videos\system-trace-shader-compilation
- Design tokens: C:\Users\MORR\.codex\worktrees\pulse-gaming\autonomous-buffer-20260814\videos\system-trace-shader-compilation\frame.md
- RULES_DIR: C:\Users\MORR\.codex\skills\hyperframes-animation\rules

## Assigned storyboard block

## Frame 4 — Cache changes the replay

- scene: Identical FIRST RUN and SECOND RUN traces reveal one 38 ms spike versus a clean cached pass.
- voiceover: "Once cached, that pipeline can be reused. A second run may feel smoother even when the graphics settings have not changed."
- duration: 8.021s
- poster: 6.8s
- transition_in: push-slide LEFT
- status: outline
- src: compositions/frames/04-cache-replay.html
- type: social_proof
- persuasion: Controlled comparison + evidence
- beat: Aha + relief
- blueprint: comparison-split (Adapt)
- focal: paired timing traces with the same effect and different pipeline readiness
- roles: FIRST RUN trace = foreground comparison · SECOND RUN trace = foreground payoff · cache drawer and HIT badge = supporting · dual dark fields = background
- sfx: whoosh-short, notification

Adapt: stack the paired panels vertically and keep the effect glyph perfectly
matched so readiness is the only changed variable.

Scene 1 (0.0–2.7s): FIRST RUN enters from the left with the familiar 38 ms spike
and an empty cache drawer.

Scene 2 (2.7–6.5s): SECOND RUN enters from the right. The drawer opens, the same
recipe slides out and CACHE HIT lights in cyan.

Scene 3 (6.5–9.4s): Both traces align. The lower trace remains even while the
upper spike receives an amber marker; SAME SETTINGS / DIFFERENT WAIT holds.

narrativeRole: Explains why a repeat can improve without a settings change.
keyMessage: Reusing a prepared pipeline removes that preparation from the replay path.
