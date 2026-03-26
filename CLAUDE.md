# Pulse Gaming — AI Gaming News Pipeline

## Overview
Automated pipeline that hunts Reddit for verified gaming leaks, generates YouTube Shorts scripts via Claude, produces audio/image/video assets, and manages everything through a React dashboard.

## Cardinal Rules
- British English throughout. No serial/Oxford comma.
- Verified sources only — never present rumours as fact without flagging.
- Amazon affiliate tag must appear on every product link.
- Burner identity protection — no personal details in any public-facing output.
- Monetisation safety — avoid advertiser-unfriendly language in all outputs.

## Tech Stack
- **Runtime:** Node.js (CommonJS)
- **Reddit:** snoowrap
- **AI Scripts:** Anthropic SDK (claude-haiku-4-5-20251001)
- **TTS:** ElevenLabs API (eleven_multilingual_v2)
- **Images:** Stability AI (SDXL 1.0)
- **Video Assembly:** FFmpeg (libx264, aac, 1080x1920, 30fps)
- **Server:** Express + CORS
- **Dashboard:** React 18 via CDN + Tailwind CSS
- **Scheduling:** node-cron
- **Notifications:** Discord webhooks

## Story Object Schema
```json
{
  "id": "string — Reddit post ID",
  "title": "string",
  "url": "string",
  "score": "number — Reddit upvotes",
  "flair": "string — Verified | Highly Likely | Rumour",
  "subreddit": "string",
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
  "audio_path": "string — output/audio/{id}.mp3",
  "image_path": "string — output/images/{id}.png",
  "exported_path": "string — output/final/{id}.mp4"
}
```

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/news | Returns daily_news.json array |
| POST | /api/approve | Body: { id } — marks story approved |
| POST | /api/publish | Spawns produce pipeline |
| GET | /api/publish-status | Returns { status } |
| GET | /api/download/:id | Streams exported MP4 |
| POST | /api/generate-image | Queues image generation |
| POST | /api/generate-video | Queues video generation |
| GET | /api/stats/:youtube_post_id | Placeholder stats endpoint |

## Script Format Contract
- **Hook (0-3s):** One punchy sentence. Never starts with: So, Today, Hey, Welcome, In this.
- **Body (3-45s):** Short declarative sentences, British English, no filler.
- **Loop (45-50s):** Curiosity or callback to hook. Never says "let me know in the comments".
- **Word count:** 120-150 words (130-140 target for 50s at natural pace).
- **Validation:** Retry once if validation fails, then accept with warning.

## FFmpeg Assembly Spec
```
ffmpeg -y
  -loop 1 -i {image}
  -i {audio}
  -filter_complex "[0:v]scale=1080:1920,zoompan=z='min(zoom+0.0001,1.05)':d=1:s=1080x1920:fps=30,
    drawtext=text='{title}':fontsize=44:fontcolor=#39FF14:x=(w-text_w)/2:y=80,
    drawtext=text='{hook}':fontsize=52:fontcolor=white:x=(w-text_w)/2:y=h-200:enable='lt(t,3)':box=1:boxcolor=black@0.6[outv]"
  -map "[outv]" -map 1:a
  -c:v libx264 -crf 23 -c:a aac -b:a 192k -r 30 -shortest
  output/final/{id}.mp4
```

## Content Pillars
- **Confirmed Drop** — Verified flair, hard facts only
- **Source Breakdown** — Highly Likely flair, cite sources
- **Rumour Watch** — Rumour flair, heavy use of "reportedly" / "sources suggest"

## Environment Variables
All stored in `.env`, never committed:
- `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USERNAME`, `REDDIT_PASSWORD`, `REDDIT_USER_AGENT`
- `ANTHROPIC_API_KEY`
- `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`
- `STABILITY_API_KEY`
- `RAILWAY_PUBLIC_URL`
- `AMAZON_AFFILIATE_TAG`
- `DISCORD_WEBHOOK_URL`
- `AUTO_PUBLISH` (true/false)
- `INCLUDE_RUMOURS` (true/false)
- `PORT` (default 3001)

## Pipeline Modes
```
node run.js hunt     — Reddit fetch + script generation
node run.js produce  — Affiliates + audio + images + assembly
node run.js schedule — Cron: hunt at 06:00 daily
node server.js       — Dashboard + API on PORT
```

## Hard Stops
- Never publish unverified information as fact
- Never commit .env or API keys
- Never auto-publish without explicit approval (AUTO_PUBLISH gate)
- Never use advertiser-unfriendly language in titles/descriptions
- Always validate script word count before accepting
- Always check for missing audio/image before assembly
