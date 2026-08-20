# SCRIPT - system-trace-vsync-latency

**Voice:** bm_george (local Kokoro, British male)
**Voice settings:** speed 1.0, language en-GB
**Voice direction:** Be even-handed. The line about a missed boundary needs a small pause, and the ending should sound like a trade-off rather than a warning.

---

## Line 1 - Tear-free, but waiting (Frame 1)

    V-Sync can remove the visible tear, yet the same setting may make a fast game feel slightly less immediate.

## Line 2 - Wait for refresh (Frame 2)

    With synchronisation enabled, a completed frame is presented on the display's refresh boundary instead of arriving whenever it finishes.

## Line 3 - Missed the gate (Frame 3)

    Miss that boundary by a fraction and the previous image may remain visible until another refresh opportunity arrives.

## Line 4 - One refresh period (Frame 4)

    At sixty hertz one refresh lasts about sixteen point seven milliseconds. At one hundred and twenty, it is roughly eight point three.

## Line 5 - The deeper queue (Frame 5)

    A deep frame queue can add more waiting because fresh input sits behind work the CPU prepared earlier.

## Line 6 - The trade-off (Frame 6)

    V-Sync is therefore a trade-off, not a fixed lag number: tear-free presentation in exchange for timing that needs careful pacing.

---
format: 1080x1920
duration: 53s
message: "V-Sync can add waiting when finished frames must meet refresh boundaries and queues run ahead"
arc: concept-explainer
audience: "players comparing tear-free output with responsive controls"
mode: autonomous
music: "original minimal Pulse tech synthesis, analytical and restrained, no vocals"
captions: true
series: "SYSTEM TRACE"
episode: "09"
