# SCRIPT - system-trace-motion-blur

**Voice:** bm_george (local Kokoro, British male)
**Voice settings:** speed 1.0 · language en-GB
**Voice direction:** Keep the explanation practical. Make the distinction between visual continuity and game responsiveness unmistakable.

---

## Line 1 - A softer gap (Frame 1)

    Motion blur cannot create extra frames, yet it can make the movement between existing frames feel less harsh.

## Line 2 - The shutter path (Frame 2)

    A real camera gathers light while its shutter is open, so a fast object leaves a streak across that exposure.

## Line 3 - The game estimate (Frame 3)

    Games often estimate the same path with per-pixel velocity, then sample and blend colour along the direction of travel.

## Line 4 - A continuous-looking path (Frame 4)

    That spread hides some of the step between two positions, which can make thirty frames per second look more continuous.

## Line 5 - What blur cannot repair (Frame 5)

    It does not update controls sooner, repair a stutter or perfectly handle every reflection, shadow and crossing object.

## Line 6 - Visual glue (Frame 6)

    Motion blur is therefore visual glue, not more performance. It can soften the gap, while the game still updates at the same rate.

---
format: 1080x1920
duration: 53s advisory
message: "Motion blur spreads visible movement across time but does not add game updates or responsiveness"
arc: concept-explainer
audience: "players curious about frame rate and motion"
mode: autonomous
music: "original minimal Pulse tech synthesis"
captions: true
series: "SYSTEM TRACE"
episode: "13"
---
