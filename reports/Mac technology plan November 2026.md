# Mac technology plan, November 2026

Written 11 Nov 2026 after the owner's instruction: "we want to take full advantage of every single piece of technology this mac has". This is a research and design pass. Nothing in the factory was changed. The Mac was measured read-only over `ssh pulse-mac` at about 23:40 on 11 Nov.

Every idea here is free to run. Anything that needs a paid Apple developer account, or a model with a non-commercial licence, is marked and ranked down. iPhone-only features (AirDrop, Continuity Camera, Cinematic mode footage) are left out because the owner's phone is a Samsung Galaxy S24 Ultra.

## 1. What the Mac is (measured)

| Item          | Value                                                                                | What it means for Pulse                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model         | Mac mini, Mac16,10 (2024)                                                            | The base M4 model                                                                                                                                   |
| Chip          | Apple M4, 10 CPU cores (4 performance, 6 efficiency)                                 | Renders want the 4 fast cores; the 6 efficiency cores are a spare lane for background analysis                                                      |
| Graphics      | 10-core GPU, Metal 3                                                                 | Runs Chrome's GPU path for Remotion, MLX models and Core Image                                                                                      |
| Neural Engine | 16-core (M4 standard, not separately reported by the system)                         | Runs Apple's Vision, Sound Analysis and Core ML models at almost no RAM or CPU cost                                                                 |
| Media engine  | Hardware H.264, HEVC and ProRes encode and decode, hardware AV1 decode (M4 standard) | ffmpeg-full on the Mac exposes `h264_videotoolbox`, `hevc_videotoolbox`, `prores_videotoolbox`, `scale_vt` and the `videotoolbox` decoder           |
| Memory        | 16 GB unified, 3 GB swap file with 1.9 GB in use at the time                         | The main limit. Only one model in memory at a time, and never a large one beside a render                                                           |
| System        | macOS 15.0 (build 24A8332)                                                           | Vision aesthetics score exists. Apple's on-device Foundation Models, the new SpeechAnalyzer and Apple Intelligence do not (see section 5)           |
| Disk          | 228 GB, 85 GB free                                                                   | `~/PulseFactory` is 56 GB. About 18 GB is old cutover and rehearsal folders (`cutover-test` 14 GB, `rehearsal` 4 GB), a matter for the storage chat |
| Power         | Never sleeps, restarts after a power cut, wakes for network                          | Good for a 24/7 factory                                                                                                                             |
| Display       | One 1440p monitor attached, asleep                                                   | Needed for ScreenCaptureKit ideas only                                                                                                              |

### Toolchains found

- Homebrew with Node 26, Deno, Python 3.12 and 3.15, git, yt-dlp, cloudflared.
- `ffmpeg-full` 9.0.2 with VideoToolbox, Core Image (`coreimage` filter), libplacebo, Vulkan filters, libvmaf, vidstab, rubberband, `arnndn`, `loudnorm`, a built-in `whisper` filter, SVT-AV1, and Apple's audio encoder `aac_at`.
- `whisper.cpp`, `llama.cpp` and `tesseract` are already installed by Homebrew (pulled in with ffmpeg-full), so a local text model server needs no new install.
- Swift 6.0.3 and the Command Line Tools with the macOS 15.2 SDK (no full Xcode). Small Swift command-line tools can be compiled on the Mac.
- Python environments in `~/PulseFactory`:
  - `asr`: MLX 0.32, MLX Whisper (small.en and medium.en cached).
  - `ocr`: pyobjc with Vision, Core ML and Quartz.
  - `parallax`: PyTorch, transformers, OpenCV, Depth Anything V2 Small.
  - `macvision` (new on 11 Nov): MLX, mlx-vlm, mlx-audio, pyobjc with Vision, Sound Analysis, AVFoundation, Core Audio and Core ML. Qwen3.5-4B was being converted for MLX while this was measured.
- Apple frameworks present on this macOS: Vision, VisionKit, Core ML, Sound Analysis, Natural Language, Speech, ScreenCaptureKit, Translation, Core Spotlight, PHASE, MetalFX, Metal Performance Shaders Graph, ShazamKit, SensitiveContentAnalysis, VideoToolbox. Missing: FoundationModels, ImagePlayground.
- Built-in command-line tools: `shortcuts`, `say` (176 voices), `afconvert`, `afinfo`, `sips`, `mdfind`, `osascript`, `screencapture`, `avconvert`, `qlmanage`.
- Apps: Brave, Claude, GarageBand, iMovie, Keynote, Numbers, Pages, Safari.

