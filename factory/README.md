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

If the voice server isn't running, the factory starts it with `LOCAL_TTS_START` (`windows\start-liam.bat`, which runs the Codex `tts_server\` from `PULSE_TTS_DIR` on the port in `LOCAL_TTS_URL`) and waits for it to load, which takes 2–5 minutes cold. On the production PC port 8765 belongs to the old governed VoxCPM service, which answers `/health` but not `/with-timestamps`, so `LOCAL_TTS_URL` is `http://127.0.0.1:8766`; the factory refuses a server that lacks the route instead of failing silently. Long scripts are split into takes of at most 36 words, because VoxCPM is unstable on longer takes under Windows CUDA. The takes are stitched with exact word timings for the captions. Use `LOCAL_TTS_SPEAKING_RATE` to change the pace (1.0 by default; Codex's proven slower read was 0.85).

Videos are uploaded with YouTube's "altered or synthetic content" disclosure switched on (`SYNTHETIC_MEDIA_DISCLOSURE=true`), because the narrator is a cloned voice. Codex did the same. YouTube says the label does not affect reach or monetisation.

`VOICE_PROVIDER=elevenlabs-first` uses the real ElevenLabs voice while the month's remaining characters cover the script and the local clone after that, so credits already paid for are used but never exceeded. Keep usage-based billing switched off in the ElevenLabs account; the factory never asks ElevenLabs to extend the limit. If the balance cannot be read (bad key), ElevenLabs is skipped rather than risked.

## Cadence

Two lanes feed one producer.

- **News** fills fixed daily slots (`NEWS_SLOTS`, default `12:00,16:00,19:30` in `TIMEZONE`, default Europe/London). An episode starts `SLOT_LEAD_MINUTES` (75) before its slot and publishes at the slot: public uploads are scheduled on YouTube, unlisted or private uploads wait until the slot. A slot missed by more than `SLOT_GRACE_MINUTES` (30) is skipped, never double-booked.
- **Breaking** is reserved for massive stories: an official source, corroborated, not a rumour, first seen by the discovery poll no more than `BREAKING_MAX_AGE_MINUTES` (90) ago and scoring at least `BREAKING_SCORE_MIN` (75). It fires any time inside `BREAKING_WINDOW` (07:00-23:00 local), at most `BREAKING_PER_DAY` (2) times, with a per-franchise cooldown of `BREAKING_COOLDOWN_HOURS` (2), a `BREAKING_APPROVAL_MINUTES` (20) countdown instead of the normal one, and a Discord heads-up the moment it starts.

Discovery runs every `DISCOVER_MINUTES` (3) on its own lease and remembers when each story cluster was first seen, so "breaking" means minutes old, not "has a new follow-up". `SHORTS_PER_DAY` (4) caps all lanes together; `MAX_PRODUCING` (2) episodes can be mid-production at once and episodes waiting on approval or YouTube never block the next one; every publish keeps `MIN_UPLOAD_GAP_MINUTES` (60) after the last. YouTube Data API units are metered per Pacific day in `quota_ledger`; an upload is deferred to the next reset when fewer than about 2,100 units remain, and `QUOTA_UNITS_PER_DAY` (10,000) is the project's default quota. `/health` reports per-lane counts, producing and scheduled episodes and the last discovery.

## Footage

Footage follows the words, the way the Ocarina of Time remaster Short did by hand. Each official Steam trailer is downloaded once, a keyframe is read every 1.5 s with its brightness and motion, and every narration line that wants a picture (the hook and each beat; the writer states what each line should show and 1-4 keywords) is matched to the moment that shows it. With `CLIP_RANKING=llm` (default) the model does the matching from the keyframes and rejects title cards, rating boards, logos and menus; with `CLIP_RANKING=rule`, or when the model is unavailable, the liveliest moment opens the hook, the stillest sits under number cards and the rest take the next liveliest. Chosen moments are cut as 4.8 s muted clips tagged with their line (`beatIndex`, `role`), the planner lays each under its own line and never borrows another line's moment, and the publisher footage budget trims from the end.

## Evergreen lane

