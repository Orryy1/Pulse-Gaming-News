# Pulse factory

Makes one premium gaming-news Short a day on this PC and publishes it to YouTube. There are no cloud servers to pay for: it runs in the background, starts at log-on and restarts itself.

```
RSS (official newsrooms + outlets)
  → cluster + score + corroborate       (official source, or two independent outlets)
  → Claude picks the story, writes the script, then fact-checks it against the articles
  → narration: the Codex "Liam" voice on this PC (tts_server, VoxCPM 2, port 8765)
               ElevenLabs only as a fallback, and only if the month's credits cover it
  → voice polish (highpass, compression, limiter; the Codex mix chain)
  → official Steam store art / first-party press images, with provenance stored
  → Remotion render 1080×1920: motion graphics, word-by-word captions, owned music bed and SFX
  → loudness −14 LUFS → ffprobe QA → Claude vision QA on sampled frames
  → Discord: poster + preview, auto-publishes after 60 min unless rejected
  → YouTube resumable upload that never posts the same episode twice
```

## Install (once)

Double-click **`factory\INSTALL.cmd`**. It:

1. installs Node.js if it's missing, plus the factory's dependencies and render browser;
2. reuses what Codex already set up on this PC: your API keys, Discord webhook, the YouTube login in `tokens\` and the Liam voice server in `tts_server\`. It searches `D:\pulse-runtime\pulse-production`, `C:\Pulse\runtime\pulse-v1`, `%USERPROFILE%\gaming-studio\pulse-gaming` and the Codex worktrees, and only asks for anything it can't find;
3. asks whether to go live or do a safe dry run first;
4. registers a hidden **Pulse Factory** task that starts at log-on and keeps it running, then opens the dashboard.

Re-run `INSTALL.cmd` any time to update. Run `windows\uninstall.ps1` to stop and remove it. Your settings stay in `factory\.env` and your data in `factory\data\`.

**Keep the old Codex publisher tasks disabled** (`PulseGaming-LiveWatchdog-Supervisor`, `PulseGaming-LiveGuarded-YouTube-Runtime`, `PulseGaming-GrowthAutopilot`), so only one system posts to the channel.

## Voice

| `VOICE_PROVIDER` | Behaviour |
|---|---|
| `auto` (default) | The local Liam voice. If its server is down and can't be started, it falls back to ElevenLabs, but only when the plan has enough characters left. |
| `local` | Local voice only; never spends ElevenLabs credits. |
| `elevenlabs` | ElevenLabs only. |

If the voice server isn't running, the factory starts it with `LOCAL_TTS_START` (the Codex `tts_server\start.bat`) and waits for it to load, which takes 2–5 minutes cold. Long scripts are split into takes of at most 36 words, because VoxCPM is unstable on longer takes under Windows CUDA. The takes are stitched with exact word timings for the captions. Use `LOCAL_TTS_SPEAKING_RATE` to change the pace (1.0 by default; Codex's proven slower read was 0.85).

Videos are uploaded with YouTube's "altered or synthetic content" disclosure switched on (`SYNTHETIC_MEDIA_DISCLOSURE=true`), because the narrator is a cloned voice. Codex did the same. YouTube says the label does not affect reach or monetisation.

## Approval

| `APPROVAL_MODE` | Behaviour |
|---|---|
| `timeout` (default) | Posts to Discord and publishes after `APPROVAL_TIMEOUT_MINUTES` unless rejected. Rumours always wait for a human. |
| `manual` | Waits for Approve. |
| `auto` | Publishes as soon as QA passes. |

The Approve and Reject links point at `PUBLIC_URL`. On `http://localhost:8080` they only work on this PC. To tap them from your phone, set `PUBLIC_URL` to the Cloudflare tunnel Codex used (`pulse.orryy.com`, pointed at port 8080). `windows\install-tunnel.ps1` registers a hidden "Pulse Tunnel" start-up task that keeps that tunnel running.

## Operating it

- **Dashboard:** `http://localhost:8080/episodes?key=<ADMIN_TOKEN from .env>`
- **Force a run:** `POST http://localhost:8080/tick?key=<ADMIN_TOKEN>`
- **Logs:** `factory\data\logs\`
- **CLI** (while the factory is stopped): `npm run cli -- episodes | discover | retry <id>`
- **Alerts:** Discord gets failures, `invalid_grant` (reconnect YouTube at `/oauth/start?key=<ADMIN_TOKEN>`), and a warning if nothing has published in 26 hours.

## Costs

The only running cost is Claude (selection, script, fact-check and vision QA): a few dollars a month at one Short a day. Voice, rendering, database and hosting all run on the PC. ElevenLabs is used only if the local voice is unavailable.

## Rules the code enforces

- A story needs an official source or two independent outlets. Anything else is a rumour: off by default, always labelled and never auto-approved.
- A failed fact-check gets one rewrite. A second failure drops the story before any narration is made.
- House style is checked in code: British spelling, no serial comma, banned openers and calls to action, 70–115 words.
- Visuals are original motion graphics plus publisher-supplied store art and first-party press images, each stored with its source. No outlet photos, no footage and nothing leaked.
- Uploads save the resumable session first and tag the video privately. After any ambiguous failure, the next attempt finds the existing upload instead of posting again.

## Development

```
npm ci && npm run typecheck && npm test
npm run studio      # Remotion Studio, to iterate on the look
```

Brand files are in `public/`. The logo, music beds (`audio/mastered/`) and SFX (synthesised by `tools/build-sfx-library.js`) come from the main repo. The fonts are Anton and Inter under the OFL.
