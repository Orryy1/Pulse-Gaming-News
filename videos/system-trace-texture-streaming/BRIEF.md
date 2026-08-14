# Brief - SYSTEM TRACE 05

## Identity

- Project: `system-trace-texture-streaming`
- Title: `Why Games Do Not Keep Every Texture in VRAM`
- Destination: YouTube Shorts
- Format: 1080 x 1920, 30 fps, 45-58 seconds
- Language: British English
- Mode: autonomous

## Thesis

Texture streaming treats graphics memory as a changing working set, keeping the
most useful mip levels resident as the camera and memory budget change.

## Visual system

Original texture tiles, mip pyramids, VRAM gauges, camera cones and residency
maps. Near-black, Pulse amber, warm white and proof cyan. No gameplay,
screenshots, platform marks or borrowed diagrams.

## Source lock

- Epic Games: Texture streaming overview
  https://dev.epicgames.com/documentation/en-us/unreal-engine/texture-streaming-overview-for-unreal-engine
- Microsoft: Sampler Feedback
  https://microsoft.github.io/DirectX-Specs/d3d/SamplerFeedback.html

## Guardrails

- Describe a common streaming model, not one universal engine algorithm.
- Present late mip arrival as a possible cause of visible softness, not the only cause.
- British English, no serial comma and no internal QA language in public copy.
- Keep meaningful content above the bottom 326 px caption band.
