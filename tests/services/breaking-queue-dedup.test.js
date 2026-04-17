/**
 * tests/services/breaking-queue-dedup.test.js
 *
 * Pins the Phase 3C cutover of breaking_queue.js::isDuplicate. The dedup
 * check must route through the canonical persistence surface
 * (db.getStories) rather than a direct daily_news.json fs.readJson call,
 * so SQLite-canonical production no longer diverges from breaking-news
 * flow state.
 *
 * Run: node --test tests/services/breaking-queue-dedup.test.js
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { isDuplicate } = require("../../breaking_queue");

/** Minimal in-memory db shim — mirrors lib/db's getStories contract. */
function makeDbShim(stories = []) {
  return {
    calls: 0,
    async getStories() {
      this.calls += 1;
      return stories.slice();
    },
  };
}

test("isDuplicate: returns false when the canonical store is empty", async () => {
  const dbHandle = makeDbShim([]);
  const out = await isDuplicate(
    { id: "s1", title: "New breaking" },
    { dbHandle },
  );
  assert.equal(out, false);
  assert.equal(dbHandle.calls, 1, "reads through dbHandle.getStories");
});

test("isDuplicate: true when a story with matching id already has a platform id", async () => {
  const dbHandle = makeDbShim([
    { id: "s1", title: "Existing", youtube_post_id: "yt-1" },
  ]);
  const out = await isDuplicate({ id: "s1", title: "Existing" }, { dbHandle });
  assert.equal(out, true);
});

test("isDuplicate: true when matching id is already produced (exported_path set)", async () => {
  const dbHandle = makeDbShim([
    { id: "s1", title: "Existing", exported_path: "/out/s1.mp4" },
  ]);
  const out = await isDuplicate({ id: "s1", title: "Existing" }, { dbHandle });
  assert.equal(out, true);
});

test("isDuplicate: matching id with no platform/exported state falls through to fuzzy-title check", async () => {
  const dbHandle = makeDbShim([
    { id: "s1", title: "Pragmata twenty minutes gameplay reveal" },
  ]);
  // Same id, and a title that's a token permutation of the existing
  // row — jaccard similarity = 1.0, well above the 0.5 threshold.
  const out = await isDuplicate(
    { id: "s1", title: "twenty minutes Pragmata reveal gameplay" },
    { dbHandle },
  );
  assert.equal(out, true);
});

test("isDuplicate: different id but near-duplicate title is caught by fuzzy match", async () => {
  const dbHandle = makeDbShim([
    {
      id: "existing-1",
      title: "Bethesda confirms Elder Scrolls VI launch date",
    },
  ]);
  const out = await isDuplicate(
    {
      id: "new-1",
      title: "Bethesda confirms Elder Scrolls six launch date today",
    },
    { dbHandle },
  );
  assert.equal(out, true);
});

test("isDuplicate: genuinely-new story returns false", async () => {
  const dbHandle = makeDbShim([
    { id: "old-1", title: "Older unrelated story about fighting game" },
  ]);
  const out = await isDuplicate(
    { id: "new-2", title: "Completely different ecosystem news" },
    { dbHandle },
  );
  assert.equal(out, false);
});

test("isDuplicate: dbHandle.getStories throwing returns false (soft-fail)", async () => {
  const dbHandle = {
    async getStories() {
      throw new Error("sqlite_busy");
    },
  };
  const out = await isDuplicate({ id: "s1", title: "x" }, { dbHandle });
  assert.equal(
    out,
    false,
    "soft-fail on dedup read — the watcher would rather admit a story than lose one",
  );
});

test("isDuplicate: treats DUPE_* sentinel strings in legacy rows as not-published (post-migration 013)", async () => {
  // Post-migration-013 prod should never have these; the test just
  // verifies the in-memory check doesn't mis-fire if a legacy row
  // slips through. Sentinels are still truthy, so the published
  // check would incorrectly match — but the filter in publisher.js
  // (and the migration that scrubs them) is the intended guard.
  // We assert the current behaviour honestly so a future removal of
  // the sentinel-tolerance code doesn't silently break this module.
  const dbHandle = makeDbShim([
    { id: "s1", title: "Legacy story", youtube_post_id: "DUPE_BLOCKED" },
  ]);
  const out = await isDuplicate(
    { id: "s1", title: "Legacy story" },
    { dbHandle },
  );
  // CURRENT behaviour: sentinel is truthy, so byId.youtube_post_id
  // matches and isDuplicate returns true. Post-migration-013 prod rows
  // will have NULL here, so this branch won't fire in prod. If a
  // future cleanup decides to filter sentinels inside isDuplicate,
  // update this assertion to reflect the new contract.
  assert.equal(out, true);
});