### What the factory already uses on the Mac

- Four launchd services: the factory, the speech check (`asr_server.py`), the Cloudflare tunnel and the Discord bot. Orryy and TenderStandard jobs also live on this Mac, so it is a shared machine.
- Remotion renders through Chrome's GPU path (`REMOTION_GL=angle`) at concurrency 6.
- MLX Whisper for the narration check and word timings. Apple Vision text recognition (`src/assets/macocr.py`). Depth Anything for parallax stills.
- `MAC_GAMEPLAY` is on. `MAC_ASR`, `MAC_RENDER_SHORTS`, `MAC_FOOTAGE_GATHER` and `MAC_STILLS` are off because they were the PC-to-Mac worker switches from before the cutover.
- Every encode in `src` still uses `libx264` (14 places). The hardware encoder is on the `claude/appletools` branch, switched off.
- ffmpeg checks in use: `blackdetect`, `ebur128`, `loudnorm`, `silencedetect`.

## 2. Already built or in progress (not proposed again)

| Thing                                                  | Where                                  |
| ------------------------------------------------------ | -------------------------------------- |
| MLX Whisper speech-to-text                             | live                                   |
| Apple Vision text recognition                          | live                                   |
| Vision smart crop, subject lift, hardware encoding     | branch `claude/appletools`, all off    |
| Mac MLX picture checker                                | `macvision` environment                |
| Vision aesthetics score, Sound Analysis highlight tags | branch `claude/macnative`, in progress |
| Per-game scene index                                   | branch `claude/sceneindex`             |

## 3. Everything else Apple ships, mapped to Pulse

Effort: S is under a day, M is one to three days, L is longer. RAM risk is the risk of slowing or crashing a render on a 16 GB machine.

### Vision

| Feature                                   | Use for Pulse                                                                                                                                                                                     | Effort | RAM risk | Free and licence-safe                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------- | --------------------------------------------------------- |
| Image feature prints (similarity)         | Catch wrong-game pictures by comparing each chosen frame with known frames of that game from the scene index. Catch repeated or near-identical shots inside one video. Remove duplicate downloads | M      | Very low | Yes                                                       |
| Image classification (about 1,000 labels) | Free tags per keyframe (vehicle, city, forest, menu, text) to pre-filter before the paid or heavy picture check                                                                                   | S      | Very low | Yes                                                       |
| Optical flow and image registration       | A motion score per second: pick the liveliest part of a clip, catch frozen or slideshow-like footage, tell a camera pan from real action, time cuts to movement                                   | M      | Low      | Yes                                                       |
| Saliency (attention and objectness)       | Keep captions, verdict cards and ranked-item graphics off the important part of the picture. Score thumbnails on whether the eye lands on one clear subject                                       | S      | Very low | Yes                                                       |
| Face detection and face capture quality   | Pick the sharpest, best-lit character face for thumbnails. Keep faces out from under captions                                                                                                     | S      | Very low | Yes. Works on realistic characters, weak on stylised ones |
| Body and hand pose                        | Find action poses (aiming, running, jumping) for thumbnail frames and hook shots                                                                                                                  | M      | Low      | Yes. Unproven on game characters                          |
| Trajectory detection                      | Ball flights in sports games for highlight picking                                                                                                                                                | M      | Low      | Yes. Narrow use, ranked last                              |
| Rectangle and document detection          | Crop tweets, store pages and article screenshots cleanly. Find HUD boxes and minimaps to crop around                                                                                              | S      | Very low | Yes                                                       |
| Horizon detection                         | Level a tilted capture. Little use for game footage                                                                                                                                               | S      | Very low | Yes. Skip                                                 |
| Animal, barcode, contour requests         | No use found                                                                                                                                                                                      | -      | -        | -                                                         |

### VisionKit

Live Text, Visual Look Up and subject lifting in VisionKit are the same engines as Vision, wrapped for apps with a window. Nothing extra for a headless factory.

### Core ML and the Neural Engine

