# Brief - SYSTEM TRACE 06

## Identity

- Project: `system-trace-ray-tracing-bvh`
- Title: `How Ray Tracing Avoids Testing Every Triangle`
- Destination: YouTube Shorts
- Format: 1080 x 1920, 30 fps, 45-58 seconds
- Language: British English
- Mode: autonomous

## Thesis

A bounding volume hierarchy lets a ray reject large regions of geometry before
testing the small set of triangles that might actually be hit.

## Visual system

Original ray paths, nested bounding boxes, triangle clusters, traversal stacks
and cost meters. Near-black, Pulse amber, warm white and proof cyan. No gameplay,
screenshots, platform marks or borrowed diagrams.

## Source lock

- Microsoft: DirectX Raytracing specification
  https://microsoft.github.io/DirectX-Specs/d3d/Raytracing.html
- NVIDIA: Thinking Parallel, tree traversal on the GPU
  https://developer.nvidia.com/blog/thinking-parallel-part-ii-tree-traversal-gpu/

## Guardrails

- Explain the broad acceleration-structure idea without claiming one fixed implementation.
- Distinguish traversal savings from the cost of building or updating the structure.
- British English, no serial comma and no internal QA language in public copy.
- Keep meaningful content above the bottom 326 px caption band.
