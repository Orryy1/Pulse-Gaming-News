# SCRIPT - system-trace-anti-aliasing

**Voice:** bm_george (local Kokoro, British male)
**Voice settings:** speed 1.0 · language en-GB
**Voice direction:** Explain the pixel decisions with steady curiosity. Keep each trade-off plain, not dramatic.

---

## Line 1 - The pixel staircase (Frame 1)

    A perfectly straight diagonal can look like a staircase in a game because the screen still draws a square pixel grid.

## Line 2 - A binary edge (Frame 2)

    Without anti-aliasing, each edge pixel becomes fully covered or fully empty, creating a hard sequence of visible steps.

## Line 3 - Coverage, not a guess (Frame 3)

    MSAA checks several sub-pixel coverage positions, letting an edge pixel represent a blend instead of a binary answer.

## Line 4 - The fast image pass (Frame 4)

    FXAA searches the finished image for jagged patterns and smooths them quickly, though fine detail can become softer.

## Line 5 - Borrowed history (Frame 5)

    Temporal methods borrow evidence from earlier frames, improving stability but risking ghosting when history no longer matches motion.

## Line 6 - The trade-off (Frame 6)

    So anti-aliasing is not one filter. Every method trades cleaner edges against cost, softness or artefacts across time.

---
format: 1080x1920
duration: 53s advisory
message: "Anti-aliasing replaces hard pixel steps with coverage or image evidence, each with a different compromise"
arc: concept-explainer
audience: "players curious about image quality"
mode: autonomous
music: "original minimal Pulse tech synthesis"
captions: true
series: "SYSTEM TRACE"
episode: "12"
---