| Feature                                                                                   | Use for Pulse                                                                                                                                                                                 | Effort | RAM risk                                                       | Free and licence-safe                                                                                  |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Text and image embeddings in one space (SigLIP or OpenCLIP, converted for MLX or Core ML) | Search the scene index by meaning: each narration sentence finds its closest shot. This goes straight at the "visuals do not match the narration" scores of 0.74 to 1.22 out of 3 from 29 Oct | M      | Low to medium (about 0.5 to 1 GB, loaded only between renders) | Yes with SigLIP or OpenCLIP (Apache 2.0, MIT). Not Apple's MobileCLIP, whose weights are research-only |
| Image upscaling (Real-ESRGAN, BSD licence)                                                | Sharpen low-resolution art and screenshots for old and retro titles before they are zoomed                                                                                                    | M      | Medium                                                         | Yes                                                                                                    |
| Depth                                                                                     | Already used for parallax                                                                                                                                                                     | -      | -                                                              | -                                                                                                      |
| Background removal                                                                        | Covered by Vision subject lift                                                                                                                                                                | -      | -                                                              | -                                                                                                      |
| Captioning                                                                                | Covered by the MLX picture checker                                                                                                                                                            | -      | -                                                              | -                                                                                                      |

### MLX

| Feature                                                                                                      | Use for Pulse                                                                                                                                                                                               | Effort | RAM risk                                                       | Free and licence-safe                                             |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------- | ----------------------------------------------------------------- |
| Small local text model (the same Qwen 4B the picture checker loads, or llama.cpp which is already installed) | Cheap yes or no checks that now cost Claude tokens: writer notes left in a script, em dashes, ordinals written as words, numbers not rounded, banned words, a hook over 10 words. A checker, never a writer | M      | Medium (about 3 GB, must take a turn through the orchestrator) | Yes (Apache 2.0)                                                  |
| Local narration (Kokoro through mlx-audio, already installed)                                                | A free scratch voice for sandbox and timing runs, so tests stop spending ElevenLabs credits. The channel voice stays as it is                                                                               | S      | Low (under 1 GB)                                               | Yes (Apache 2.0). Never published                                 |
| Image generation (FLUX.1 schnell)                                                                            | Could run, but slowly, and it takes most of the 16 GB. The PC's RTX 4090 already does this far better                                                                                                       | -      | High                                                           | schnell is Apache 2.0. FLUX dev is non-commercial. Not on the Mac |
| Bigger local models                                                                                          | Do not fit beside renders on 16 GB                                                                                                                                                                          | -      | High                                                           | Skip                                                              |

### Speech

The on-device recogniser in macOS 15 is weaker than the MLX Whisper already in use. The much better SpeechAnalyzer arrives with macOS 26. No change until then.

### Sound Analysis custom classifiers

The built-in 300-sound classifier is in progress. A custom classifier trained with Create ML (free, part of macOS) on Pulse's own rejected voice takes could flag garbled narration, clicks and odd breaths before the Whisper check. Effort M, RAM risk very low, free. It needs a few hundred labelled clips first, so it ranks below the top 10.

The built-in "music" tag also gives a free copyright warning on the owner's own GTA footage (radio songs lead to claims). ShazamKit could name the song, but matching against Shazam's catalogue needs a paid Apple developer account, so it is not counted as free.

### Natural Language

| Feature                                 | Use for Pulse                                                                                                                                                                                              | Effort | RAM risk | Free and licence-safe |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------- | --------------------- |
| Sentence embeddings                     | Group articles about the same story, spot a story already covered, measure how big a story is across outlets (the newsroom miss of 4 Nov), and catch a new hook or title that is too close to a recent one | M      | Very low | Yes                   |
| Named entity and part-of-speech tagging | Pull game, studio and people names out of headlines for free. Check a script names its game early                                                                                                          | S      | Very low | Yes                   |
| Language ID and sentiment               | Sort comments by language and mood for the engagement loop and the Spanish twin                                                                                                                            | S      | Very low | Yes                   |

### Foundation Models

Not on this Mac. It needs macOS 26 with Apple Intelligence switched on. See section 5.

### AVFoundation and Core Audio

