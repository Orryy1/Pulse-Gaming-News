# Pulse cloud factory

A single cloud service that produces one premium gaming-news Short a day and publishes it to YouTube with no machine of yours involved.

```
RSS (official newsrooms + outlets)
  → cluster + score + corroborate        (official source, or two independent outlets)
  → Claude picks the story
  → Claude writes the script              (hook, fact beats, the Pulse take, loop line)
  → Claude fact-checks it against the source articles   (fails twice → dropped)
  → ElevenLabs narration with timestamps  (word timings for captions, no Whisper)
  → official Steam store art / first-party press images  (provenance stored)
  → Remotion render, 1080×1920            (motion graphics, word-by-word captions, music bed)
  → loudness to −14 LUFS → ffprobe QA → Claude vision QA on sampled frames
  → Discord: poster + preview + Approve / Reject links
  → YouTube resumable upload              (never uploads the same episode twice)
  → Discord: published link
```

Everything lives in one Postgres `episodes` table. Each step writes its output before the status moves, so a crash at any point resumes at that step.

## How "fully autonomous" works here

`APPROVAL_MODE` decides how much of you it needs:

| Mode | Behaviour |
|---|---|
| `timeout` (default) | Posts the Short to Discord and **publishes automatically after `APPROVAL_TIMEOUT_MINUTES`** unless you tap Reject. Rumour stories always wait for a human. |
| `manual` | Waits for your Approve tap. |
| `auto` | Publishes as soon as QA passes. Discord still gets a copy. |

`timeout` gives a zero-touch daily output with a veto window. YouTube's 2025–2026 "inauthentic / generic or repetitive content" rules are the real risk to monetisation, so every script must carry a Pulse take (context, comparison or a clearly framed opinion). The fact-checker rejects anything the sources don't support.

## One-time setup (all in a browser)

1. **Railway**: create a new project → *Deploy from GitHub repo* → this repo → set **Root Directory** to `cloud`. Add a **Postgres** database, and a **Volume** mounted at `/data`. Under *Networking*, generate a public domain.
2. **Anthropic**: create an API key at console.anthropic.com.
3. **ElevenLabs**: Creator plan or higher. A Professional Voice Clone of your own voice is the strongest choice for authenticity. Copy the voice ID.
4. **Discord**: in your server, *Channel settings → Integrations → Webhooks → New webhook*, then copy the URL.
5. **Google Cloud** (console.cloud.google.com), using a new project:
   - Enable **YouTube Data API v3**.
   - On the *OAuth consent screen*, choose External and add the three scopes below, then click **Publish app / In production**. Do this *before* connecting, because tokens minted while the app is in "Testing" expire after 7 days.
   - Under *Credentials → Create OAuth client ID → Web application*, add the authorised redirect URI `https://<your-railway-domain>/oauth/callback`.
   - Submit the **YouTube API Services audit / quota extension form** in week 1. Approval can take weeks.
6. **Railway variables**: copy everything from `.env.example`. Set `DATABASE_URL=${{Postgres.DATABASE_URL}}`, plus long random `APP_SECRET` and `ADMIN_TOKEN` values. For the first run, set `YOUTUBE_PRIVACY=unlisted`.
7. **Connect YouTube**: open `https://<your-railway-domain>/oauth/start?key=<ADMIN_TOKEN>` and sign in as the channel. The refresh token is stored encrypted in Postgres.
8. **First run**: leave `DRY_RUN=true` for a day to watch the Discord posts, then switch it off. Once the first unlisted upload looks right, set `YOUTUBE_PRIVACY=public`.

Scopes: `youtube.force-ssl`, `youtube.upload`, `yt-analytics.readonly`.

## Operating it

- **Dashboard**: `https://<domain>/episodes?key=<ADMIN_TOKEN>` lists recent episodes, their status and errors.
- **Health**: `GET /health` is used by Railway's health check. Set `HEALTHCHECK_PING_URL` (healthchecks.io) for an external dead-man's switch. The service also posts to Discord if nothing has published in 26 hours.
- **Force a run**: `POST /tick?key=<ADMIN_TOKEN>`.
- **Railway shell**: `npm run cli -- episodes`, `npm run cli -- discover`, `npm run cli -- retry <id>`.
- **More Shorts**: `DAILY_TARGET=2` and `MIN_GAP_HOURS`. Stay at 1 a day until retention is consistently at or above your channel median. Volume is the pattern YouTube's spam systems look for.

## Rules the code enforces (not just the prompt)

- A story needs an official source or two independent outlets. Otherwise it is a rumour, which is off unless `INCLUDE_RUMOURS=true`, always labelled on screen and never auto-approved.
- Fact-check blockers trigger one rewrite. A second failure drops the story before any narration is paid for.
- House style is checked deterministically: British spelling, no serial comma, banned openers and calls to action, 70–115 spoken words, short on-screen text.
- Visuals are original motion graphics plus publisher-supplied store art and first-party press images, each stored with its source URL. No footage, no outlet photographs and nothing leaked.
- `containsSyntheticMedia` is `false`: narration over graphics, with no realistic synthetic people or events.
- Uploads persist the resumable session before sending bytes and tag the video with a private marker. After any ambiguous failure, the next attempt searches the channel and adopts the existing video instead of uploading again.
- `invalid_grant`, quota and policy errors stop the episode and alert Discord. They are never retried blindly.

## Cost (1 Short a day)

Railway compute and Postgres, about $10–25. ElevenLabs Creator, $22. Claude (selection, script, fact-check and vision QA), a few dollars. That comes to roughly $40–55 a month.

## Development

```
npm ci
npm run typecheck
npm test            # pipeline, upload safety, approvals, units (PGlite, no network)
npm run studio      # Remotion Studio to iterate on the look
```

Brand files are in `public/`: the logo, four music beds carried over from the main repo's `audio/mastered/` and the OFL fonts Anton and Inter.

## Not built yet

- A YouTube Analytics pull, to feed hook and topic choice from your own retention data.
- Story-type layout variety beyond the current colour and card system (for example, dedicated price-comparison and versus layouts).
- TikTok and Instagram cross-posting.
- A weekly long-form roundup.
