# Sentinel Cleanup Inventory

Snapshot after the overnight sentinel-cleanup run (commits `eded327`,
`30bbac3`, `67dee47` on `hardening/cutover`). This doc enumerates every
remaining textual occurrence of `DUPE_BLOCKED` / `DUPE_SKIPPED` in the
repo, classifies each one, and names the next highest-value cleanup.

Definition: a "sentinel write" is any code path that persists the
string `DUPE_BLOCKED` or `DUPE_SKIPPED` as if it were a real platform
external id (into `stories.<platform>_post_id` or
`platform_posts.external_id`).

## A. On-disk writers — all dev-only legacy fallback

These live inside `if (!blockResult.persisted)` branches that fire only
when `platform_posts` is unreachable. Under `USE_SQLITE=true` (forced
in production by `lib/dispatch-mode.js`) none of them execute.

| File                | Line | Callsite                                    |
| ------------------- | ---- | ------------------------------------------- |
| `publisher.js`      | 620  | YouTube titleDupe fallback                  |
| `publisher.js`      | 639  | YouTube remote-blocked fallback             |
| `publisher.js`      | 701  | TikTok titleDupe fallback                   |
| `publisher.js`      | 775  | Instagram titleDupe fallback                |
| `publisher.js`      | 843  | Facebook titleDupe fallback                 |
| `publisher.js`      | 911  | Twitter titleDupe fallback                  |
| `upload_youtube.js` | 791  | Batch path remote-blocked fallback (Task 2) |

**Category:** dev-only legacy fallback, explicitly isolated with a
line-comment on every write. Never executes in production.
**Cleanup priority:** Low. Deleting requires also dropping dev-without-
SQLite as a supported configuration, which is a separate scope call.

## B. In-memory response shape (not persisted by current callers)

| File                | Line | Shape                                               |
| ------------------- | ---- | --------------------------------------------------- |
| `upload_youtube.js` | 583  | `return { videoId: "DUPE_BLOCKED", blocked: true }` |

`uploadShort`'s internal dedup returns a sentinel `videoId` on block.
Both current callers (publisher.js YouTube section, upload_youtube.js
batch path) check `result.blocked` before reading `videoId`, so this
sentinel never reaches disk via this shape anymore.

**Category:** in-memory response, no on-disk persistence.
**Cleanup priority:** **Highest remaining.** One-line change to
`videoId: null, blocked: true` makes the contract explicit and
impossible to mispersist if a future caller naively reads `videoId`.
Zero-risk. **Recommended as the next task if overnight budget allows.**

## C. Read-side tolerance filters (not writers — legacy compatibility)

These guard against historical `DUPE_*` values in the `stories` table
that pre-date the Task 1/2 cutover. They cannot be removed until a
data-backfill migration replaces those historical rows with
`platform_posts(status='blocked', external_id=NULL)` inserts and NULLs
the denormalised columns.

| File                             | Lines                                       | Reader                                 |
| -------------------------------- | ------------------------------------------- | -------------------------------------- |
| `analytics.js`                   | 18, 478                                     | `isRealPostId` filter                  |
| `engagement.js`                  | 81                                          | Skips engagement for `DUPE_BLOCKED`    |
| `server.js`                      | 960                                         | Guard on stats-endpoint read           |
| `lib/services/publish-dedupe.js` | 196-197                                     | Excludes sentinels from dupe detection |
| `publisher.js`                   | 585-587, 672-674, 746-748, 814-816, 882-884 | 5 in-loop titleDupe filters            |

**Category:** read-side compatibility for pre-cutover historical data.
**Cleanup priority:** Blocked on Cat-D migration. Safe to keep.

## D. Absent but needed — historical data backfill

No code exists today to clean historical sentinel rows. A migration of
the shape:

```sql
-- For each of (youtube_post_id, tiktok_post_id, instagram_media_id,
-- facebook_post_id, twitter_post_id):
INSERT OR IGNORE INTO platform_posts (story_id, platform, status, block_reason, external_id)
SELECT id, '<platform>', 'blocked',
       CASE WHEN <col> = 'DUPE_BLOCKED' THEN 'legacy-remote-dupe'
            WHEN <col> = 'DUPE_SKIPPED' THEN 'legacy-title-skip'
       END,
       NULL
FROM stories
WHERE <col> LIKE 'DUPE_%';

UPDATE stories SET <col> = NULL WHERE <col> LIKE 'DUPE_%';
```

would let every Cat-C filter be deleted. Scope: one migration file + a
regression test + a coordinated removal of the Cat-C filters.
**Cleanup priority:** Medium. Only worth it once the read-side noise
becomes annoying in operational use.

## E. Test fixtures and regression pins

| File                                    | Lines    | Purpose                                                                                                    |
| --------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| `tests/services/publish-dedupe.test.js` | 241, 249 | Pins that a `DUPE_SKIPPED` value in a legacy row does NOT match as a dupe — required by the dedupe service |
| `tests/db/migrations.test.js`           | 181, 192 | Migration 012 backfill fixture: confirms DUPE-only rows are NOT backfilled for Discord markers             |
| `tests/services/publish-block.test.js`  | 250, 262 | Verifies block_reason text can contain "DUPE_BLOCKED" without polluting external_id                        |

**Category:** regression pins for correct tolerance / non-pollution.
**Cleanup priority:** Remove only when the corresponding Cat-C filter
or Cat-B code path is removed.

## F. Documentation

Every remaining mention of `DUPE_BLOCKED` / `DUPE_SKIPPED` in
`docs/*.md` or code-comments is descriptive — explains prior behaviour,
the migration story, or the schema constraint. Not a writer. No
cleanup needed.

## Summary: remaining sentinel writers by production impact

| Class                               | Production-reachable? | Count | Next action                                 |
| ----------------------------------- | --------------------- | ----- | ------------------------------------------- |
| Dev-only legacy fallback (Cat A)    | **No**                | 7     | Keep until dev-without-SQLite is retired    |
| In-memory response shape (Cat B)    | **No** (no persister) | 1     | **Next cleanup: switch to `videoId: null`** |
| Read-side tolerance filters (Cat C) | N/A (readers)         | 7     | Blocked on Cat D                            |
| Historical data backfill (Cat D)    | N/A (missing)         | 0     | Scheduled work, medium priority             |
| Test fixtures (Cat E)               | N/A (tests)           | 3     | Remove with Cat B/C                         |
| Documentation (Cat F)               | N/A (prose)           | many  | No action                                   |

**Canonical production state for blocked/skipped publish outcomes** is
now a `platform_posts` row with `status='blocked'`, `block_reason=<text>`
and `external_id=NULL`. Under `USE_SQLITE=true` no code path under
`publisher.js::publishNextStory` or `upload_youtube.js::uploadAll`
writes a sentinel to disk.