| Feature                                  | Use for Pulse                                                                                                                                                               | Effort | RAM risk | Free and licence-safe |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------- | --------------------- |
| Apple's AAC encoder (`aac_at` in ffmpeg) | Better sound than ffmpeg's own AAC at the same bitrate, one flag                                                                                                            | S      | None     | Yes                   |
| Sound isolation audio unit               | Split voice from background offline: lift a clean quote out of a trailer, or drop voice chat from the owner's recordings. The PC's Demucs does this better but needs the PC | M      | Low      | Yes                   |
| Loudness                                 | Already measured with `ebur128` and `loudnorm`                                                                                                                              | -      | -        | -                     |
| Spatial audio (PHASE)                    | YouTube Shorts play in stereo. No gain                                                                                                                                      | -      | -        | Skip                  |

### Core Image and Metal

ffmpeg-full has a `coreimage` filter and libplacebo, both on the GPU. Use: one consistent Pulse grade per series (a LUT, gentle sharpening, vignette) applied to footage during preparation instead of in Chrome, which also takes work out of the render. Effort M, RAM risk low, free. MetalFX upscaling needs a custom Metal program, so the Real-ESRGAN route above is simpler.

### VideoToolbox and ProRes

| Feature                                                            | Use for Pulse                                                                                                                                                    | Effort | RAM risk                                               | Free and licence-safe     |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------ | ------------------------- |
| Hardware decode and `scale_vt`                                     | Faster footage preparation, black-flash scans and scene indexing                                                                                                 | S      | Low                                                    | Yes                       |
| All-intra proxies (ProRes Proxy or all-keyframe H.264 by hardware) | Remotion seeks through long-GOP downloads slowly. Clips where every frame is a keyframe seek instantly, which should cut render time and frame-extraction memory | M      | Low (more disk: keep proxies per job and delete after) | Yes                       |
| Hardware AV1 decode                                                | Let footage gathering take YouTube's AV1 streams, often the sharpest version of a trailer, without a CPU cost                                                    | S      | Low                                                    | Yes                       |
| VMAF (libvmaf in ffmpeg-full)                                      | A number for picture quality, so the hardware encoder's bitrate is set by measurement, and a release gate can fail a soft encode                                 | S      | Low                                                    | Yes                       |
| Frame interpolation and super resolution (VTFrameProcessor)        | Smooth slow motion and sharper upscales, by the media engine                                                                                                     | M      | Low                                                    | Needs macOS 15.4 or later |

### ScreenCaptureKit

Could record a real web page scrolling (a store page, a patch note, a post) as proof footage. It needs a one-time screen recording permission click on the Mac mini and an awake display, and headless Chrome inside Remotion can already capture pages. Effort M, ranked low.

### Metal-accelerated Remotion

Already on (`angle`, concurrency 6). What is left is tuning: `mac/gpubisect.mts` exists, and concurrency 6 on 16 GB with swap already in use deserves a measured run at 4, 5 and 6 once proxies are in.

### Shortcuts, launchd and scheduling

- launchd already runs the services. The new idea is a background lane: run analysis jobs (indexing, embeddings, feature prints) as low-priority background tasks (`taskpolicy -b`, or a launchd `ProcessType` of Background). macOS then keeps them on the 6 efficiency cores and they cannot slow a render on the 4 fast cores.
- Shortcuts gives nothing a script cannot on macOS 15. On macOS 26 its "Use Model" action reaches Apple's models from the command line.

### Spotlight and on-device indexing

- During measurement Spotlight's indexer was using 28% of a core while a job ran. Render scratch, job folders and `node_modules` should be excluded from Spotlight so it never competes with renders. Effort S, no risk.
- The scene index could also write Finder tags and keywords on footage files so `mdfind` finds "GTA VI, night, car chase" instantly. Useful only if people browse the library by hand, so ranked low.

### Other things found

- GarageBand's Apple Loops and sound library are royalty-free inside your own videos (not for resale as loops). A source of stings and beds for the soundscape. Needs a one-time sound library download click in GarageBand on the Mac mini. Low priority while soundscape v3 is working.
- Translation framework: tied to an app window on macOS 15, and weaker than Claude for the 5-language titles. Skip.
- SensitiveContentAnalysis: an on-device nudity check for monetisation safety, but it needs a paid developer entitlement. The picture checker covers it.
- `say`: an instant zero-install scratch voice if Kokoro is not wanted.
- iMovie, Keynote, Numbers, Pages: no use for an automated factory.

