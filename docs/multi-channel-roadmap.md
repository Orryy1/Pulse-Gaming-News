# Multi-Channel Roadmap

**Status:** design only — no broad implementation work.
**Related:** [`docs/channel-isolation-audit.md`](./channel-isolation-audit.md) (the technical audit) is this doc's companion. Read that first for the "what's broken today" list; read this for the "how we get to multi-channel in production".

---

## Starting position (2026-04-21)

Pulse Gaming is a **single-channel** news-shorts pipeline. It runs one hunt/produce/publish cycle per day across four platforms (YouTube, TikTok, Instagram, Facebook).

The codebase already has **the outlines** of multi-channel:

- `channels/` directory with `pulse-gaming.js`, `stacked.js`, `the-signal.js`.
- `CHANNEL` env var picks one at process start.
- `audio_packs`, `platform_posts`, `derivatives`, `roundups` tables all have a `channel_id` column.
- Per-channel hashtags, music prompts, and brand palettes live in the channel registry files.

But the outlines are aspirational, not working. Running a second process against the same DB today causes cross-contamination. Full breakdown in [`channel-isolation-audit.md`](./channel-isolation-audit.md).

---

## Target state

Two or three channels run in parallel. Each has:

- Its own niche, tone, brand palette, music identity.
- Its own YouTube / TikTok / Instagram / Facebook credentials.
- Its own Discord webhook (success/failure routing).
- Its own Railway service (or subdomain) hitting a shared SQLite DB, with channel-scoped writes and reads.
- Its own publish window schedule (may overlap, may not — finance-channel sweet spots aren't gaming-channel sweet spots).
- Its own dashboard view (operator picks which channel to operate on).

The three registered channel slugs today — and their first-pass niche fit — suggest the order of rollout:

| Slug           | Niche                                     | State              |
| -------------- | ----------------------------------------- | ------------------ |
| `pulse-gaming` | Gaming news (confirmed / leaks / rumours) | Live in production |
| `stacked`      | Finance news                              | Outlined, unused   |
| `the-signal`   | Tech news                                 | Outlined, unused   |

---

## Required schema changes

One migration, applied before any multi-channel logic lands. Adds the missing `channel_id` columns + indexes + backfill:

```sql
-- Migration 014 (indicative; exact number TBD at implementation time)
ALTER TABLE stories
  ADD COLUMN channel_id TEXT NOT NULL DEFAULT 'pulse-gaming';
CREATE INDEX idx_stories_channel ON stories(channel_id);

-- Analytics snapshots already have story_id; inherit channel_id via join.
-- breaking_log also gains a channel_id for per-channel breaking feeds.
ALTER TABLE breaking_log
  ADD COLUMN channel_id TEXT NOT NULL DEFAULT 'pulse-gaming';
CREATE INDEX idx_breaking_log_channel ON breaking_log(channel_id);

-- jobs table: stays channel-agnostic. The worker process determines
-- which channel handles the job via process.env.CHANNEL.
```

Backfill uses the implicit current channel (`'pulse-gaming'`) so Pulse keeps working unchanged. See [`channel-isolation-audit.md`](./channel-isolation-audit.md) Step 1 for the PR-sized breakdown.

---

## Required code changes (in rollout order)

### 1. Channel-scoped stories (see audit Step 1–3)

Add `channel_id` to `STORIES_COLUMNS`, stamp it at hunt time, filter every `db.getStories()` read by channel. Tests required at each step.

### 2. Channel-scoped credentials

Move platform credential resolution from "read env var" to "`getChannel(id).tokens.<platform>`". Each channel's file declares:

```js
// channels/stacked.js (illustrative)
module.exports = {
  id: "stacked",
  name: "STACKED",
  tokens: {
    youtubeRefreshToken: process.env.STACKED_YT_REFRESH_TOKEN,
    tiktokTokenPath: process.env.STACKED_TIKTOK_TOKEN_PATH,
    instagramAccessToken: process.env.STACKED_INSTAGRAM_TOKEN,
    // etc.
  },
  // ... existing brand / voice / hashtag fields
};
```

All four uploaders (`upload_youtube.js`, `upload_tiktok.js`, `upload_instagram.js`, `upload_facebook.js`) swap their env reads for `getChannel(story.channel_id).tokens.X`. Default falls back to `process.env.<PLATFORM>_*` so Pulse-Gaming keeps working without env changes.

### 3. Channel-scoped sources

Each channel's file already declares its `sources` (subreddits, RSS feeds). Confirm `hunter.js` only iterates `getChannel().sources` (it does today — verified in audit).

No behaviour change for Pulse Gaming.

### 4. Channel-scoped scoring config

`lib/scoring.js` weights and thresholds should come from the channel registry, not hardcoded. Each channel declares its own:

```js
// channels/stacked.js
scoring: {
  baseScoreWeight: { breaking: 0.4, source: 0.2, recency: 0.4 },
  thresholds: { autoApprove: 75, deferToReview: 50, reject: 25 },
  hardStops: [/* channel-specific rejection rules */],
},
```

Defaults match today's Pulse values. Stacked and Signal get their own values tuned after their first week.

### 5. Channel-scoped branding/audio/image packs

Already mostly in place:

- `brand.js` reads from `channels/<id>/brand.js`.
- `audio-identity.js` pulls packs via `channel_id` filter.
- `images_story.js` SVG templates read channel colours via `brand.PRIMARY`.

Outstanding work: ensure `images_download.js` doesn't leak channel-agnostic generic image cache between channels. Cache keyed on `story.id` is already per-story, so per-channel isolation is automatic — but worth asserting in tests.

### 6. Dashboard filtering

`/api/news/full` gains `?channel=<id>`. Frontend Navbar gets a channel picker. See audit Step 6 for details.

### 7. Per-channel scheduler rows

`DEFAULT_SCHEDULES` in `lib/scheduler.js` becomes a function that expands per enabled channel. Each channel declares its own publish window:

```js
// channels/stacked.js
schedule: { produce: '0 16 * * *', publish: '0 17 * * *' }, // finance hours earlier
```

---

## Safe migration plan from Pulse-only to multi-channel

**Golden rule:** every step below must keep Pulse Gaming working identically when Pulse-Gaming is the only enabled channel. Every step is individually rollbackable.

### Phase A — Schema (no behaviour change)

1. Migration 014: `stories.channel_id` + `breaking_log.channel_id` with default `'pulse-gaming'`.
2. `STORIES_COLUMNS` updated.
3. Backfill runs on deploy.
4. **Bake for at least one full 24h produce/publish cycle.** Verify no Pulse regression.

### Phase B — Stamp at write time

5. `hunter.js` writes `channel_id: getChannel().id` on every new story.
6. Verify new Pulse stories have `channel_id = 'pulse-gaming'`.
7. Bake 24h.

### Phase C — Filter at read time

8. All `db.getStories()` callers get a `channel_id` filter.
9. Verify Pulse produce/publish still picks up Pulse-only stories.
10. Bake 24h.

### Phase D — Channel-scoped credentials

11. Uploader credential lookups go through `getChannel(story.channel_id).tokens.*`.
12. Pulse's env-based defaults still work.
13. Bake 24h.

### Phase E — Pilot second channel

14. Pick first-candidate second channel (recommendation: **`stacked` / finance**, see below).
15. Provision channel-specific tokens (fresh OAuth for each platform's finance account).
16. Deploy a **second Railway service** with `CHANNEL=stacked` pointing at the same `/data/pulse.db`.
17. First publish is operator-initiated, not scheduled. Dashboard picker used to approve.
18. If healthy for 48h, enable the scheduler for stacked.

### Phase F — Dashboard, scheduler, observability

19. Dashboard channel picker.
20. Per-channel scheduler rows.
21. Discord webhooks per channel.

### Rollback plan

- Any phase → revert the commit; existing rows keep default `'pulse-gaming'` so Pulse keeps working.
- Nuclear: disable Stacked service, let Pulse continue. The shared DB has a `channel_id` column that's harmlessly populated but unused.
- Full schema revert: drop `channel_id` column. Only needed if the column itself caused issues (no known case). JSON mirror in `daily_news.json` still exists as a pre-column backup.

---

## First candidate: `stacked` (finance)

Recommend Stacked over Signal as the first second channel.

**Why Stacked first:**

1. Finance advertisers pay higher CPMs than tech — better growth ROI for the time invested in setting up the pipeline.
2. Finance news has extremely clear verification lines (earnings reports, SEC filings, company press releases) — mirrors gaming's Verified / Rumour structure well.
3. Stacked's channel file is already partly wired with voice + brand palette + music identity assets under `channels/stacked/`.
4. The finance RSS/Reddit source pool is narrow and high-signal — less hunter scope bloat during the pilot.

**Why NOT Signal first:**

- Tech news overlaps heavily with gaming (GPUs, consoles, platforms) — cross-channel cannibalisation risk.
- Tech audience behaviour is more segmented by sub-niche; harder to land a first week of consistent wins.

Once Stacked has 4 weeks of clean data and feedback-loop signals (see [`analytics-feedback-loop.md`](./analytics-feedback-loop.md)), Signal becomes the third channel.

---

## What MUST stay single-channel forever

1. **The publish-deduplication logic.** Dedupe is keyed on canonical URL hash + title similarity. If a news story ran on both Pulse (gaming angle) and Signal (tech angle) the same day, that's NOT a duplicate — it's two legitimate stories. Dedupe must stay **scoped per channel**. Easy to get wrong.
2. **Scoring hard-stops** (advertiser-unfriendly language, self-harm mentions, political figures). Those are YouTube policy boundaries that apply to every channel. They belong in a shared `lib/hard-stops.js`, not the per-channel config.
3. **The TikTok OAuth callback route.** `/auth/tiktok` is one route for the single Railway public URL. Each channel brings its own TikTok app + token path, but the OAuth redirect URI is shared. Callback handler reads `state` to pick the channel (once state gains channel attribution — see [`oauth-state.js`](../lib/oauth-state.js) — currently binds to provider only).

---

## Open product decisions (not engineering)

- **Domain strategy.** One Railway deployment with `?channel=` routing, or per-channel subdomains (`gaming.example.com`, `stacked.example.com`)? Affects how public `/api/news` is served + how Google understands the channels. Recommend subdomains post-launch; single deployment during pilot.
- **Brand attribution on social posts.** Does Stacked content say "by Stacked" or does it reveal a parent entity? Product call; affects `pinned_comment` templates and description tails.
- **Cross-promotion windows.** Can a Stacked video reference a Pulse Gaming video? If yes, dedupe + rate-limiting changes shape.

---

## Open engineering decisions

- **Shared DB or split DBs?** Shared is simpler for now. Split per channel is cleaner long-term but means each channel owns its own SQLite file + `/data` volume. Recommend shared through Phase E; revisit at Phase F if the DB gets too contended.
- **Worker process model.** Today jobs-runner runs in the server process. Multi-channel under one process is possible (worker inspects `job.payload.channel_id`) but I'd recommend one Railway service per channel for isolation, particularly for the publish path — a runaway produce cycle in one channel shouldn't starve another's publish window.
- **Rate-limit sharing.** `rateLimitMap` in server.js is per-process. Under per-service deployment, each channel gets its own rate limit budget — good for isolation but means there's no cross-channel abuse-prevention. Consider whether that matters.

---

## References

- [`channel-isolation-audit.md`](./channel-isolation-audit.md) — the technical "what's broken" doc
- [`analytics-feedback-loop.md`](./analytics-feedback-loop.md) — feedback-loop design that must stay channel-scoped
- `channels/` directory — existing channel definitions
- [`docs/dependency-audit.md`](./dependency-audit.md) — no multi-channel-specific dep concerns today
