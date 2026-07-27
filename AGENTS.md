# Pulse Gaming — AI News Shorts Empire v3

## Primary Codex /goal

Use `docs/codex-main-goal.md` as the main operating goal for this repo. It supersedes any older "shorts factory" framing: Pulse Gaming is being built as a governed autonomous media operating system with production-grade story manifests, rights ledgers, platform-native outputs, policy gates, commercial intelligence, observability and hard publish control.

## Repo layout

Pulse Gaming is a Node.js CommonJS media system with a React/Vite dashboard.

- `server.js` runs the Express API, dashboard routes and scheduler entrypoints.
- `run.js` is the top-level pipeline runner for hunt, approve, produce, publish and schedule modes.
- `lib/` contains production services, policy gates, render governance, platform logic and studio systems.
- `tools/` contains operator CLIs, diagnostics, repair lanes and proof artefact generators.
- `tests/` contains Node test files. `test/fixtures/` contains regression fixtures. `test/output/` is disposable proof output.
- `output/` contains generated media, manifests, QA reports and campaign proof artefacts.
- `channels/` contains channel-specific brand, source, voice and prompt configuration.
- `src/` contains the React dashboard. `public/` contains static frontend assets.
- `docs/` contains current operating goals, runbooks, audits and production readiness notes.
- `db/` contains SQLite migrations and repository support.
- `tokens/` and `.env` are local secret material. Never commit, print or mutate them unless a goal explicitly allows it.

## Key directories

- Production code: `lib/`, root pipeline files, `server.js`, `publisher.js`, `processor.js`, `audio.js`, `assemble.js`, `upload_*.js`.
- Operator commands: `tools/`.
- Tests: `tests/services/`, `tests/ops/`, `tests/db/`.
- Proof fixtures: `test/fixtures/goal/`.
- Generated proof: `output/`, `test/output/`.
- Current product contract: `docs/codex-main-goal.md`.

## Build commands

- Install from the lockfile: `npm install`.
- Build the dashboard: `npm run build`.
- Start the local API and dashboard together: `npm run dev`.
- Start the API and scheduler process: `npm start`.

## Test commands

- Run a focused test file: `node --test tests/services/<name>.test.js`.
- Run a focused ops test: `node --test tests/ops/<name>.test.js`.
- Run the full Node suite: `npm test`.
- Validate this operating-rules file: `npm run ops:agent-rules`.
- Run docs drift checks: `npm run docs:doctor`.

## Render commands

- Create render input work orders: `npm run ops:goal-render-inputs`.
- Materialise owned motion: `npm run ops:goal-owned-motion`.
- Build audio and timestamp workbench outputs: `npm run ops:goal-audio-timestamps`.
- Materialise audio and timestamp artefacts: `npm run ops:goal-audio-materialize`.
- Materialise production renders: `npm run ops:goal-production-render`.
- Inspect V4 motion packs: `npm run ops:v4-motion-pack`.
- Run V4 source-family acquisition checks: `npm run ops:v4-source-family-acquisition`.

## Dry-run publish commands

- Strict dry-run package plan: `npm run ops:goal-dry-run-publish`.
- Publish readiness report: `npm run ops:publish-readiness`.
- Next candidate preflight: `npm run ops:next-publish-candidates`.
- Platform status matrix: `npm run ops:platform:status`.
- Platform readiness doctor: `npm run ops:platform-doctor`.

Dry-run output is evidence, not permission to publish.

## Safety modes

LOCAL_PROOF is the default mode. Use it for renders, tests, repair planning and proof artefacts.

DRY_RUN_PUBLISH is the default publish mode. It may generate platform packs and planned actions but must not post externally.

HUMAN_REVIEW queues candidates for operator approval. AMBER items stay blocked until a human accepts the stated risk.

AUTO_PUBLISH is forbidden unless a goal explicitly authorises it, the operator has enabled the platform, the kill switch is healthy and the control tower returns GREEN.

## Banned behaviours

- No live publishing by default.
- No OAuth/token mutation by default.
- No production DB mutation by default.
- No external posting by default.
- Do not weaken gates.
- Do not change tests to bless unsafe behaviour.
- Do not mark disabled platforms as publishable.
- Do not count package files as scheduler-ready without preflight evidence.
- Do not use legacy thin renders as normal production output.
- Do not expose `.env`, API keys, OAuth tokens or token file contents.
- Do not run `node run.js publish`, `node run.js full`, `upload_*.js` live modes or OAuth token commands unless the exact goal allows it.

TDD is required. Focused tests are required. Machine-readable artefacts are required. Proof reporting is required.

## Current production-cutover context

The current cutover is blocked by final production render inputs, not by a lack of ideas. Treat these as live blockers until artefacts prove otherwise:

- Missing final narration audio.
- Missing word timestamps.
- Missing materialised motion clips.
- Missing distinct motion families.
- Missing or stale final MP4 evidence.
- Incomplete rights records.
- Scheduler bridge and strict dry-run gaps.

Past production incidents include legacy thin visual renders, placeholder titles, public narration that leaked internal QA language, local LLM failures and platform upload errors. New work must reduce those risks, not route around them.

## Definition of done

A goal is done only when the repo has the behaviour, tests and proof artefacts to support the claim.

- Focused tests were added or updated.
- Focused tests passed.
- Relevant integration tests passed or the skip is explained.
- No gates were weakened.
- No live publishing, production DB mutation, OAuth/token mutation or external posting occurred unless the goal explicitly allowed it.
- Machine-readable JSON artefacts were generated.
- A human-readable summary was generated.
- Remaining blockers are listed.
- Commands run and files changed are reported.

## Focused tests

Use the smallest test command that proves the changed behaviour. Examples:

- `node --test tests/services/agent-operating-rules.test.js`
- `node --test tests/services/incident-guard.test.js`
- `node --test tests/services/goal-render-input-workorder.test.js`
- `node --test tests/services/studio-v4-render-bridge.test.js`

## Full tests

Run `npm test` before claiming broad readiness. If the suite is too slow for the current goal, run the relevant focused tests plus the closest integration tests and say exactly what did not run.

## Preflight

Use preflight commands when a change touches scheduling, publish candidates, platform packs or readiness claims:

- `npm run ops:next-publish-candidates`
- `npm run ops:publish-readiness`
- `npm run ops:platform-doctor`
- `npm run ops:goal-dry-run-publish`

Scheduler preflight is the source of truth for scheduler readiness. Package files alone are not enough.

## Render health

Use `npm run ops:render-health` for render health. The report must separate live DB debt from governed V4 bridge readiness. Do not say "ready" unless the scheduler preflight agrees.

## Repair backlog

Use these commands to inspect and plan repair work:

- `npm run ops:pipeline-backlog`
- `npm run ops:goal-render-inputs`
- `npm run ops:goal-audio-timestamps`
- `npm run ops:goal-owned-motion`
- `npm run ops:bridge-live-rights-repair`
- `npm run ops:bridge-preflight-stamp-repair`

Repair plans must name the story ID, blocker type, missing input, command, required artefact path, expected output, DB mutation status, operator approval status and post-repair validation command.

## Platform packs

Use these commands to inspect platform packs without posting:

- `npm run ops:goal-platform-duration-contract`
- `npm run ops:goal-platform-native-repair`
- `npm run ops:goal-platform-variants`
- `npm run ops:platform:status`
- `npm run ops:platform-doctor`

Disabled platforms must stay visible and must not be counted as publishable.

## Pulse Gaming production law

1. Rendered does not mean publishable.
2. Dry-run package does not mean scheduler-ready.
3. Scheduler-ready does not mean platform-ready.
4. Platform-ready does not mean safe to auto-publish.
5. Only GREEN control tower verdict can publish.
6. Placeholder titles are production incidents.
7. Internal QA language in public narration is a production incident.
8. Missing narration, timestamps, materialised motion or rights records blocks publishing.
9. All readiness claims must be backed by artefacts.

## Overview

Multi-channel autonomous pipeline that hunts Reddit + RSS feeds for verified news, generates YouTube Shorts scripts via Codex, produces professional audio/image/video assets with real images, branded bumpers and broadcast overlays, and auto-publishes to 5 platforms (YouTube Shorts, TikTok, Instagram Reels, Facebook Reels, X/Twitter) at research-backed optimal times. Supports multiple channels via the `channels/` config system.

## Multi-Channel Architecture

Channel configs live in `channels/`. Each channel defines: brand palette, voice settings, content sources, classification system, system prompt and YouTube category. Set `CHANNEL=stacked` env var to switch channels.

| Channel                  | Niche   | Palette          | Voice                              |
| ------------------------ | ------- | ---------------- | ---------------------------------- |
| `pulse-gaming` (default) | Gaming  | Amber `#FF6B1A`  | Male (pNInz6obpgDQGcFmaJgB)        |
| `stacked`                | Finance | Green `#00C853`  | Male deeper (ErXwobaYiN019PkySvjV) |
| `the-signal`             | Tech    | Purple `#A855F7` | Female (EXAVITQu4vr4xnSDxMaL)      |

## Cardinal Rules

- British English throughout. No serial/Oxford comma.
- Verified sources only — never present rumours as fact without flagging.
- Amazon affiliate tag must appear on every product link.
- Burner identity protection — no personal details in any public-facing output.
- Monetisation safety — avoid advertiser-unfriendly language in all outputs.

## Tech Stack

