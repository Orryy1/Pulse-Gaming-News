# SCRIPT — system-trace-temporal-upscaling

**Voice:** bm_george (local Kokoro, British male)
**Voice settings:** speed 1.0 · language en-GB
**Voice direction:** Make the reconstruction feel clever and understandable. Keep the failure modes calm and diagnostic.

---

## Line 1 — Fewer pixels in (Frame 1)

    That sharp four-K image may start smaller. Many games render fewer pixels, then rebuild detail using information gathered across time.

## Line 2 — Four inputs (Frame 2)

    A temporal upscaler gets the new frame, motion vectors, depth and samples from earlier frames. Each input answers a different question.

## Line 3 — Move the history (Frame 3)

    Motion vectors show where surfaces moved. Depth separates foreground from background. History supplies detail that one lower-resolution frame cannot hold.

## Line 4 — Keep or reject (Frame 4)

    The system reprojects useful history into the current view and rejects what no longer belongs. Done well, the result looks far denser.

## Line 5 — Where it breaks (Frame 5)

    Fast reveals, thin geometry and particles can break history. Old samples may ghost, while fresh pixels may shimmer before enough evidence arrives.

## Line 6 — The rule (Frame 6)

    Temporal upscaling is not a fancy stretch. It reconstructs a moving image — borrowing from the past without letting it haunt the present.
