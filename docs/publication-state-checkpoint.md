# Publication-State Cleanliness Checkpoint

Snapshot after the second overnight sentinel-cleanup batch, ending at
commit `51f074a` on `hardening/cutover`. Updates
`docs/sentinel-cleanup-inventory.md` with the post-Task-1/2/3 state.

## Canonical publication state (post-cutover)

For any `(story, platform)` pair, the authoritative record is a row
in `platform_posts`:

| status      | meaning                                   | external_id |
| ----------- | ----------------------------------------- | ----------- |
| `pending`   | upload queued but not yet attempted       | NULL        |
| `uploading` | handler is mid-execution                  | NULL        |
| `published` | upload succeeded, external id is real     | REAL id     |
| `blocked`   | dedupe check refused (title or remote)    | NULL        |
| `failed`    | upload threw, pending retry or manual fix | NULL        |

`block_reason` carries free-text for `blocked` rows — historical
values include `title-skip: <dupe_title>`, `remote-dupe: <reason>`,
`legacy-remote-dupe`, `legacy-title-skip` (from migration 013's
backfill).

The denormalised `stories.<platform>_post_id` columns now carry ONLY
real ids (never sentinels) post-migration-013. Any reader that needs
"was this attempted and refused?" should check `platform_posts.status =
'blocked'`, not grep the stories column for `DUPE_*`.

## Where fake sentinel values still exist in the repo

### A. Dev-only legacy fallback writes (production-reachable: NO)

Seven callsites inside `if (!blockResult.persisted)` branches. They
fire only when `platform_posts` is unreachable (USE_SQLITE=false, dev
only). Production forces USE_SQLITE=true via `lib/dispatch-mode.js`, so
none execute in prod.

| File                | Line |
| ------------------- | ---- |
| `publisher.js`      | 618  |
| `publisher.js`      | 637  |
| `publisher.js`      | 697  |
| `publisher.js`      | 769  |
| `publisher.js`      | 835  |
| `publisher.js`      | 901  |
| `upload_youtube.js` | 798  |

**Category:** dev-only fallback. Retained intentionally.
**Cleanup priority:** Low. Would require retiring dev-without-SQLite
as a supported config.

### B. Read-side tolerance filters (production-reachable: YES, but no-op)

Four filters that predate the cleanup chain, retained as defensive
guards. Post-migration-013 they match nothing (no sentinels in stories).

| File                             | Lines   |
| -------------------------------- | ------- |
| `analytics.js`                   | 18, 478 |
| `engagement.js`                  | 81      |
| `server.js`                      | 960     |
| `lib/services/publish-dedupe.js` | 197     |

**Category:** read-side compatibility, now no-op.
**Cleanup priority:** Low-Medium. Safe to remove once prod has rolled
migration 013 for a full rotation. Removing them in one pass is the
next tightest cleanup after this checkpoint.

### C. Test fixtures and regression pins (production-reachable: NO — tests only)

| File                                    | Lines                      | Purpose                                                                           |
| --------------------------------------- | -------------------------- | --------------------------------------------------------------------------------- |
| `tests/services/publish-dedupe.test.js` | 241, 249                   | Pins legacy-row tolerance in the dedupe service                                   |
| `tests/db/migrations.test.js`           | 181, 192, 274-305, 339-340 | Migration 012 + 013 backfill fixtures                                             |
| `tests/services/publish-block.test.js`  | 250, 262                   | Pins that block_reason free-text with "DUPE_BLOCKED" does not pollute external_id |

**Category:** test fixtures. Retain until the code they pin changes.

### D. Documentation and code comments

Remaining mentions are descriptive prose in `docs/*.md` and
code-comments explaining past behaviour, migration rationale, or the
schema constraint. Not writers. No action required.

## Production impact summary

| Class                                             | Prod-reachable?   | Count | Status                                        |
| ------------------------------------------------- | ----------------- | ----- | --------------------------------------------- |
| Dev-only legacy fallback writes                   | **No**            | 7     | Intentional, isolated                         |
| In-memory response shape with sentinel            | **No** (was 1)    | 0     | **Cleaned in Task 1 (commit 2c5fdb6)**        |
| Historical sentinel persistence in stories        | **No** (was many) | 0     | **Cleaned by migration 013 (commit 1184a14)** |
| Historical sentinel persistence in platform_posts | **No** (was many) | 0     | **Cleaned by migration 013**                  |
| Read-side tolerance filters                       | Yes (no-op)       | 4     | Kept as safety net, no-op post-013            |
| Transition guards in publisher.js titleDupe scans | **No** (was 5)    | 0     | **Retired in Task 3 (commit 51f074a)**        |
| Test fixtures                                     | N/A               | ~10   | Retained                                      |
| Documentation                                     | N/A               | many  | Retained                                      |

**Result:** no production code path under `publisher.js::publishNextStory`,
`upload_youtube.js` (uploadShort or uploadAll), or any SQLite-enabled
writer persists a `DUPE_*` sentinel to disk. The canonical structured
state is `platform_posts.status='blocked'` with `external_id=NULL`.

## Next highest-value publication-state cleanup

**Retire the 4 read-side tolerance filters** (Class B above) in a single
coordinated pass, once operators are comfortable that prod has rolled
migration 013. The filters are no-ops; removing them reduces the
cognitive surface for future contributors and eliminates the last
"is this sentinel live or dead?" ambiguity. Suggested scope:

1. Drop the `!== "DUPE_BLOCKED"` / `!== "DUPE_SKIPPED"` comparisons
   from the four files listed above.
2. Simplify `analytics.js::isRealPostId` into `(id) => !!id` or inline
   the truthy check at the two callsites.
3. Update `tests/services/publish-dedupe.test.js:241,249` — either
   delete the legacy-row regression test (the pattern it pins is now
   impossible) or refactor it to verify a NULL row is excluded, which
   is the new invariant.
4. Keep the migration-013 test fixtures (lines 274-305) untouched —
   they test the backfill itself, not the live code path.

After that cleanup, the only remaining sentinel strings in the repo
would be in migration 013's backfill logic, the sentinel-cleanup
inventory docs, and the `publish-block` helper's comment explaining
what the helper replaces. All of those are intentional documentation.
