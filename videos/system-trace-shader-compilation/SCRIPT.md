# SCRIPT — system-trace-shader-compilation

**Voice:** bm_george (local Kokoro, British male)
**Voice settings:** speed 1.0 · language en-GB
**Voice direction:** Curious and exact. The first-run/second-run contrast should feel like a reveal, not a complaint.

---

## Line 1 — First time only (Frame 1)

    Ever notice a PC game hitch when an effect first appears, then glide through the same moment later? The scene may not be the problem.

## Line 2 — The recipe (Frame 2)

    Modern graphics APIs bundle shaders and fixed settings into pipeline state objects. The GPU needs the right combination before it draws.

## Line 3 — The interruption (Frame 3)

    If that pipeline is missing, the game may build it as the effect arrives. That work can interrupt an otherwise steady frame.

## Line 4 — The cache (Frame 4)

    Once cached, that pipeline can be reused. A second run may feel smoother even when the graphics settings have not changed.

## Line 5 — Why it still happens (Frame 5)

    Engines pre-build likely pipelines and preserve caches, but the possible combinations are huge. Driver updates may also invalidate old data.

## Line 6 — The clue (Frame 6)

    Not every hitch is shader compilation. But a one-time pause tied to a new effect is a clue: the game may be building tomorrow's smooth frame today.
