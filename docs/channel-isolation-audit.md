# Channel Isolation Audit — 2026-04-21

## TL;DR

**Pulse Gaming today is implicitly single-channel.** The channel
identity is resolved at process start via `process.env.CHANNEL`
(default `pulse-gaming`) by [`channels/index.js`](../channels/index.js).
Every hunter/processor/publisher run inherits that one value.

`channel_id` is a column on **`platform_posts`**, **`derivatives`**, and
**`audio_packs`** — but it is **not** a column on the `stories` table
itself. A story has no durable channel attribution; the channel is
inferred from the env var of whichever process happens to be reading
or writing the row.

That is fine for a single-process Pulse-only deployment. It will
silently leak the moment a second channel is run against the same
SQLite database.

This audit lists exactly where cross-channel leakage could happen,
what the smallest safe migration looks like, and the task order to
launch a second channel without breaking Pulse.

**Scope of this commit:** documentation only. No code changes.

---

## Where channel context lives today

| Surface                                                        | Has `channel_id`?                                    | How channel is chosen                                                          |
| -------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------ | --- | --------------- |
| `stories` table ([db.js:193](../lib/db.js))                    | ❌ no column                                         | implicit via `process.env.CHANNEL`                                             |
| `STORIES_COLUMNS` set ([db.js:329](../lib/db.js))              | ❌ no entry                                          | n/a                                                                            |
| `platform_posts` table                                         | ✅ column exists                                     | resolved at write time in publisher                                            |
| `derivatives` table                                            | ✅ column exists                                     | passed into the upsert                                                         |
| `audio_packs` table                                            | ✅ column exists; queried via `WHERE channel_id = ?` | `audio-identity.js::resolve()`                                                 |
| `jobs` table                                                   | ❌ no column                                         | jobs are channel-agnostic; the worker process determines what they actually do |
| `schedules` table                                              | ❌ no column                                         | one schedule list, one process                                                 |
| `roundups` table                                               | ✅ column exists                                     | passed in from job handler                                                     |
| Channel registry ([`channels/index.js`](../channels/index.js)) | n/a                                                  | `getChannel(id)` defaults to `process.env.CHANNEL                              |     | 'pulse-gaming'` |

`getChannel()` is the canonical accessor. It's called from
[`hunter.js:760`](../hunter.js), [`processor.js`](../processor.js), all
three uploaders, [`audio-identity.js`](../lib/audio-identity.js), and
the dashboard's frontend (via the brand resolver).

---

## Cross-channel leakage scenarios (today)

If a second channel is started against the **same `/data/pulse.db`**
without a code change, the following silently break:

1. **Stories from one channel get processed by another.**
   `stories` rows have no `channel_id`. `produce()` simply queries
   `WHERE approved AND NOT exported_path`. A `stacked` (finance)
   story would be picked up by a `pulse-gaming` (gaming) produce
   run, generating a gaming-flavoured video for a finance topic.

2. **Audio identity resolves to the wrong pack.**
   `audio-identity.js::resolve()` is keyed on `channelId` _passed in
   by the caller_. The caller is `assemble.js`, which calls
   `getChannel()`, which reads `process.env.CHANNEL`. If two
   processes write to the same DB with different env values, the
   pack lookup returns the requesting process's pack — but the
   story might "belong" to the other channel. There's no
   cross-check.

3. **Platform credentials resolve from env, not story.**
   YouTube / TikTok / Instagram / Facebook tokens come from env
   vars (`TIKTOK_TOKEN_PATH`, `INSTAGRAM_ACCESS_TOKEN`, etc.).
   With one process, env determines channel determines tokens.
   With multiple processes against one DB, a publish job for a
   story originally hunted under `stacked` could grab pulse-gaming
   tokens because the running process sees `process.env.CHANNEL=
pulse-gaming`.

4. **Discord routing.**
   `notify.js` posts to a single `DISCORD_WEBHOOK_URL` from env.
   No per-channel webhook. A `stacked` publish summary would land
   in the Pulse-Gaming Discord (or vice versa).

5. **Dashboard shows everything.**
   `/api/news/full` returns all stories. There's no
   `?channel=` filter, no UI tab per channel, no isolation. An
   operator on the Pulse dashboard would see Stacked drafts.

6. **`platform_posts` already keyed correctly — but the join is
   weak.** The dedupe / "already-published" lookup in publisher.js
   uses the `platform_posts.channel_id` field, but only when it
   knows what the story's channel is. With no `stories.channel_id`,
   that lookup falls back to `process.env.CHANNEL`, which means
   the dedupe is per-process not per-story.

---

## Smallest viable migration to multi-channel

Each step below is independently shippable and tested. None should
be done overnight.

### Step 1 — `stories.channel_id` column + backfill (1 PR)

- Add `channel_id TEXT NOT NULL DEFAULT 'pulse-gaming'` to the
  `stories` schema in `db.js`.
