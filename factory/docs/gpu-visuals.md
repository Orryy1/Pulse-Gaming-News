# GPU visuals (src/gpuvis)

Pictures made better on the PC's RTX 4090: filled frames, upscaled stills, thumbnail candidates ranked by the local
vision model, and the match wipe. Every feature is behind a switch that is off by default.

| Switch             | What it does                                                                                                                                                                                                                                                                                                   | Where                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `FILL_FRAME`       | A 16:9 still in a Short (or a portrait cover in a long video) is extended to fill the frame instead of sitting over its blurred copy. The original's pixels are pasted back; only the margins are new. Labelled `EDGES EXTENDED BY AI`.                                                                        | `src/gpuvis/fill.ts`, `Background.tsx`, `Long.tsx`                               |
| `UPSCALE_STILLS`   | Stills under 1080p are enlarged by Real-ESRGAN; pixel art by whole pixels (the network smears it); a result much sharper than Lanczos (halos) falls back to Lanczos.                                                                                                                                           | `src/gpuvis/upscale.ts`                                                          |
| `THUMB_CANDIDATES` | The main poster's art extended sideways (room for the words) and relit (an atmosphere plate on the words' side), drawn as the same poster, checked like the other designs, then every design scored on a rubric by the local vision model; the top three become the thumbnail and the Test & compare variants. | `src/gpuvis/thumbs.ts`, `thumbstep.ts`                                           |
| `MATCH_WIPE`       | The same place in two games (GTA V and GTA VI), found by library notes, frame layout and the vision model, wiped one into the other. Proof tool only so far; not yet placed in episode plans.                                                                                                                  | `src/gpuvis/framematch.ts`, `src/render/MatchWipe.tsx`, `src/tools/matchwipe.ts` |
| `GPUVIS_URL`       | The PC's GPU picture service (default `http://127.0.0.1:8797`).                                                                                                                                                                                                                                                | `src/gpuvis/server.ts`, `client.ts`                                              |

## How it runs

- The PC runs `node --import tsx src/gpuvis/server.ts`. It holds an orchestrator GPU turn at priority 60 while jobs
  arrive and gives it back after 90 s idle (unloading ComfyUI, stopping a ComfyUI it started).
- The factory asks for a turn of at most 4 minutes (`GPUVIS_FACTORY_MAX_WAIT`). If the service is down, busy or slow,
  the episode gives up at once and keeps its usual pictures.
- From the Mac the service is reached over the cable. **Not done yet:** port 8797 must be added to `PORTS` in
  `C:\Claude\orchestrator\lan_relay.py` (the Master orchestrator's area), and `GPUVIS_URL` set on the Mac.
- ComfyUI is `C:\Users\MORR\ComfyUI` (0.18.1) run with the PC's Python 3.14
  (`C:\Python314\python.exe`, torch 2.11 with CUDA 12.8; the desktop app's venv lacks the frontend package and exits
  at start), models in `D:\AI\ComfyUI-models`. Real-ESRGAN's weights are hard-linked
  into `upscale_models` from `D:\pulse-tools\models\realesrgan`. Outputs are ComfyUI temp previews and uploads are
  deleted after each job, so nothing collects on C:.

## Licence evidence (checked 20 Nov 2026)

| Model                                                                               | Licence                                                                                                                                                                                                                                                                                         | Commercial use | Used                                                                                      |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------- |
| FLUX.2 [klein] 4B (`flux-2-klein-4b.safetensors`, Qwen3 4B text encoder, klein VAE) | Apache 2.0. The model card at huggingface.co/black-forest-labs/FLUX.2-klein-4B says the weights are "available for commercial use under the Apache 2.0 license". The card also says the klein 9B models are non-commercial, so they are not used.                                               | Yes            | Fill, thumbnail plates                                                                    |
| Real-ESRGAN (`RealESRGAN_x4plus.pth`, `realesr-general-x4v3.pth`)                   | BSD 3-Clause (github.com/xinntao/Real-ESRGAN, LICENSE)                                                                                                                                                                                                                                          | Yes            | Upscaling                                                                                 |
| Qwen3-VL 8B / 30B (Ollama)                                                          | Apache 2.0 (huggingface.co/Qwen/Qwen3-VL-30B-A3B-Instruct)                                                                                                                                                                                                                                      | Yes            | Scene captions, margin check, thumbnail rubric, match judge                               |
| SDXL base 1.0                                                                       | CreativeML Open RAIL++-M: commercial use allowed, subject to the use restrictions                                                                                                                                                                                                               | Yes            | Not used                                                                                  |
| FLUX.1 [dev], FLUX.1 Fill [dev]                                                     | FLUX.1 [dev] Non-Commercial License v1.1.1. Section 1(c) says any use "for revenue-generating activity" is not a Non-Commercial Purpose. Section 2(d) lets you use outputs commercially, but running the model for a monetised channel is itself commercial use, and that needs a paid licence. | No             | **Never.** A test in `tests/gpuvis.test.ts` fails if a workflow names a FLUX.1 dev model. |

Note: `src/assets/illustrate.workflow.json` (the documentary concept sketches, `ILLUSTRATE_*`) runs on FLUX.1 dev. That
breaks the same licence and should move to klein 4B before it is switched on again.

## Measurements

See the proof folders under `D:\pulse-data\scratch\gpuvis\proof\` (each has a `report.json`); the summary is in the
branch report.
