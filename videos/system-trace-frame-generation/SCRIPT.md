# SCRIPT - system-trace-frame-generation

**Voice:** bm_george (local Kokoro, British male)
**Voice settings:** speed 1.0 · language en-GB
**Voice direction:** Treat the synthetic frame as a carefully bounded visual prediction. Do not imply extra game simulation or instant input.

---

## Line 1 - The inserted image (Frame 1)

    Frame generation can make motion look much smoother, but the new image between two frames was not fully rendered by the game.

## Line 2 - The evidence (Frame 2)

    The system examines consecutive frames plus motion evidence such as optical flow, motion vectors, depth and camera data.

## Line 3 - The in-between prediction (Frame 3)

    It predicts where visible pixels belong between those moments, then synthesises an intermediate image for the display.

## Line 4 - Two rates remain (Frame 4)

    The displayed frame rate rises, while game simulation and input sampling still follow the underlying rendered frames.

## Line 5 - Weak evidence shows (Frame 5)

    Interpolation also needs careful pacing and can distort rapid motion, scene changes or interface elements when its evidence is weak.

## Line 6 - A healthy base (Frame 6)

    Frame generation is best understood as visual interpolation: smoother presentation built on top of a healthy base frame rate.

---
format: 1080x1920
duration: 54s advisory
message: "Frame generation inserts predicted display images between rendered frames, so base rate, pacing and latency still matter"
arc: concept-explainer
audience: "players curious about AI and optical-flow frame generation"
mode: autonomous
music: "original minimal Pulse tech synthesis"
captions: true
series: "SYSTEM TRACE"
episode: "14"
---