Ranking Shorts in the Epix-Gaming style, 75-160 seconds, six to ten entries spoken from the bottom up with a stated criterion: "Ranking EVERY Resident Evil game", "The BEST open-world game for every year", "Skyrim: 15 years later", "Is The Witcher 3 still good in 2026". On `EVERGREEN_DAYS` (default tue,thu,sat) an episode starts two hours before `EVERGREEN_SLOT` (19:00 local). Topics come from Steam's current top sellers plus a rotating franchise list, avoiding anything covered in the last six months; the writer drafts entries, the factory fetches live Steam facts for each, and the script is rewritten against them. Every entry gets its own box art and one 4-second trailer moment tagged to its line, a rank badge and a verdict chip. `EVERGREEN_APPROVAL_MODE` defaults to manual.

## Approval

| `APPROVAL_MODE` | Behaviour |
|---|---|
| `timeout` (default) | Posts to Discord and publishes after `APPROVAL_TIMEOUT_MINUTES` unless rejected. Rumours always wait for a human. |
| `manual` | Waits for Approve. |
| `auto` | Publishes as soon as QA passes. |

The Approve and Reject links point at `PUBLIC_URL`. On `http://localhost:8080` they only work on this PC. To tap them from your phone, set `PUBLIC_URL` to the Cloudflare tunnel Codex used (`pulse.orryy.com`, pointed at port 8080). `windows\install-tunnel.ps1` registers a hidden "Pulse Tunnel" start-up task that keeps that tunnel running.

## Operating it

`npm run doctor` (with the factory stopped) checks the Anthropic key, the YouTube login and its scopes, the local voice server, ElevenLabs balance, ffmpeg, free disk, the public URL and the Discord webhook. The server runs the same checks at boot and posts any failures to Discord once.

- **Dashboard:** `http://localhost:8080/episodes?key=<ADMIN_TOKEN from .env>`
- **Force a run:** `POST http://localhost:8080/tick?key=<ADMIN_TOKEN>`
- **Logs:** `factory\data\logs\`
- **CLI** (while the factory is stopped): `npm run cli -- episodes | discover | retry <id>`
- **Alerts:** Discord gets failures, `invalid_grant` (reconnect YouTube at `/oauth/start?key=<ADMIN_TOKEN>`), and a warning if nothing has published in 26 hours.

## Render speed

`REMOTION_GL=angle` renders through the GPU (Chromium ANGLE on D3D11). On the RTX 4090 a 17.5 s sample rendered in 14 s against 71 s with the software `swangle` backend, with pixel-identical output (PSNR 51 dB). `REMOTION_CONCURRENCY=8` suits the 8-core 7800X3D. The installer writes both; set `REMOTION_GL=swangle` on a machine without a usable GPU.

## Captions

Every episode writes `captions.srt` from the narration's word timings, and once YouTube reports the video as processed the factory uploads it as the en-GB caption track (`captions.insert`, 400 quota units). A caption failure is logged as an event and never holds up a video that is already live.

## Costs

The only running cost is Claude (selection, script, fact-check and vision QA): a few dollars a month at one Short a day. Voice, rendering, database and hosting all run on the PC. ElevenLabs is used only if the local voice is unavailable.

## Rules the code enforces

- A story needs an official source or two independent outlets. Anything else is a rumour: off by default, always labelled and never auto-approved.
- A failed fact-check gets one rewrite. A second failure drops the story before any narration is made.
- House style is checked in code: British spelling, no serial comma, banned openers and calls to action, 70–115 words.
- Visuals are original motion graphics plus publisher-supplied store art and first-party press images, each stored with its source. No outlet photos, no footage and nothing leaked.
- Uploads save the resumable session first and tag the video privately. After any ambiguous failure, the next attempt finds the existing upload instead of posting again.

## Brand kit

`npm run brand` renders the channel banner (2560x1440, content inside the 1546x423 safe area), the avatar (800x800) and a long-form thumbnail template (1280x720) into `brand/` from the same colour, type and motion tokens the Shorts use. `brand/BRAND.md` is the brand system; `brand/CHANNEL_KIT.md` is the copy to paste into YouTube Studio.

## Development

```
npm ci && npm run typecheck && npm test
npm run studio      # Remotion Studio, to iterate on the look
```

Brand files are in `public/`. The logo, music beds (`audio/mastered/`) and SFX (synthesised by `tools/build-sfx-library.js`) come from the main repo. The fonts are Anton and Inter under the OFL.
