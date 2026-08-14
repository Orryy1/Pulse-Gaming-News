# SCRIPT - system-trace-ray-tracing-bvh

**Voice:** bm_george (local Kokoro, British male)
**Voice settings:** speed 1.0 - language en-GB
**Voice direction:** Begin with scale, then make each rejection feel fast and satisfying.

---

## Line 1 - Millions of triangles (Frame 1)

    Ray tracing sounds impossible at game speed. One ray could meet millions of triangles, unless the renderer learns where not to look.

## Line 2 - Boxes inside boxes (Frame 2)

    Real-time systems organise geometry into a bounding volume hierarchy, or B-V-H: nested boxes around progressively smaller groups of shapes.

## Line 3 - Miss one box (Frame 3)

    A ray first tests a large box. If it misses, every triangle inside that branch is rejected at once.

## Line 4 - Narrow the search (Frame 4)

    The search narrows from world-sized regions to smaller boxes, then to the few triangles that might be hit. Empty space becomes cheap.

## Line 5 - The structure has a cost (Frame 5)

    Building and updating that structure still costs time, especially when geometry moves. Engines balance rebuild quality, update cost and ray count.

## Line 6 - Ask what can be ignored (Frame 6)

    Real-time ray tracing does not brute-force the scene. It wins by asking a better first question: which parts can this ray ignore?