- **Runtime:** Node.js (CommonJS)
- **News Sources:** Reddit public JSON API (8 subreddits) + 8 RSS feeds (IGN, GameSpot, Eurogamer, etc.)
- **AI Scripts:** Anthropic SDK (Codex-haiku-4-5-20251001)
- **TTS:** ElevenLabs API (eleven_multilingual_v2)
- **Images:** Professional pipeline — downloads real game art from Steam, article og:image, company logos + composites via Sharp
- **Video Assembly:** FFmpeg multi-image Ken Burns with lower thirds, broadcast-style overlays
- **Upload:** YouTube Data API v3, TikTok Content Posting API, Instagram Graph API
- **Server:** Express + CORS + node-cron autonomous scheduler
- **Dashboard:** React 18 + Vite + Tailwind CSS
- **Notifications:** Discord webhooks

## Story Object Schema

```json
{
  "id": "string — Reddit post ID or rss_{hash}",
  "title": "string",
  "url": "string",
  "score": "number — Reddit upvotes or 50 for RSS",
  "flair": "string — Verified | Highly Likely | Rumour | News",
  "subreddit": "string — subreddit name or RSS source name",
  "source_type": "reddit | rss",
  "breaking_score": "number — composite breaking news value score",
  "top_comment": "string — first 500 chars",
  "timestamp": "ISO 8601",
  "num_comments": "number",
  "hook": "string — 0-3s opener",
  "body": "string — 3-45s main content",
  "loop": "string — 45-50s rewatch hook",
  "full_script": "string — complete narration",
  "word_count": "number — target 120-150",
  "suggested_thumbnail_text": "string",
  "content_pillar": "Confirmed Drop | Source Breakdown | Rumour Watch",
  "affiliate_url": "string — Amazon UK search link with tag",
  "pinned_comment": "string — YouTube pinned comment text",
  "approved": "boolean",
  "auto_approved": "boolean — true if approved by scoring algorithm",
  "article_image": "string — og:image URL from article",
  "company_name": "string — detected publisher/developer",
  "company_logo_url": "string — Wikipedia SVG URL",
  "game_images": "array — Steam key art, hero, capsule, screenshots",
  "downloaded_images": "array — { path, type } cached on disk",
  "audio_path": "string — output/audio/{id}.mp3",
  "image_path": "string — output/images/{id}.png",
  "exported_path": "string — output/final/{id}.mp4",
  "youtube_post_id": "string",
  "youtube_url": "string",
  "tiktok_post_id": "string",
  "instagram_media_id": "string"
}
```

## API Endpoints

| Method | Path                    | Description                          |
| ------ | ----------------------- | ------------------------------------ |
| GET    | /api/news               | Returns daily_news.json array        |
| GET    | /api/health             | Server status + autonomous mode info |
| POST   | /api/approve            | Body: { id } — marks story approved  |
| POST   | /api/publish            | Spawns produce pipeline              |
| GET    | /api/publish-status     | Returns { status }                   |
| GET    | /api/download/:id       | Streams exported MP4                 |
| POST   | /api/generate-image     | Queues image generation              |
| POST   | /api/generate-video     | Queues video generation              |
| GET    | /api/stats/:postId      | YouTube/TikTok view count            |
| POST   | /api/autonomous/run     | Trigger full autonomous cycle        |
| POST   | /api/autonomous/approve | Run auto-approval pass               |
| POST   | /api/autonomous/publish | Multi-platform upload                |
| GET    | /api/autonomous/status  | Schedule + platform config           |
| GET    | /api/platforms/status   | OAuth status per platform            |
| GET    | /api/hunter/status      | Hunter active/last/next run          |
| POST   | /api/hunter/run         | Trigger immediate hunt               |

## Autonomous Schedule (all times UTC)

| Time  | Action                                                       |
| ----- | ------------------------------------------------------------ |
| 06:00 | Morning hunt — catches overnight US Reddit leaks             |
| 10:00 | Mid-morning hunt — review embargo lifts (9AM-12PM ET)        |
| 14:00 | Afternoon hunt — Nintendo Direct window (2PM GMT)            |
| 17:00 | Evening hunt — Xbox showcase + US morning embargoes          |
| 18:00 | Produce cycle — audio + professional images + video assembly |
| 19:00 | YouTube Shorts upload — peak engagement (7PM GMT = 2PM ET)   |
| 20:00 | TikTok upload — staggered 1hr after YouTube                  |
| 21:00 | Instagram Reels upload — staggered 1hr after TikTok          |
| 22:00 | Late hunt — PlayStation State of Play window                 |

## Auto-Approval Rules

Stories are auto-approved when:

- Verified flair + from r/GamingLeaksAndRumours
- Verified/Highly Likely flair + score >= 500 or comments >= 50
- Breaking score >= 80 (any verified/highly likely story)
- RSS from major outlet + breaking score >= 60