## 4. Ranked list

Scores are gain, confidence and cost, each 1 to 5 (cost 1 is cheapest).

| #   | Build                                                                                                | Why                                                                                            | Build                                                                                                                                               | Measure                                                                                               | G   | Conf | Cost |
| --- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --- | ---- | ---- |
| 1   | Sentence-to-shot search                                                                              | The biggest known picture fault is shots that do not match the words                           | Embed scene index keyframes and each narration sentence with SigLIP on MLX; pick the nearest shot, picture checker confirms                         | Re-run the 29 Oct visual forensics score on 10 videos before and after; target 2.0 out of 3 or better | 5   | 3    | 3    |
| 2   | Wrong-game and repeat-shot guard                                                                     | Open fault from the 5 Nov director review; a wrong-game picture is the most embarrassing error | Vision feature prints for every chosen frame against the game's reference frames, plus a near-duplicate check within a video                        | Wrong-game pictures per 20 videos by hand audit, target zero; repeated shots per video                | 4   | 4    | 2    |
| 3   | Motion score                                                                                         | Shorts live on pace; static footage loses viewers in the first seconds                         | Optical flow per second of each clip, stored in the scene index; clip picker prefers lively seconds, a gate rejects frozen stretches                | Share of clips under the motion floor; first-3-second hold and average viewed % on Shorts             | 4   | 3    | 3    |
| 4   | Faster renders with proxies                                                                          | Render slots are the factory's bottleneck on one shared 16 GB Mac                              | Hardware-decoded, all-intra proxies made at footage preparation; allow AV1 sources; then re-tune concurrency                                        | Render minutes per Short and per long video, peak memory and swap, same output checks                 | 3   | 4    | 2    |
| 5   | Background lane and Spotlight exclusions                                                             | Free reliability: analysis never competes with a render                                        | Run index jobs as background tasks on efficiency cores; exclude scratch folders from Spotlight                                                      | Render time with and without an index job running; failed or slow renders per week                    | 3   | 4    | 1    |
| 6   | Story grouping and repeat guard                                                                      | Fewer missed big stories and fewer near-duplicate Shorts, with no model bill                   | Natural Language sentence embeddings over headlines; cluster size feeds the story size score; hooks and titles compared with the last 30 days       | Daily miss report count; duplicate topics per week; Claude spend on clustering                        | 3   | 3    | 2    |
| 7   | Free scratch narration                                                                               | Tests were half of one week's API bill                                                         | Kokoro through mlx-audio for sandbox and timing runs, clearly marked, never released                                                                | ElevenLabs credits spent on tests per week, target near zero                                          | 3   | 4    | 2    |
| 8   | Local text checker                                                                                   | Moves cheap rule checks off Claude and catches faults like the narrated writer notes           | Qwen 4B (already on the Mac) answers fixed yes or no questions on each script, taking a turn through the orchestrator                               | Faults caught against a set of 50 known bad scripts; Claude tokens saved per day; false alarms        | 3   | 3    | 2    |
| 9   | Encode quality gate and Apple audio                                                                  | Makes the hardware encoder safe to switch on, and sound slightly better for free               | VMAF of each hardware encode against the master with a floor (93); `aac_at` for audio                                                               | VMAF spread, file size, encode seconds against libx264                                                | 2   | 4    | 1    |
| 10  | macOS update path                                                                                    | Free unlock of Apple's own text model, a better speech engine and media engine frame tools     | After the GTA VI Part 2 on 21 Nov: back up, update to the latest macOS 15, test, then macOS 26 with a rollback plan. One owner step on the Mac mini | Factory tests pass after each step; then trial Foundation Models against item 8                       | 3   | 3    | 2    |
| 11  | Caption-safe placement and thumbnail saliency                                                        | Graphics that cover the subject look amateur                                                   | Vision saliency map per shot moves captions and cards; thumbnail gate on one clear subject                                                          | Share of frames with text over the salient area; thumbnail click-through                              | 3   | 3    | 2    |
| 12  | Music warning on own footage                                                                         | Avoids copyright claims on the owner's GTA streams                                             | Sound Analysis music tag over gameplay segments; duck, swap or skip                                                                                 | Claims per month                                                                                      | 3   | 3    | 2    |
| 13  | Thumbnail face and pose picker                                                                       | Faces lift click-through                                                                       | Face quality and pose over candidate frames                                                                                                         | Thumbnail A/B click-through                                                                           | 3   | 2    | 2    |
| 14  | Free frame tags                                                                                      | Cuts paid picture checks                                                                       | Vision classification on keyframes as a pre-filter                                                                                                  | Picture-check calls per video                                                                         | 2   | 3    | 1    |
| 15  | Upscale old art                                                                                      | Old and retro titles look soft when zoomed                                                     | Real-ESRGAN on stills under a size floor                                                                                                            | Sharpness score; picture checker verdicts                                                             | 2   | 3    | 3    |
| 16  | Series grade on the GPU                                                                              | A consistent look per series                                                                   | Core Image or libplacebo LUT at footage preparation                                                                                                 | Aesthetics score; render time                                                                         | 2   | 3    | 3    |
| 17  | Voice fault classifier                                                                               | Catches garbled takes before Whisper                                                           | Create ML sound classifier trained on rejected takes                                                                                                | Faults caught, false alarms                                                                           | 2   | 2    | 3    |
| 18  | Sound isolation                                                                                      | Clean quotes from trailers without the PC                                                      | Offline audio unit render                                                                                                                           | Listening test, word error rate                                                                       | 2   | 2    | 3    |
| 19  | Page recordings                                                                                      | Proof shots of real pages                                                                      | ScreenCaptureKit or headless Chrome                                                                                                                 | Use count, retention on those beats                                                                   | 2   | 2    | 3    |
| 20  | GarageBand loops, Finder tags, Shortcuts, trajectories, horizon, PHASE, Translation, FLUX on the Mac | Little or no gain here                                                                         | -                                                                                                                                                   | -                                                                                                     | 1   | 2    | 3    |

