# Local TTS Server (VoxCPM 2 + WhisperX)

Drop-in replacement for ElevenLabs `with-timestamps`. Returns MP3 + character-level alignment in the exact JSON shape `audio.js` expects, so swapping providers is a one-env-var change.

## Why

- **Free**: zero per-character API cost
- **Private**: scripts never leave your machine
- **Offline-capable**: once weights are downloaded, no internet needed
- **48 kHz studio audio** (VoxCPM 2 native), downsampled to 44.1 kHz MP3 for the pipeline

## Hardware

- NVIDIA RTX 4090 (24 GB VRAM) - target spec
- Any modern CUDA GPU with 16+ GB VRAM should work
- ~10 GB disk for model weights

## Setup (one-time, ~10 min)

1. Install [Python 3.10 or 3.11](https://www.python.org/downloads/) - tick "Add to PATH"
2. Install [ffmpeg](https://www.gyan.dev/ffmpeg/builds/) and add `bin` to PATH
3. Make sure NVIDIA drivers are current (`nvidia-smi` should work)
4. Run setup:
   ```cmd
   cd tts_server
   setup.bat
   ```
5. Copy `.env.example` to `.env` and configure your voice (see Voice Setup below)

## Voice Setup

VoxCPM 2 has two modes. **Do NOT use audio of an ElevenLabs stock voice as your reference clip - that is a ToS violation.**

### Option A: Default voice (no setup)

Leave `REF_VOICE_PATH` empty. VoxCPM 2 picks a generic voice on each session — surprisingly listenable, fine for getting started but it changes between server restarts so videos won't have a consistent presenter.

### Option B: Governed reference cloning (recommended for production)

1. Record 6-30 seconds of yourself reading clearly, or use a voice for which
   you hold explicit cloning and commercial-use rights.
2. Keep the WAV in a private data directory outside the Git checkout.
3. Set `VOICE_REFERENCE_DATA_ROOT` to that directory.
4. In `voices.json`, name only the relative `ref_voice_file`, its SHA-256,
   expected duration/sample-rate/channel probe and a cleared rights status plus
   evidence reference.

At boot and on every health probe the service resolves the file beneath the
configured root, rejects traversal/absolute paths, hashes it and probes the WAV.
A mapped voice cannot load unless the path, hash, probe and rights evidence all
pass. `ALLOW_UNCLEARED_VOICE_REFERENCE_FOR_LOCAL_QA=true` is available only for
private diagnostic listening and must remain false in autonomous production.
The audio itself must never be copied into Git.

Example registry fields:

```json
{
  "ref_voice_file": "pulse-owned-presenter.wav",
  "ref_voice_sha256": "<64 lowercase hex characters>",
  "ref_voice_probe": {
    "duration_seconds": 25,
    "duration_tolerance_seconds": 0.05,
    "sample_rate_hz": 16000,
    "channels": 1
  },
  "reference_rights_status": "OWNED",
  "reference_rights_evidence_reference": "rights-ledger:pulse-presenter-v1"
}
```

The model then clones the governed reference's timbre, prosody and delivery and
keeps that presenter identity consistent across generations.

### Pacing — BASE_SPEED

VoxCPM 2's default voice synthesizes at ~50 WPM (sleep-content slow). Pulse Gaming targets 130-140 WPM, so we apply a global speedup with a pitch-preserving phase vocoder.

```
BASE_SPEED=2.6   # default - lands at ~140 WPM for Pulse Gaming
BASE_SPEED=1.4   # ~70 WPM - Sleepy Stories style
BASE_SPEED=1.0   # native - ~50 WPM
```

Per-segment pacing from the pipeline (e.g. hook 1.05x, body 0.95x) is multiplied on top, so the audio.js dynamic-pacing logic still works as intended.

## Run

```cmd
cd tts_server
start.bat
```

Server binds to `http://127.0.0.1:8765`. Health check: open that URL + `/health` in a browser.

## Wire Into pulse-gaming

In `pulse-gaming/.env`:

```
TTS_PROVIDER=local
LOCAL_TTS_URL=http://127.0.0.1:8765
VOICE_REFERENCE_DATA_ROOT=D:\pulse-data\private\voice-references
```

That's it. `audio.js` will route to the local server. Set `TTS_PROVIDER=elevenlabs` (or unset) to revert.

## API

### `GET /health`

```json
{
  "status": "ok",
  "model_loaded": true,
  "aligner_loaded": true,
  "ref_voice": "./voices/main.wav",
  "voice_prompt": ""
}
```

### `POST /v1/text-to-speech/{voice_id}/with-timestamps`

Path mirror of ElevenLabs. `voice_id` is accepted but ignored.

Body:

```json
{
  "text": "Hello world.",
  "voice_settings": { "speaking_rate": 1.0 },
  "output_format": "mp3_44100_128"
}
```

Response:

```json
{
  "audio_base64": "...",
  "alignment": {
    "characters": ["H","e","l","l","o"," ","w","o","r","l","d","."],
    "character_start_times_seconds": [...],
    "character_end_times_seconds":   [...]
  }
}
```

## Performance

On RTX 4090, expect:

- VoxCPM 2 synth: ~0.3 RTF (60 s of audio in ~18 s)
- WhisperX align: ~5 s for a 60 s clip after warm-up
- First call after server start: +30-60 s for model load

For autonomous mode, leave the server running 24/7 - it idles at ~3 GB VRAM.

## Troubleshooting

- **CUDA out of memory**: drop to fp16 by editing `voxcpm_engine.py` to call `.half()` on the model
- **Slow first call**: warm the cache by curling `/health` once at startup, then making a 1-word synth call
- **Word mispronunciations**: edit `audio.js`'s `PHONETIC_MAP` (already has cache/segue/genre/etc) - applies before TTS
- **Subtitle drift**: align with the merged audio path `audio.js` already produces; do not re-align segments individually

## Architecture Notes

- `voxcpm_engine.py` - lazy-loads the 2B model on first request, single instance shared across requests
- `aligner.py` - WhisperX wav2vec2-CTC aligner; converts word-level -> char-level by proportional duration distribution
- `server.py` - FastAPI; matches ElevenLabs path + body + response shape exactly so `audio.js` needs only a base-URL swap

## Why WhisperX (not VoxCPM's own timing)

VoxCPM 2 doesn't expose internal token timings. We re-align the generated audio against the source text using forced alignment - same technique professional dubbing tools use. Accuracy is ~50-100 ms per word, which is well within subtitle tolerance (the karaoke subtitles in `assemble.js` already snap to word boundaries).
