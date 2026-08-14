---
format: 1080x1920
duration: 51s
message: "Responsiveness depends on waiting across the render path, not only FPS"
arc: concept-explainer
audience: "players curious about input latency"
mode: autonomous
music: "restrained minimal electronic pulse, analytical rather than ominous, no vocals"
captions: true
series: "SYSTEM TRACE"
episode: "07"
---

## Video direction

The visual metaphor is a timestamped parcel route. Amber is the newest input,
cyan is completed work and dim orange is older queued work. Every frame card
keeps its original timestamp visible so the difference between throughput and
freshness is always legible.

## Frame 1 - Fast but behind

- scene: A 144 FPS counter races while a newly pressed input pulse waits behind older timestamped frames.
- voiceover: "A high frame rate can still feel behind your hands. The missing number is how long your newest input waits before reaching the screen."
- duration: 8.427s
- poster: 5.9s
- transition_in: cut
- status: animated
- src: compositions/frames/01-fast-but-behind.html
- type: hook
- persuasion: Counterintuitive contrast
- beat: Surprise + curiosity
- blueprint: kinetic-type-beats (Adapt)
- focal: HIGH FPS replacing FRESH INPUT? above one visibly waiting input pulse
- roles: input pulse and queue = foreground subjects - FPS counter = supporting - timing grid = background
- sfx: impact-bass-1, glitch-1

Adapt: keep the fast counter running while the central claim swaps to expose the hidden waiting time.

Scene 1 (0.0-2.7s): 144 FPS counts rapidly in cyan over a clean dark field.

Scene 2 (2.7-5.7s): A bright INPUT NOW pulse enters a queue behind three older frame cards.

Scene 3 (5.7-8.6s): HIGH FPS swaps to FRESH FRAME? while a LATENCY clock continues ticking.

narrativeRole: Separates throughput from the age of the displayed response.
keyMessage: A fast frame rate does not alone reveal input-to-display delay.

## Frame 2 - Keep the GPU busy

- scene: CPU and GPU work lanes pass prepared frame cards through a short queue to maintain continuous GPU activity.
- voiceover: "The CPU prepares rendering work and the GPU executes it. A system may queue frames ahead to keep the GPU busy."
- duration: 8.832s
- poster: 6.0s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/02-cpu-gpu-queue.html
- type: product_intro
- persuasion: System map
- beat: Orientation + clarity
- blueprint: spatial-pan-stations (Adapt)
- focal: CPU PREP to FRAME QUEUE to GPU EXECUTE
- roles: three pipeline stations = foreground subject - frame cards = foreground mechanism - utilisation meter = supporting - dark rails = background
- sfx: click-soft, whoosh-short

Adapt: pan through the three processing stations while one frame card keeps its timestamp.

Scene 1 (0.0-2.7s): CPU PREP creates FRAME A and stamps it T-2.

Scene 2 (2.7-5.6s): FRAME A joins B and C in a short FRAME QUEUE.

Scene 3 (5.6-8.4s): GPU EXECUTE consumes cards continuously and BUSY / 99% holds.

narrativeRole: Shows why queued work can improve GPU utilisation.
keyMessage: Prepared frames may wait so the GPU always has work available.

## Frame 3 - Fresh input waits

- scene: A new input packet enters behind three old frame cards while their age clocks increase despite high throughput.
- voiceover: "An input sampled now can sit behind older prepared frames. The counter stays high, while the response arrives later."
- duration: 7.979s
- poster: 5.5s
- transition_in: crossfade
- status: animated
- src: compositions/frames/03-input-waits.html
- type: feature_showcase
- persuasion: Animated causal proof
- beat: Tension + understanding
- blueprint: fixed-anchor-cycle (Adapt)
- focal: INPUT NOW remaining behind OLD WORK in the fixed queue
- roles: input packet = foreground subject - queued frame cards = foreground obstacle - FPS and age meters = supporting - pipeline rail = background
- sfx: click, whoosh

Adapt: pin the queue and cycle completion while the newest input retains a visible waiting clock.

Scene 1 (0.0-2.4s): INPUT NOW arrives behind FRAME T-3, T-2 and T-1.

Scene 2 (2.4-5.1s): The GPU completes one frame at a time. FPS remains high while INPUT AGE rises.