## 5. What a macOS update would unlock

The Mac is on macOS 15.0. Updates are free.

| Version         | Unlocks                                                                                                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Latest macOS 15 | Media engine frame interpolation and super resolution (15.4), Apple Intelligence writing tools in UK English (15.2), bug fixes                                                               |
| macOS 26        | Foundation Models (Apple's on-device text model, callable from Swift, no bill), SpeechAnalyzer (faster, better transcription), Vision document recognition, the Shortcuts "Use Model" action |

Risk: an update on the live factory machine, and Apple Intelligence keeps a model in memory, which matters on 16 GB. Do it only after the GTA VI Part 2 on 21 Nov, with the nightly backup checked first and `mac/rollback.sh` ready. This is an owner step on the Mac mini (one click in System Settings, then about 40 minutes).

## 6. Rules for anything built from this plan

- One model in memory at a time on the Mac, taken through the orchestrator (`~/orch/macrun.sh` on the Mac). Unload after use.
- Apple framework jobs (Vision, Natural Language, Sound Analysis) run as background tasks on the efficiency cores.
- Every new step ships switched off behind a setting, with a before and after measurement, like the `claude/appletools` branch.
- Keep 40 GB free (`MAC_MIN_FREE_GB`). Proxies and embeddings are deleted or capped per job.
- No model with a research-only or non-commercial licence (MobileCLIP weights, FLUX dev).
- Local models check and search. They do not write published words without a shown before and after.

## 7. Top 10 to build first

1. Sentence-to-shot search (text and image embeddings over the scene index).
2. Wrong-game and repeat-shot guard (Vision feature prints).
3. Motion score from optical flow for clip picking and a frozen-footage gate.
4. All-intra hardware proxies, AV1 sources and a concurrency re-tune for faster renders.
5. Background lane on the efficiency cores and Spotlight exclusions.
6. Story grouping and repeat guard with Natural Language embeddings.
7. Free scratch narration for test runs (Kokoro on MLX).
8. Local text checker for cheap script rules (Qwen 4B on MLX).
9. VMAF quality gate and Apple AAC for hardware encodes.
10. macOS update path after 21 Nov to unlock Foundation Models and the newer speech and media tools.

These ten are in the backlog in `C:\Claude\analytics\pulse\experiments.json` with the source "scout: Mac technology plan".
