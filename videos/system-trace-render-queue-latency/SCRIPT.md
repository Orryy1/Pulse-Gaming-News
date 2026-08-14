# SCRIPT - system-trace-render-queue-latency

**Voice:** bm_george (local Kokoro, British male)
**Voice settings:** speed 1.0 - language en-GB
**Voice direction:** Keep the queue explanation crisp. Contrast a fast counter with a stale frame.

---

## Line 1 - Fast but behind (Frame 1)

    A high frame rate can still feel behind your hands. The missing number is how long your newest input waits before reaching the screen.

## Line 2 - Keep the GPU busy (Frame 2)

    The CPU prepares rendering work and the GPU executes it. A system may queue frames ahead to keep the GPU busy.

## Line 3 - Fresh input waits (Frame 3)

    An input sampled now can sit behind older prepared frames. The counter stays high, while the response arrives later.

## Line 4 - Reduce the queue (Frame 4)

    Latency controls reduce that wait by matching CPU work more closely to GPU capacity. A sensible frame cap can also prevent a deep queue.

## Line 5 - The bottleneck matters (Frame 5)

    The result depends on the bottleneck. If the game is not GPU-bound, or another stage dominates, the same change may help less.

## Line 6 - The freshest frame (Frame 6)

    Judge the whole path: input, simulation, render queue, GPU and display. The fastest counter is not automatically the freshest frame.