Scene 3 (5.1-7.6s): The new input finally reaches execution and COUNTER FAST / RESPONSE LATE holds.

narrativeRole: Connects queue depth directly to response age.
keyMessage: New input can wait behind already prepared frames.

## Frame 4 - Reduce the queue

- scene: A deep queue contracts as CPU pacing follows GPU capacity, with a separate frame-cap limiter preventing overproduction.
- voiceover: "Latency controls reduce that wait by matching CPU work more closely to GPU capacity. A sensible frame cap can also prevent a deep queue."
- duration: 11.008s
- poster: 6.6s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/04-reduce-queue.html
- type: feature_showcase
- persuasion: Before-and-after mechanism
- beat: Relief + clarity
- blueprint: comparison-split (Adapt)
- focal: DEEP QUEUE versus PACED QUEUE with lower input age
- roles: queue comparisons = foreground proof - CPU/GPU clocks = supporting - input-age meter = foreground payoff - dark grid = background
- sfx: click-soft, notification

Adapt: stack uncontrolled and paced pipelines vertically, preserving the same GPU capacity.

Scene 1 (0.0-3.0s): UNPACED shows four prepared frames and a rising input-age meter.

Scene 2 (3.0-6.3s): PACED synchronises CPU release to GPU completion and contracts the queue to one.

Scene 3 (6.3-9.2s): A FRAME CAP limiter prevents another card entering early. LESS WAITING holds.

narrativeRole: Shows how pacing can reduce queue-based latency.
keyMessage: Matching production to consumption can keep work fresher.

## Frame 5 - The bottleneck matters

- scene: GPU-BOUND, CPU-BOUND and DISPLAY-BOUND paths compare how much queue control changes total latency.
- voiceover: "The result depends on the bottleneck. If the game is not GPU-bound, or another stage dominates, the same change may help less."
- duration: 8.789s
- poster: 6.4s
- transition_in: crossfade
- status: animated
- src: compositions/frames/05-bottleneck.html
- type: social_proof
- persuasion: Honest qualification
- beat: Nuance + confidence
- blueprint: dataviz-countup (Adapt)
- focal: three latency bars with different dominant stages
- roles: stage bars = foreground proof - bottleneck labels = supporting - total-latency ruler = foreground comparison - lab grid = background
- sfx: glitch-2, impact-bass-1

Adapt: use three compact path instruments and change only the dominant segment.

Scene 1 (0.0-2.8s): GPU-BOUND shows a long queue/GPU segment and a strong queue-control reduction.

Scene 2 (2.8-5.9s): CPU-BOUND shifts the longest segment to simulation, producing a smaller reduction.

Scene 3 (5.9-8.8s): DISPLAY-BOUND retains a long scan segment. BOTTLENECK DECIDES holds.

narrativeRole: Prevents one latency technique from sounding universally transformative.
keyMessage: The dominant stage determines how much queue reduction can help.

## Frame 6 - The freshest frame

- scene: INPUT, SIMULATION, QUEUE, GPU and DISPLAY contract into one timestamped end-to-end path and a final rule card.
- voiceover: "Judge the whole path: input, simulation, render queue, GPU and display. The fastest counter is not automatically the freshest frame."
- duration: 9.515s
- poster: 6.3s
- transition_in: blur-crossfade
- status: animated
- src: compositions/frames/06-freshest-frame.html
- type: branding
- persuasion: Distillation + callback
- beat: Resolve + memorability
- blueprint: titlecard-reveal (Adapt)
- focal: MEASURE THE PATH / NOT JUST THE COUNTER
- roles: final rule card = foreground subject - five-stage latency path = supporting - SYSTEM TRACE marker = background
- sfx: notification, chime

Adapt: reveal the complete path once, then collapse it into the final freshness rule.

Scene 1 (0.0-3.0s): INPUT to SIM to QUEUE to GPU to DISPLAY lights in sequence.

Scene 2 (3.0-6.3s): A total clock spans the path while the FPS counter remains separate.

Scene 3 (6.3-8.6s): MEASURE THE PATH / NOT JUST THE COUNTER holds with SYSTEM TRACE // 07.

narrativeRole: Ends with the full latency path and the counter-versus-freshness distinction.
keyMessage: Responsiveness is an end-to-end timing problem.
