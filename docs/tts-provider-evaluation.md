# Local TTS Provider Evaluation

Date: 2026-05-01

## Current State

Pulse now has `TTS_PROVIDER=local` and `LOCAL_TTS_URL=http://127.0.0.1:8765`
in `.env`. The current local server is `tts_server/`, which exposes an
ElevenLabs-compatible endpoint:

`POST /v1/text-to-speech/{voice_id}/with-timestamps`

It returns:

- MP3 audio as base64
- character-level timestamps in the shape expected by `audio.js`

The local server currently uses VoxCPM 2 for synthesis and a forced-aligner for
timestamps. A smoke render through `audio.js.generateTTS()` succeeded and wrote
to `D:/pulse-data/media/output/audio/__local_tts_smoke.mp3`.

## What Whisper Is

Whisper is not a narrator/TTS engine. It is ASR: speech recognition,
transcription, language identification and translation. WhisperX is the useful
adjacent tool for us because it adds word-level forced alignment.

Decision: treat Whisper/WhisperX as timestamp/subtitle infrastructure, not as a
candidate voice generator.

## Commercial Viability Filter

For Pulse Gaming we should prefer models with clear commercial rights, because
the whole point of the local stack is to run media-house production without
future licensing surprises.

Hard filter:

- Local/on-prem capable
- voice cloning or controllable voice identity
- usable on RTX 4090
- permissive or commercially usable licence
- can be wrapped behind the existing ElevenLabs-compatible local endpoint
- compatible with forced alignment for karaoke subtitles

## Shortlist

### 1. VoxCPM 2

Status: currently installed and working.

Why it stays in the benchmark:

- Apache-2.0, commercial-ready
- 30 languages
- 48 kHz output
- voice design, controllable cloning and transcript-based high-fidelity cloning
- official benchmark claims around 0.30 RTF on RTX 4090
- already integrated with the Pulse local endpoint

Risks:

- Occasional long-input instability is documented upstream
- current output quality still needs side-by-side testing against newer options
- first model load is slow enough that the server must stay warm

### 2. Chatterbox / Chatterbox Turbo

Status: strongest immediate challenger.

Why it is attractive:

- MIT licence
- active Resemble AI project
- Turbo is designed for lower compute and fast inference
- voice cloning from a reference clip
- creative controls, including emotion/exaggeration and paralinguistic tags
- multilingual model is available for broader channel expansion
- built-in watermarking is a plus for provenance

Risks:

- Need to verify Windows + CUDA stability locally
- Need to confirm whether Turbo, standard or multilingual sounds best for news
  narration specifically
- Needs a local wrapper matching our `/with-timestamps` contract

### 3. Dia

Status: useful for dialogue, less obvious for single-presenter news.

Why it is attractive:

- Apache-2.0
- tested by upstream on RTX 4090
- strong at dialogue, non-verbal tags and multi-speaker scenes
- voice cloning with short prompts

Risks:

- Designed around `[S1]`/`[S2]` dialogue, not necessarily tight single-narrator
  shorts
- Voice consistency requires prompt discipline or fixed seeds
- Better suited to future character/react/podcast formats than baseline news
  narration

### 4. Kokoro

Status: excellent fallback, not the main Pulse voice.

Why it is attractive:

- Apache-2.0
- tiny 82M model
- very fast and cheap to run
- good emergency fallback if bigger models fail

Risks:

- No true zero-shot voice cloning in the same sense as VoxCPM/Chatterbox/Dia
- Less suited to keeping a distinctive Pulse presenter identity

## Benchmarks Only / Avoid For Production

### Fish Speech S2

Quality looks highly competitive, especially for emotion and inline control, but
the current Fish Audio Research License requires a separate written licence for
commercial use. That makes it unsuitable for production Pulse unless we obtain
commercial terms. It can be benchmarked for quality only if we keep the outputs
out of public monetised channels.

### F5-TTS

Good model family and fast inference, but the official repo states that the
pre-trained models are CC-BY-NC because of training data. That makes it a poor
fit for monetised Pulse output.

### Coqui XTTS-v2

Still useful as a known baseline, but it uses the Coqui Public Model License and
is older than the current leading local options. I would not make it the 2026
Pulse default unless it wins clearly in listening tests and we explicitly accept
the licence.

## Recommended Test

Do not pick by repo stars or demo clips. Pick by rendering the same Pulse script
through each candidate and scoring the actual output.

Test script:

1. Use one short Pulse Gaming sample with hard words:
   `Pokemon/Pokémon`, `GTA 6`, `Take-Two`, `Nintendo`, `PlayStation Plus`.
2. Use one full 60-second current story.
3. Generate each sample through:
   - VoxCPM 2 current server
   - Chatterbox Turbo
   - Chatterbox standard or multilingual if Turbo feels too voice-agent-like
   - Dia
   - Kokoro fallback
4. Force-align with the same local aligner/WhisperX-style path so subtitles are
   compared fairly.
5. Score:
   - narrator identity consistency
   - pronunciation accuracy
   - pace for Shorts
   - emotional control without sounding fake
   - subtitle alignment quality
   - render time / RTF
   - GPU memory footprint
   - crash/retry rate
   - commercial licence status

## Recommendation

Keep VoxCPM 2 as the production-safe local default today because it is already
working, commercially clean and integrated. Build the next iteration as an A/B
test harness, then test Chatterbox Turbo first. If Chatterbox wins the listening
test and stays stable on this Windows/RTX 4090 setup, promote it behind the same
`TTS_PROVIDER=local` interface as `LOCAL_TTS_ENGINE=chatterbox`.

Do not use Fish Speech for monetised Pulse output unless commercial licensing is
resolved. Do not treat Whisper as a voice engine; use it for transcription and
alignment.