- Add `channel_id` to `STORIES_COLUMNS`.
- Add an index `idx_stories_channel ON stories(channel_id)`.
- Migration script backfills existing rows with `'pulse-gaming'`
  (current implicit value).
- Tests:
  - `STORIES_COLUMNS` includes `channel_id`
  - `storyToRow({...story, channel_id: 'stacked'})` round-trips
  - Default value applied when the field is absent on insert

This is the entry point for everything else. **Without this, no
other isolation step works.**

### Step 2 — populate `channel_id` at hunt time (1 PR)

- `hunter.js` calls `getChannel().id` and stamps it on every story
  it creates.
- All in-flight stories at deploy time keep their backfilled
  `'pulse-gaming'` value.
- Tests confirm new stories arrive with the env's channel.

### Step 3 — gate produce/publish queries by channel (1 PR)

- `assemble.js`, `audio.js`, `images.js`, `images_story.js`,
  `entities.js`, `publisher.js::publishNextStory`,
  `engagement.js` — every `db.getStories()` followed by a `filter`
  must additionally require `s.channel_id === getChannel().id`.
- Add a tiny `db.getStoriesForChannel(id)` helper so the contract
  is in one place.
- Tests confirm one channel's process can't pick up another
  channel's story.

### Step 4 — per-channel platform credentials (1 PR)

- Move credential resolution into `channels/{id}.js` instead of
  raw env reads. e.g. `channel.tokens.tiktokPath` instead of
  `process.env.TIKTOK_TOKEN_PATH`.
- Each channel declares its own token paths and env vars.
- Default values keep Pulse working without changes.
- Tests confirm `getChannel('stacked').tokens.youtubeRefreshToken`
  ≠ `getChannel('pulse-gaming').tokens.youtubeRefreshToken`.

### Step 5 — per-channel Discord webhook (small PR)

- `channels/{id}.js` declares `discordWebhookUrl`.
- `notify.js` accepts an optional channel parameter and looks up
  the right webhook.
- Default falls back to `process.env.DISCORD_WEBHOOK_URL`.

### Step 6 — dashboard channel filter (1 PR)

- `/api/news/full` accepts `?channel=<id>` and filters server-side.
- Frontend adds a channel switcher in Navbar.
- localStorage remembers the operator's last-selected channel.
- Public `/api/news` already only emits live stories — those can
  stay channel-agnostic on the public feed if you want all
  channels' published content visible at one URL, or split by
  subdomain. Either is fine; see Roadmap doc for the call.

### Step 7 — per-channel scheduler rows (small PR, optional)

- `schedules` table gains `channel_id`.
- `DEFAULT_SCHEDULES` in `lib/scheduler.js` becomes a function
  returning rows for each enabled channel.
- Allows per-channel produce/publish timing differences.

---

## Task order before launching a second channel

1. **Step 1 (column + backfill)** — must ship and bake in prod for
   at least one full produce/publish cycle to confirm no
   regressions on the Pulse pipeline.
2. **Step 2 (populate at hunt)** — ship next, watch new stories
   arrive with the right channel id.
3. **Step 3 (gate queries)** — ship third. After this lands, the
   pipeline is genuinely channel-aware. Pulse keeps working
   identically because every legitimate caller is `pulse-gaming`.
4. Only **after** steps 1–3 are stable for ~48h, configure the
   second channel's env (`CHANNEL=stacked`) on a separate Railway
   service pointing at the same DB.
5. Step 4 and 5 land before that second-channel service does its
   first publish.
6. Step 6 lands when the dashboard needs to show two channels.
7. Step 7 only if the timing windows differ between channels.

**Rollback plan:** every step keeps the existing Pulse behaviour
behind a default `'pulse-gaming'` value. A single revert undoes
each step independently. A nuclear rollback (drop `channel_id`
column) is reversible because the JSON mirror in `daily_news.json`
still exists as a backup of the canonical state.

---

## Why nothing was changed in this commit

The brief said: _"If and only if there is a tiny obvious bug — e.g.
channel_id exists in schema but is missing from STORIES_COLUMNS —
add it. Add tests. Commit separately."_

The actual finding is the opposite of the example:
**`channel_id` is missing from BOTH the schema and `STORIES_COLUMNS`**.
Adding it is a real migration with a backfill, not a one-line fix.
That belongs in its own PR with its own review and its own
production-bake window before the second channel ships.

So per the brief, this audit lands as documentation only.

---

## Related references

- [`channels/index.js`](../channels/index.js) — channel registry + `getChannel()`
- [`lib/db.js:193`](../lib/db.js) — base `stories` schema
- [`lib/db.js:329`](../lib/db.js) — `STORIES_COLUMNS` whitelist
- [`lib/audio-identity.js`](../lib/audio-identity.js) — channel-scoped audio resolution (the model to copy elsewhere)
- [`lib/repositories/platform_posts.js`](../lib/repositories/platform_posts.js) — example of a channel-aware repository
- [`docs/multi-channel-roadmap.md`](./multi-channel-roadmap.md) — the broader roadmap (separate doc, written this same day)
