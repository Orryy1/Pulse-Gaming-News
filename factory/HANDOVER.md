# Handover prompt for a local Claude session on the PC

Paste everything below the line into a new Claude Code session running **on the PC**: the desktop app's Code tab with the environment set to this computer (not cloud), opened on the folder where the factory was installed.

---

You're taking over the **Pulse Gaming News** Shorts factory. This session runs on my Windows PC (RTX 4090, Ryzen 7 7800X3D), so you can read files, run commands and check what's actually happening. I want a fully autonomous factory that publishes one ultra-premium gaming-news YouTube Short a day, with as little input from me as possible. I'm not technical: do the work yourself and only ask me when you truly need a decision or a login.

## Where things are

- **Repo:** `github.com/Orryy1/Pulse-Gaming-News`, branch `claude/epic-pasteur-7s143q`, draft PR #83. All new work lives in **`factory/`**. Everything outside `factory/` is the old OpenAI Codex system; leave it alone unless I ask.
- **Install location:** I ran `factory\INSTALL.cmd` from either `C:\PulseFactory` (a git worktree of `C:\Users\MORR\gaming-studio\pulse-gaming`, which supports auto-update) or an extracted zip (`C:\PulseFactory\Pulse-Gaming-News-claude-epic-pasteur-7s143q\`, which doesn't). Check which one it is first. If it's the zip, convert it to a git worktree so `windows\run.ps1` can auto-update.
- **Running state:** the installer registered a hidden scheduled task, **"Pulse Factory"**. It runs `factory\windows\run.ps1`, which pulls updates and then runs `node --import tsx src/server.ts` on port 8080. The dashboard is `http://localhost:8080/episodes?key=<ADMIN_TOKEN from factory\.env>`. It loaded, but showed "Last tick: never" right after install. Logs are in `factory\data\logs\`. The database is embedded PGlite in `factory\data\db` and is single-process, with a lock file. Settings are in `factory\.env`; it was installed in **DRY_RUN** mode.
- **Old Codex system** (what it was built with), from GitHub branches:
  - Main checkout: `C:\Users\MORR\gaming-studio\pulse-gaming`. Its `.env` has the API keys. `tokens\` holds `youtube_credentials.json`, `youtube_token.json` and `youtube_playlists.json`.
  - Data: `D:\pulse-data`, with `pulse.db` (SQLite) holding the real published-video records in `platform_posts`.
  - Voice references: `D:\pulse-data\private\voice-references`.
  - Evidence: `D:\pulse-evidence\`.
  - Governed runtime: `C:\Pulse\runtime\pulse-v1`.
  - Codex worktrees: `C:\Users\MORR\.codex\worktrees\`.
  - There may also be `D:\pulse-runtime\pulse-production`; it isn't in git.
  - Old Windows tasks are named `PulseGaming-*`: `Stabilisation-Runtime` (port 3001), `LiveWatchdog-Supervisor`, `OAuthUptime`, `LiveGuarded-YouTube-Runtime`, `GrowthAutopilot` and `Ollama-Watchdog`. **Make sure none of the old ones can publish to YouTube**, so only the new factory posts.

## How the new factory works (`factory/`, TypeScript, Node 22)

The pipeline is one state machine in an `episodes` table: selected → scripted → voiced → rendered → awaiting_approval → approved → uploading → uploaded → published (or rejected / failed). It's advanced every 10 minutes by `src/pipeline.ts` `tick()`, under a lease. Status changes are compare-and-set, and each step saves its output before the status moves on.

1. **Discovery** (`src/discovery/`): RSS from official newsrooms and outlets. Stories are clustered and scored. A story only counts as corroborated with an official source or two outlets. Reddit is intentionally excluded.
2. **Editorial** (`src/editorial/`): Claude, default `CLAUDE_MODEL=claude-opus-5-5`, through `@anthropic-ai/sdk` structured outputs. It picks the story, then writes a script with hook → 2–4 fact beats with on-screen visuals → a "Pulse take" → a loop line. The script must be 70–115 words, in British English, with no Oxford comma.
3. **Fact-check:** a second Claude call checks the script against the fetched article text plus live Steam data. If it fails twice, the story is dropped. House rules are validated in code.
4. **Voice** (`src/voice/`): `VOICE_PROVIDER=auto` uses the local Codex **"Liam"** voice server first. That's `tts_server\` in the Codex checkout: VoxCPM 2 with WhisperX alignment, on `http://127.0.0.1:8765`, voice id `TX3LPaxmHKxFdv7VOQHJ`, and an ElevenLabs-compatible `/v1/text-to-speech/{id}/with-timestamps` endpoint.
   - Takes are capped at 36 words, because VoxCPM is unstable on longer takes under Windows CUDA. They're stitched with offset word timings.
   - If the server is down, the factory runs `LOCAL_TTS_START` (`tts_server\start.bat`). A cold start takes 2–5 minutes.
   - ElevenLabs is only a fallback, and only when the month's credits cover the script; I have limited credits.
   - The voice is polished with highpass, compression, a limiter and loudnorm at −17.
5. **Media** (`src/assets/steam.ts`): official Steam store key art, plus up to 4 **trailer B-roll clips** from Steam's HLS trailers, 3.4 s each and muted, with provenance stored. Also live **Steam data**: price, reviews and current players. The data feeds the script, the fact-check and an on-screen "LIVE · STEAM" badge.
6. **Render** (`src/render/`): Remotion 4.0.536, 1080×1920 at 30 fps.
   - Hook headline in the first 1.5 s.
   - Clips alternate with stills, with Ken Burns moves.
   - Fact cards (stat, date, quote, list, title), the take card and word-by-word captions with the active word highlighted.
   - Safe zones for the Shorts UI.
   - Film grain and vignette, cut flashes, and owned SFX (synthesised in-house by `tools/build-sfx-library.js`).
   - Music bed from `audio/mastered`, ducked under the voice.
   - Bundled OFL fonts (Anton, Inter). ffmpeg comes bundled via ffmpeg-static.
7. **QA:** loudness normalised to −14 LUFS, then ffprobe checks (1080×1920, h264, duration, loudness, black frames), then Claude vision QA on sampled frames.
8. **Approval:** a Discord webhook post with the poster and signed Preview / Approve / Reject links. `APPROVAL_MODE=timeout` auto-publishes after 60 minutes unless rejected. Rumours always wait for a human.
9. **Upload** (`src/youtube/`): resumable upload. The session URI is saved before any bytes are sent, and each video gets a private marker tag. On retry the factory searches the channel and adopts the existing video instead of uploading twice.
   - The factory reuses the Codex YouTube login via `PULSE_TOKEN_DIR`.
   - Videos are tagged as synthetic media because the narrator is a cloned voice.
   - Hard errors (`invalid_grant`, quota) send an alert and stop.
10. **Operations:** a Discord alert if nothing has published in 26 hours. Media is pruned after 14 days. At 04:00 UTC, if idle, the factory restarts so `run.ps1` can fast-forward to new commits, typecheck them and roll back if they fail.

Commands (in `factory/`, with the factory stopped for the CLI): `npm ci`, `npm run typecheck`, `npm test` (28 tests using PGlite and fakes), `npm run cli -- discover|episodes|retry <id>`, and `npm run studio` (Remotion Studio). The full write-up is in `factory/README.md`.

## Your jobs, in order

1. **Health check:**
   - Find the install and confirm the "Pulse Factory" task is running.
   - Read the newest log.
   - Open the dashboard and confirm a dry-run episode was produced end to end. If it wasn't, fix whatever broke and push the fix.
   - Check that the Liam server starts (`curl http://127.0.0.1:8765/health`), that `tts_server\venv` exists, and that the voice reference WAV is present.
   - If `tts_server` was never set up on this PC, set it up with `tts_server\setup.bat`.
2. **Make sure only one system publishes:** disable any old Codex tasks or processes that could upload.
3. **Watch the dry-run Shorts** (`factory\data\episodes\<id>\short.mp4`) and raise the production value until they look like a top-tier gaming-news channel. Known gaps:
   - The lower-middle of the frame is often empty and dark.
   - Clip choice is blind: pick trailer moments that match the beat.
   - Layouts don't vary enough by story type.
   - There's no end card or loop polish.
   - Uploading an SRT caption track would help; Codex did this.
   - Compare against the Codex lanes on the GitHub branches. `origin/codex/creator-grade-release` has STUDIO_SHORT_ENGINE.md and STUDIO_V21_GATE_REPORT.md. `origin/codex/system-trace-display-20260820` has the HyperFrames System Trace explainers, which are the last verified high-quality uploads: IDs `rzOvNGGhbN8`, `j14Rs4DNDgU`, `PTC9E_8pnqU`, `sqHT2IskSis`, `nvV1AhSGAP4`, `mOMdA1j_y0c` and `Por3we514ds`. Those used a Kokoro `bm_george` voice and original animated diagrams, not Liam. Ask me whether "really getting somewhere" meant those.
   - Also query `D:\pulse-data\pulse.db` `platform_posts` for the gaming-news uploads and look at the best ones.
4. **Phone approvals:** point the Cloudflare tunnel Codex used (`pulse.orryy.com`, config in `C:\Users\MORR\.cloudflared\`) at port 8080, and set `PUBLIC_URL`, so the Discord Approve/Reject links work from my phone.
5. **Go live carefully:** with my OK, set `DRY_RUN=false` and `YOUTUBE_PRIVACY=unlisted` for the first real upload. Then switch to `public` once I've seen it on YouTube.
6. Later: a YouTube Analytics feedback loop that tunes topics and hooks, and possibly a weekly long-form roundup.

## Rules

- **Cardinal rules (from CLAUDE.md):**
  - British English, no Oxford comma.
  - Verified sources only, and rumours must be labelled.
  - Advertiser-friendly language.
  - No personal details about me in anything public.
  - Never commit `.env`, keys or `tokens\`.
  - The Codex-era CLAUDE.md "Codex Reviewer Boundaries" apply to Codex, not to you.
- **Copyright posture:**
  - Official publisher material only: Steam store art and trailers, and first-party newsroom images.
  - Footage stays short and subordinate to the reporting.
  - Never use outlet photos or leaked material.
  - For GTA VI, at most about 5–6 s of Rockstar's own footage per Short.
- **Monetisation posture:** every Short needs a real "Pulse take" (context, data or a framed opinion). Never mass-produce near-identical uploads; stay at 1 a day until retention is good.
- **Flag to me (don't decide alone):** the Liam voice id looks like ElevenLabs' stock "Liam" voice. Codex's notes say cloning it breaks ElevenLabs' terms, though an attestation claims permission. A clone of my own voice would be safest for a monetised channel.
- **Git:** commit to branch `claude/epic-pasteur-7s143q` (or a new branch off it) and push, so the PR and `run.ps1` auto-update pick it up. Run `npm run typecheck && npm test` before every push.
- I prefer things to run unattended. Tell me plainly when something needs me: a login, an approval, or a decision.
