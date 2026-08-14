# Brief - SYSTEM TRACE 07

## Identity

- Project: `system-trace-render-queue-latency`
- Title: `Why More FPS Does Not Always Mean Faster Input`
- Destination: YouTube Shorts
- Format: 1080 x 1920, 30 fps, 45-58 seconds
- Language: British English
- Mode: autonomous

## Thesis

Input latency depends on how long new work waits across the CPU, render queue,
GPU and display, not only on the final frames-per-second average.

## Visual system

Original input pulses, CPU/GPU lanes, queued frame cards, latency clocks and
display scans. Near-black, Pulse amber, warm white and proof cyan. No gameplay,
screenshots, platform marks or borrowed diagrams.

## Source lock

- Microsoft: DXGI frame latency and presentation improvements
  https://learn.microsoft.com/en-us/windows/win32/direct3ddxgi/dxgi-1-3-presentation-improvements
- NVIDIA: Reflex developer tools
  https://developer.nvidia.com/performance-rendering-tools/reflex

## Guardrails

- Explain the queue as one possible latency contributor, not the only one.
- State that the benefit depends on the active bottleneck.
- British English, no serial comma and no internal QA language in public copy.
- Keep meaningful content above the bottom 326 px caption band.
