# SCRIPT - system-trace-screen-tearing

**Voice:** bm_george (local Kokoro, British male)
**Voice settings:** speed 1.0, language en-GB
**Voice direction:** Keep the explanation visual and matter-of-fact. Let "mid-scan" land clearly, then resolve the fault myth without drama.

---

## Line 1 - One refresh, two frames (Frame 1)

    That horizontal split is not your GPU failing. It is two finished frames sharing one display refresh.

## Line 2 - The display clock (Frame 2)

    A fixed-refresh screen scans a new image on its own clock, line by line from top to bottom.

## Line 3 - The GPU schedule (Frame 3)

    The GPU finishes frames on a different schedule, and scene complexity changes that delivery time from moment to moment.

## Line 4 - The split point (Frame 4)

    If the displayed buffer changes mid-scan, the upper lines can show one frame while lower lines show the next.

## Line 5 - Two ways to align (Frame 5)

    V-Sync waits for a refresh boundary, while variable refresh rate changes the display timing to meet a finished frame.

## Line 6 - The diagnosis (Frame 6)

    So tearing is a presentation mismatch, not a broken texture or low resolution. Two clocks simply crossed mid-picture.

---
format: 1080x1920
duration: 52s
message: "Screen tearing is a presentation-timing mismatch between frame delivery and display scanning"
arc: concept-explainer
audience: "players who want to understand a visible screen tear"
mode: autonomous
music: "original minimal Pulse tech synthesis, analytical and restrained, no vocals"
captions: true
series: "SYSTEM TRACE"
episode: "08"
