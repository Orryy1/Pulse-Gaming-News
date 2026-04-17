# Phase 3 (Phase C) — JSON → SQLite Read/Write Map

**Purpose:** ground truth for every remaining file that still touches
`daily_news.json`, `pending_news.json`, `image_queue.json`,
`video_queue.json`, `analytics_history.json` directly. Each callsite is
categorised so the Phase 3B/C/D patches know exactly what to migrate
next and what to leave as a compatibility shim.

Baseline: `hardening/cutover @ 5487a70` (post Phase 2C shadow logging,
before any Phase 3 writes).

**Legend:**

- **live-critical**: reads drive user-facing behaviour or writes mutate canonical state. Migrate to repo-backed SQLite.
- **dual-write-ok**: writeNews or equivalent already dual-writes. Reads need checking; writes can stay.
- **debug/export**: JSON output is the intended artefact (diagnostic, archive). Leave as-is.
- **dead**: file is not in a production code path. Remove on sight.
- **done**: already migrated in Phase 3A.

---

## daily_news.json — 53-file surface, concrete callsites

### ✅ done (Phase 3A, commit pending this doc)

| File        | Line(s)                                      | Notes                                                                                                                                                                                                                                     |
| ----------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server.js` | 441-457 (readNews), 447-457 (writeNews)      | **DONE 3A.** `readNews()` now uses `db.getStoriesSync()` when `USE_SQLITE=true`. Falls back to file read on any error. `writeNews()` already dual-wrote to SQLite, so writes were never the divergence point — the fix was the read side. |
| `lib/db.js` | 448-458 (jsonGet/jsonSave), 425-475, 497-536 | **library, not a leaf callsite.** All repo-level reads/writes go through here.                                                                                                                                                            |

### 🔴 live-critical — next to migrate (Phase 3B)

| File                 | Line(s)                      | Role                                                                                                                                                                                       | Blast radius                                                                                                                                                                   |
| -------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `discord_approve.js` | 154, 219, 232, 249, 283, 287 | Discord approval UI writes `approved=true` + image picks into `daily_news.json` directly. **Divergence with `/api/approve` on server.js** is exactly the failure class Phase A §3 flagged. | Every Discord-driven approval silently skips the SQLite dual-write path, so approvals made via Discord-but-not-dashboard do not appear in `readNews()` once it prefers SQLite. |
| `cloud.js`           | 102, 114, 125, 145, 149, 199 | Duplicate approval endpoints with the same pattern. `cloud.js` itself is dead-but-dangerous per Phase A §1 (not the Railway entrypoint today, but Dockerfile still points at it).          | If Docker ever ships, every approval hits JSON only — bypassing all Phase 2C shadow dedup observability.                                                                       |

### 🟡 live — lower priority (Phase 3C)

| File             | Line(s)       | Role                                                  | Notes                                                                                                                                     |
| ---------------- | ------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `youtube.js`     | 213, 227, 232 | Post-upload mutation of `youtube_post_id` on a story. | `publisher.js` now does this inside its platform block, so `youtube.js` may already be redundant. **UNVERIFIED — audit before deleting.** |
| `imagen.js`      | 183, 196      | Updates `image_path` after AI image generation.       | Read-modify-write cycle. Candidate for `db.upsertStory({ id, image_path })`.                                                              |
| `subtitles.js`   | 173, 213      | Writes subtitle paths.                                | Same pattern.                                                                                                                             |
| `scraper.js`     | 125, 139      | Scrapes article metadata into the story row.          | Same pattern.                                                                                                                             |
| `backgrounds.js` | 332, 352      | Updates background assets per story.                  | Same pattern.                                                                                                                             |

### 🟢 debug/export — keep as-is

| File                                       | Line(s) | Role                                           |
| ------------------------------------------ | ------- | ---------------------------------------------- |
| `lib/db.js::exportToJsonFile()`            | 624     | Explicit JSON dump for rollback / inspection.  |
| `lib/db-migrate.js::exportStoriesToJson()` | —       | Rollback inverse of the JSON→SQLite migration. |

### 🔵 read-only consumers — no action needed

| File                | Line(s) | Role                                                                                                                                       |
| ------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `blog/generator.js` | 146     | Reads stories for blog post assembly. Idempotent consumer. Will see SQLite-backed data automatically once `readNews()` type paths migrate. |

### ⚪ dead or suspect

| File                                                      | Line(s) | Disposition                 |
| --------------------------------------------------------- | ------- | --------------------------- |
| `.claude/worktrees/elegant-hodgkin/blog/generator.js:146` | —       | **worktree copy — ignore.** |
| `.claude/worktrees/elegant-hodgkin/lib/db.js:423,523`     | —       | **worktree copy — ignore.** |

---

## pending_news.json, image_queue.json, video_queue.json

Per Phase A §3 (grep output), pending_news.json has 5 writers:
`hunter.js:1068`, `run.js:63`, `publisher.js:173`, `server.js:718`,
and 1 reader `processor.js:115`.

**Disposition: leave until Phase 3D.** These are ephemeral handoff
queues between pipeline stages, not canonical state. Unlike
`daily_news.json`, they are not read by the dashboard/Discord/approval
flows — they sit between hunt → process → publish. The jobs queue is
the proper replacement, which is why Phase 3D is gated on Phase 4
(scheduler cutover) landing first.

image_queue.json and video_queue.json are 1-file each. Same category.

---

## analytics_history.json

Not in this patch's scope. Touched by `server.js:1649`, `lib/db.js`
(`getAnalyticsHistory` / `saveAnalyticsHistory`), and the
`analytics.js` module itself. Tracker for later.

---

## Cutover matrix — what's canonical today

| Data class                                 | When `USE_SQLITE=false`                                                                | When `USE_SQLITE=true`                                                                                                                                       |
| ------------------------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Story list (dashboard, Discord, approvals) | `daily_news.json`                                                                      | **SQLite `stories` table via `db.getStoriesSync()`** (Phase 3A)                                                                                              |
| Story approval writes via `/api/approve`   | JSON + dual-write SQLite                                                               | JSON + SQLite (dual write)                                                                                                                                   |
| Story approval writes via Discord          | **JSON only (bug)**                                                                    | **JSON only (bug)** — Phase 3B migration target                                                                                                              |
| Story upserts from hunter / processor      | JSON via `db.saveStories`                                                              | SQLite via `storyToRow` (auto-populates `source_url_hash` since Phase 2C)                                                                                    |
| Platform publication history               | `stories.<platform>_post_id` strings (incl. `DUPE_BLOCKED` / `DUPE_SKIPPED` sentinels) | `stories.<platform>_post_id` strings AND `platform_posts` rows backfilled from migration 010 (sentinels still in external_id — migration 012 open work item) |
| Weekly roundup                             | via `lib/repositories/roundups.js`                                                     | **SQLite canonical**                                                                                                                                         |
| Scoring decisions                          | via `lib/repositories/scoring.js`                                                      | **SQLite canonical**                                                                                                                                         |

---

## What remains before JSON can be retired from live ops

1. **Phase 3B (next):** migrate `discord_approve.js` + `cloud.js` approval paths to `db.upsertStory()`. Required before the Discord flow can be trusted under `USE_SQLITE=true`.
2. **Phase 3C:** leaf uploaders (`youtube.js`, `imagen.js`, `subtitles.js`, `scraper.js`, `backgrounds.js`) migrate read-modify-write cycles to per-story upserts.
3. **Phase 3D:** retire the ephemeral `pending_news.json` / `image_queue.json` / `video_queue.json` in favour of the jobs queue. **Gated on Phase 4 (scheduler cutover) landing first.**
4. **Phase 3E:** flip `daily_news.json` from dual-write to export-only. Requires a completed 3B + 3C + 3D.

Until 3E lands, `writeNews()` stays as-is (dual-write), so any caller that slips past the migration matrix doesn't silently desync.

---

## Notes on safety of Phase 3A

- `readNews()` falls back to the legacy file path on any SQLite error, preserving the original "never throw to the caller" contract.
- `writeNews()` is unchanged — pre-existing dual-write means no regression in the write side.
- `USE_SQLITE=false` (the default on fresh clones) preserves the exact legacy behaviour byte-for-byte.
- Production Railway deploy is already running with `USE_SQLITE=true` (confirmed via the Pragmata incident — `daily_news.json` on dev was 3 weeks stale while prod was live on SQLite). So the Phase 3A read flip goes from "divergent" → "consistent" on prod.

_End of Phase 3 read/write map. Updates go here as each sub-phase lands._
