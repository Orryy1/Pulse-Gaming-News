# FLUX.2 klein 4B: licence evidence for the concept sketches

The documentary concept sketches (ILLUSTRATE_ENABLED, `src/assets/illustrate.ts`) are drawn by
**FLUX.2 klein 4B** from Black Forest Labs. It is released under the **Apache License 2.0**, which allows
commercial use, so its pictures can go into monetised Pulse Gaming videos.

## What was checked, 20 Nov 2026

- Model card: https://huggingface.co/black-forest-labs/FLUX.2-klein-4B
  - Metadata licence field: `apache-2.0`.
  - Card text: "Open weights available for commercial use under the Apache 2.0 license".
- Hugging Face API (`https://huggingface.co/api/models/black-forest-labs/FLUX.2-klein-4B`):
  `gated: false`, `cardData.license: apache-2.0`, repository commit
  `e7b7dc27f91deacad38e78976d1f2b499d76a294` (last modified 24 Feb 2026).
- `LICENSE.md` in that commit is the Apache License, Version 2.0, January 2004
  (sha256 `ca02bc51900ab07789d1b70283329e7137f5af98f5161c23a1c81fc38a4af1fe`).
- `model_index.json` names `Flux2KleinPipeline` with `is_distilled: true`
  (sha256 `51a76cb1cf3ed37423a1128c79c22faee8e6fbe7f5aaeb737f0a258930dbaac0`).

`mac/sketch.sh` downloads exactly that commit and refuses to install the service unless the downloaded
`LICENSE.md` is the Apache licence and `model_index.json` names the klein pipeline.

## Where the weights are

- Mac mini (production): `/Volumes/Storage/pulse-sketch/FLUX.2-klein-4B` (the diffusers layout from the
  commit above, about 15 GB, on the external drive so the internal disk keeps its 35 GB free).
- PC (the ComfyUI route, `ILLUSTRATE_BACKEND=comfy`): `D:\AI\ComfyUI-models\diffusion_models\flux-2-klein-4b.safetensors`,
  `text_encoders\qwen3-4b-flux2-klein.safetensors`, `vae\flux2-klein-vae.safetensors`.

## Never for production output

**FLUX.1 dev** and **FLUX.1 Fill** are under the FLUX.1 [dev] Non-Commercial License. They must not draw
anything that goes into a Pulse video, and must not be put back into `src/assets/illustrate.workflow.json`
or the sketch service. Other FLUX.2 variants have their own licences (FLUX.2 dev is non-commercial; check the
9B klein and any other variant on its own card): check before swapping any model in.
