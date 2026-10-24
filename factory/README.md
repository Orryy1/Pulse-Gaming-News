# Pulse factory

Makes up to four premium gaming Shorts a day on this PC and publishes them to YouTube: three news slots timed for the US first (13:00, 17:00, 22:00 London, which is 8am, noon and 5pm Eastern), a reserved breaking lane for huge official stories, a ranking Short on Tuesday, Thursday and Saturday evenings and a long-form ranking on Sunday. Prices lead in US dollars with pounds and euros alongside, and are written out in words for the voice so narration and screen always agree. There are no cloud servers to pay for: it runs in the background, starts at log-on, restarts itself and updates itself from the branch every night.

```
RSS (official newsrooms + outlets) + Steam top sellers, polled every 3 minutes
  → cluster + score + corroborate       (official source, or two independent outlets)
  → Claude picks the story, writes the script, then fact-checks it against the articles
    (rankings: a topic is chosen from franchises and sellers, then 6-10 entries with Steam facts)
  → narration: ElevenLabs first, rotating through an 18-voice pool every two Shorts,
               the local Liam voice (VoxCPM, port 8766) when credits run out
  → voice polish (highpass, compression, limiter), word timings, an SRT caption track
  → official Steam store art and trailers; the publisher's own YouTube trailer for games not on Steam
  → every narration line is matched to the trailer moment that shows it; clips open on a cut and end before the next
  → a persisted render plan (shots, cuts on word ends, cards, shelf, SFX) scored by a rubric before any render
  → Remotion render 1080×1920 on the GPU: story-type cards, framed footage, word-by-word captions, owned music and SFX
  → loudness −16 LUFS → ffprobe QA → Claude vision QA on sampled frames (a failed check re-plans and re-renders)
  → scheduled YouTube upload at the slot, captions and a pinned comment, a Discord card for every step
  → views, likes and comments captured at fixed ages; the editor sees recent results; a Monday digest
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

Footage follows the words, the way the Ocarina of Time remaster Short did by hand. Each official Steam trailer is downloaded once, a keyframe is read every 1.5 s with its brightness and motion, and every narration line that wants a picture (the hook and each beat; the writer states what each line should show and 1-4 keywords) is matched to the moment that shows it. With `CLIP_RANKING=llm` (default) the model does the matching from the keyframes and rejects title cards, rating boards, logos and menus; with `CLIP_RANKING=rule`, or when the model is unavailable, the liveliest moment opens the hook, the stillest sits under number cards and the rest take the next liveliest. Every trailer is also scanned for shot changes (scene score plus a frame-difference spike against the surrounding half second, which catches cuts inside fast action), each candidate opens on its shot's first frame and the clip ends where the shot ends, never changing picture under the words it was chosen for; shots under 1.6 s are passed over. Chosen moments are cut as muted clips of up to 4.8 s tagged with their line (`beatIndex`, `role`); the planner lays each under its own line, cuts the shot where a shorter clip ends, never borrows another line's moment, and the publisher footage budget trims from the end.

### Games that are not on Steam

When Steam has no page for the game (GTA VI, Nintendo titles), the factory searches YouTube for "<game> official trailer" through the channel's own login and accepts a result only from a channel whose name matches a known publisher and whose audience is the size that publisher's channel has (`src/assets/officialTrailer.ts`); reuploads, reactions and breakdowns never pass. The trailer is downloaded with yt-dlp (`YTDLP_PATH`), matched to the narration exactly like a Steam trailer and cut under that publisher's cap (Rockstar 6 s, Ubisoft 8 s, Nintendo stills only, others 14 s); its largest thumbnail becomes the hero still. The search costs about 101 YouTube quota units and is skipped when that would eat into the day's upload reserve. `OFFICIAL_TRAILERS=false` turns it off. The description credits the channel and links the trailer.

## Evergreen lane

Ranking Shorts in the Epix-Gaming style, 75-160 seconds, six to ten entries spoken from the bottom up with a stated criterion: "Ranking EVERY Resident Evil game", "The BEST open-world game for every year", "Skyrim: 15 years later", "Is The Witcher 3 still good in 2026". On `EVERGREEN_DAYS` (default tue,thu,sat) an episode starts two hours before `EVERGREEN_SLOT` (19:00 local). Topics come from Steam's current top sellers plus a rotating franchise list, avoiding anything covered in the last six months; the writer drafts entries, the factory fetches live Steam facts for each, and the script is rewritten against them. Every entry gets its own box art and one 4-second trailer moment tagged to its line, a rank badge and a verdict chip. `EVERGREEN_APPROVAL_MODE` defaults to manual.

## Weekly lanes

Three weekly Shorts at 20:00 London (3pm Eastern), each from data the factory fetches itself (`src/discovery/weekly.ts`), so nothing is invented:

- **Release Radar** (Monday, `RADAR_DAYS`): Steam's most-wishlisted upcoming games that release in the next seven days, in release order, each with its own art and trailer moment and a date badge instead of a rank. Skipped in a week with fewer than four dated releases.
- **Free This Week** (Thursday, `FREE_DAYS`, after Epic's Thursday rotation): Epic's free-to-keep games from the store's own feed as an official news story, with the normal price, the end time in Eastern time and next week's free game.
- **Weekly Recap** (Friday, `RECAP_DAYS`): the five biggest corroborated, non-rumour stories the factory saw that week, ranked.

Ranking Shorts run on Tuesday and Saturday (`EVERGREEN_DAYS`), so no day exceeds four Shorts. `WEEKLY_ENABLED=false` turns the three off.

## Long-form lane

Once a week (Sunday 18:00 London by default, `LONGFORM_DAYS`, `LONGFORM_SLOT`) the factory makes a five to seven minute 16:9 ranking video: the same topic pool as the evergreen Shorts, a writer that gives every entry a paragraph plus an intro and an outro (`src/editorial/longform.ts`), ElevenLabs narration spoken in takes of about a hundred words and stitched with exact timings, two trailer moments per entry (`LONGFORM_CLIPS_PER_ENTRY`), and the `PulseLong` composition (`src/render/Long.tsx`): full-bleed moments and art on slow moves, a lower-third card per entry that collapses to a tag, the pick as the outro and a quiet end card; portrait box art sits framed over its own blur rather than cover-cropped. The plan (`src/render/longplan.ts`) never lets a clip shot outlast its clip and never leaves a shot under two seconds. QA uses a 16:9 band (3-12 minutes) and a long-form vision prompt; a faulted moment is dropped before the retry. The description carries chapters, the thumbnail comes from the brand kit (`thumbnails.set` needs a phone-verified channel; a refusal is logged). `LONGFORM_ENABLED=false` turns it off; `LONGFORM_APPROVAL_MODE` defaults to auto.

## Voice rotation

`ELEVENLABS_VOICE_POOL` is a comma-separated list of `voiceId:Name` pairs. The n-th Short the channel makes uses the voice at `floor(n / VOICE_ROTATION)` (default 2) in the pool, wrapping round, so a few Shorts in a row share a voice and the analytics can say which one holds viewers. The voice used is stored in `assets_json.voice`, logged as a `voice` event and named on the Discord publish card. An empty pool always uses `ELEVENLABS_VOICE_ID`.

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

## Analytics

Every published Short's public views, likes and comments are read 1 h, 3 h, 24 h, 72 h, 7 d and 28 d after it goes live (`video_metrics`; one quota unit per fifty videos, a window missed by more than half its age is skipped rather than back-filled). Once four Shorts have a 24 h figure the editor is shown the best and worst five of the last 28 days, with story type, game, lane and narrator voice, as advice when it picks the next story. Every Monday at 09:00 the Discord digest gives the week's counts per lane, median views at 24 h, best and weakest Shorts, median views per voice over 28 days (the voice rotation test) and the quota used. Retention curves and engaged views need the analytics scope and arrive once the YouTube login is reconnected.

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