## Script Format Contract

- **Hook (0-3s):** One punchy sentence. Never starts with: So, Today, Hey, Welcome, In this.
- **Body (3-45s):** Short declarative sentences, British English, no filler.
- **Loop (45-50s):** Curiosity or callback to hook. Never says "let me know in the comments".
- **Word count:** 120-150 words (130-140 target for 50s at natural pace).
- **Validation:** Retry once if validation fails, then accept with warning.

## Professional Image Pipeline

1. Downloads article hero image (og:image from news source)
2. Searches Steam Store API for game key art, hero, capsule images
3. Detects publisher/developer and fetches company logo
4. Composites into branded 1080x1920 SVG with real images embedded
5. Converts to PNG via Sharp at 95% quality
6. All downloaded images cached in output/image_cache/

## Video Assembly (FFmpeg v2)

- Multi-image Ken Burns with alternating zoom in/out + pan directions
- Broadcast-style lower third with neon green accent line
- Flair badge overlay (top-left with live indicator)
- Hook text (first 4 seconds, centred with backdrop)
- Brand watermark (bottom-right, subtle)
- Fallback to single-image mode if multi-image fails
- CRF 21 for higher quality, movflags +faststart for streaming

## Platform Upload Setup

### YouTube (required: OAuth2)

1. Create OAuth 2.0 Client at console.cloud.google.com
2. Download credentials → `tokens/youtube_credentials.json`
3. Run: `node upload_youtube.js auth` → visit URL
4. Run: `node upload_youtube.js token YOUR_CODE`

### TikTok (required: Developer App)

1. Register at developers.tiktok.com
2. Create app, request Content Posting API scope
3. Set `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET` in .env
4. Run: `node upload_tiktok.js auth` → visit URL → get code
5. Run: `node upload_tiktok.js token YOUR_CODE`

### Instagram (required: Facebook Graph API)

1. Create Facebook App at developers.facebook.com
2. Add Instagram Graph API, connect Business account
3. Set `INSTAGRAM_ACCESS_TOKEN` and `INSTAGRAM_BUSINESS_ACCOUNT_ID` in .env

## Content Pillars

- **Confirmed Drop** — Verified flair, hard facts only
- **Source Breakdown** — Highly Likely flair, cite sources
- **Rumour Watch** — Rumour flair, heavy use of "reportedly" / "sources suggest"

## Environment Variables

All stored in `.env`, never committed:

- `ANTHROPIC_API_KEY`
- `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`
- `RAILWAY_PUBLIC_URL`
- `AMAZON_AFFILIATE_TAG`
- `DISCORD_WEBHOOK_URL`
- `AUTO_PUBLISH` (true/false) — gates automatic multi-platform uploading
- `INCLUDE_RUMOURS` (true/false)
- `STAGGER_UPLOADS` (true/false, default true) — 60min gaps between platforms
- `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI`
- `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_BUSINESS_ACCOUNT_ID`
- `YOUTUBE_API_KEY` (stats fetching + B-roll trailer search fallback)
- `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` (optional - enables IGDB B-roll fallback for console exclusives; free signup at dev.twitch.tv)
- `BROLL_YOUTUBE_FALLBACK` (true/false, default false) - opts into YouTube trailer download via yt-dlp when Steam + IGDB both miss; higher copyright-strike risk than Steam/IGDB
- `FACEBOOK_PAGE_ID`, `FACEBOOK_PAGE_TOKEN`
- `TWITTER_API_KEY`, `TWITTER_API_SECRET`, `TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_SECRET`
- `STACKED_VOICE_ID` (ElevenLabs voice for STACKED channel)
- `SIGNAL_VOICE_ID` (ElevenLabs voice for THE SIGNAL channel)
- `CHANNEL` (active channel: pulse-gaming | stacked | the-signal)
- `PORT` (default 3001)

## Pipeline Modes

```
node run.js hunt      — Multi-source fetch (Reddit + RSS) + script generation
node run.js produce   — Affiliates + audio + professional images + video assembly
node run.js publish   — Upload to YouTube + TikTok + Instagram (staggered)
node run.js full      — Complete autonomous cycle (hunt → approve → produce → publish)
node run.js approve   — Run auto-approval pass only
node run.js schedule  — Start autonomous cron scheduler (24/7 operation)
node server.js        — Dashboard + API + built-in autonomous scheduler
```

## Hard Stops

- Never publish unverified information as fact
- Never commit .env, API keys or tokens/
- AUTO_PUBLISH=true required for automatic uploads (safety gate)
- Never use advertiser-unfriendly language in titles/descriptions
- Always validate script word count before accepting
- Always check for missing audio/image before assembly
