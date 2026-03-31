# Pulse Gaming — AI News Shorts Empire v3

## Overview
Multi-channel autonomous pipeline that hunts Reddit + RSS feeds for verified news, generates YouTube Shorts scripts via Claude, produces professional audio/image/video assets with real images, branded bumpers and broadcast overlays, and auto-publishes to 5 platforms (YouTube Shorts, TikTok, Instagram Reels, Facebook Reels, X/Twitter) at research-backed optimal times. Supports multiple channels via the `channels/` config system.

## Multi-Channel Architecture
Channel configs live in `channels/`. Each channel defines: brand palette, voice settings, content sources, classification system, system prompt and YouTube category. Set `CHANNEL=stacked` env var to switch channels.

| Channel | Niche | Palette | Voice |
|---------|-------|---------|-------|
| `pulse-gaming` (default) | Gaming | Amber `#FF6B1A` | Male (pNInz6obpgDQGcFmaJgB) |
| `stacked` | Finance | Green `#00C853` | Male deeper (ErXwobaYiN019PkySvjV) |
| `the-signal` | Tech | Purple `#A855F7` | Female (EXAVITQu4vr4xnSDxMaL) |

## Cardinal Rules
- British English throughout. No serial/Oxford comma.
- Verified sources only — never present rumours as fact without flagging.
- Amazon affiliate tag must appear on every product link.
- Burner identity protection — no personal details in any public-facing output.
- Monetisation safety — avoid advertiser-unfriendly language in all outputs.

## Tech Stack
- **Runtime:** Node.js (CommonJS)
- **News Sources:** Reddit public JSON API (8 subreddits) + 8 RSS feeds (IGN, GameSpot, Eurogamer, etc.)
- **AI Scripts:** Anthropic SDK (claude-haiku-4-5-20251001)
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
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/news | Returns daily_news.json array |
| GET | /api/health | Server status + autonomous mode info |
| POST | /api/approve | Body: { id } — marks story approved |
| POST | /api/publish | Spawns produce pipeline |
| GET | /api/publish-status | Returns { status } |
| GET | /api/download/:id | Streams exported MP4 |
| POST | /api/generate-image | Queues image generation |
| POST | /api/generate-video | Queues video generation |
| GET | /api/stats/:postId | YouTube/TikTok view count |
| POST | /api/autonomous/run | Trigger full autonomous cycle |
| POST | /api/autonomous/approve | Run auto-approval pass |
| POST | /api/autonomous/publish | Multi-platform upload |
| GET | /api/autonomous/status | Schedule + platform config |
| GET | /api/platforms/status | OAuth status per platform |
| GET | /api/hunter/status | Hunter active/last/next run |
| POST | /api/hunter/run | Trigger immediate hunt |

## Autonomous Schedule (all times UTC)
| Time | Action |
|------|--------|
| 06:00 | Morning hunt — catches overnight US Reddit leaks |
| 10:00 | Mid-morning hunt — review embargo lifts (9AM-12PM ET) |
| 14:00 | Afternoon hunt — Nintendo Direct window (2PM GMT) |
| 17:00 | Evening hunt — Xbox showcase + US morning embargoes |
| 18:00 | Produce cycle — audio + professional images + video assembly |
| 19:00 | YouTube Shorts upload — peak engagement (7PM GMT = 2PM ET) |
| 20:00 | TikTok upload — staggered 1hr after YouTube |
| 21:00 | Instagram Reels upload — staggered 1hr after TikTok |
| 22:00 | Late hunt — PlayStation State of Play window |

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
- `YOUTUBE_API_KEY` (for stats fetching only; upload uses OAuth)
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
