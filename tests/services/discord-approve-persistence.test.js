/**
 * tests/services/discord-approve-persistence.test.js
 *
 * Pins the Phase C cutover of discord_approve.js. The two approval
 * helpers (applyApproval / applyRejection) must:
 *   - Read through the canonical persistence surface (db.getStory).
 *   - Write through db.upsertStory, never through bespoke fs.writeJson.
 *   - Preserve operator behaviour (approved=true, selected_image/title,
 *     background_images set; reject -> approved=false).
 *   - Return null when the story id is unknown.
 *
 * The tests drive the helpers with an injected db shim so they don't
 * depend on the real SQLite handle or the live daily_news.json.
 *
 * Run: node --test tests/services/discord-approve-persistence.test.js
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { applyApproval, applyRejection } = require("../../discord_approve");

/** Minimal in-memory db shim that records every upsert. */
function makeDbShim(initialStories = []) {
  const byId = new Map(initialStories.map((s) => [s.id, { ...s }]));
  const upserts = [];
  return {
    async getStory(id) {
      const s = byId.get(id);
      return s ? { ...s } : null;
    },
    async upsertStory(story) {
      upserts.push(JSON.parse(JSON.stringify(story)));
      byId.set(story.id, { ...byId.get(story.id), ...story });
    },
    _peek(id) {
      return byId.get(id) || null;
    },
    _upserts: upserts,
  };
}

test("applyApproval: sets approved=true and upserts via db.upsertStory", async () => {
  const dbHandle = makeDbShim([
    {
      id: "s1",
      title: "Test",
      approved: false,
      candidate_images: [{ path: "/img/a.jpg" }, { path: "/img/b.jpg" }],
      title_options: ["Short title", "Longer punchier title"],
    },
  ]);

  const result = await applyApproval("s1", {}, { dbHandle });

  assert.ok(result, "result must not be null");
  assert.equal(result.approved, true);
  assert.equal(dbHandle._upserts.length, 1, "exactly one upsert");
  assert.equal(dbHandle._upserts[0].id, "s1");
  assert.equal(dbHandle._upserts[0].approved, true);
  assert.equal(dbHandle._peek("s1").approved, true);
});

test("applyApproval: imageIndex sets selected_image + background_images", async () => {
  const dbHandle = makeDbShim([
    {
      id: "s1",
      title: "Test",
      candidate_images: [{ path: "/img/a.jpg" }, { path: "/img/b.jpg" }],
    },
  ]);

  const result = await applyApproval("s1", { imageIndex: 1 }, { dbHandle });

  assert.equal(result.selected_image, "/img/b.jpg");
  assert.deepEqual(result.background_images, ["/img/b.jpg"]);
});

test("applyApproval: titleIndex sets selected_title", async () => {
  const dbHandle = makeDbShim([
    {
      id: "s1",
      title: "Original",
      title_options: ["A", "B", "C"],
    },
  ]);

  const result = await applyApproval("s1", { titleIndex: 2 }, { dbHandle });

  assert.equal(result.selected_title, "C");
});

test("applyApproval: out-of-range imageIndex/titleIndex is ignored, not thrown", async () => {
  const dbHandle = makeDbShim([
    {
      id: "s1",
      title: "T",
      candidate_images: [{ path: "/img/a.jpg" }],
      title_options: ["A"],
    },
  ]);

  // 5 is out of range for both arrays — helper must not blow up and
  // must still persist the approval flag.
  const result = await applyApproval(
    "s1",
    { imageIndex: 5, titleIndex: 5 },
    { dbHandle },
  );

  assert.equal(result.approved, true);
  assert.equal(result.selected_image, undefined);
  assert.equal(result.selected_title, undefined);
});

test("applyApproval: unknown storyId returns null and upserts nothing", async () => {
  const dbHandle = makeDbShim([{ id: "s1", title: "T" }]);
  const result = await applyApproval("does-not-exist", {}, { dbHandle });
  assert.equal(result, null);
  assert.equal(dbHandle._upserts.length, 0);
});

test("applyApproval: missing storyId throws (HTTP layer will map to 400)", async () => {
  const dbHandle = makeDbShim([]);
  await assert.rejects(
    () => applyApproval(undefined, {}, { dbHandle }),
    /storyId required/,
  );
});

test("applyRejection: sets approved=false and upserts", async () => {
  const dbHandle = makeDbShim([{ id: "s1", title: "T", approved: true }]);
  const result = await applyRejection("s1", { dbHandle });
  assert.equal(result.approved, false);
  assert.equal(dbHandle._upserts.length, 1);
  assert.equal(dbHandle._peek("s1").approved, false);
});

test("applyRejection: unknown storyId returns null", async () => {
  const dbHandle = makeDbShim([]);
  const result = await applyRejection("nope", { dbHandle });
  assert.equal(result, null);
  assert.equal(dbHandle._upserts.length, 0);
});

test("repeat approvals do not double-mutate (idempotent at value level)", async () => {
  const dbHandle = makeDbShim([
    {
      id: "s1",
      title: "T",
      candidate_images: [{ path: "/img/a.jpg" }],
      title_options: ["A"],
    },
  ]);

  await applyApproval("s1", { imageIndex: 0, titleIndex: 0 }, { dbHandle });
  await applyApproval("s1", { imageIndex: 0, titleIndex: 0 }, { dbHandle });

  const final = dbHandle._peek("s1");
  assert.equal(final.approved, true);
  assert.equal(final.selected_image, "/img/a.jpg");
  assert.equal(final.selected_title, "A");
  // Two upserts recorded (caller's choice to retry); but the resulting
  // state is unchanged — no accidental array growth or flag flipping.
  assert.equal(dbHandle._upserts.length, 2);
});

test("reject after approve flips back to false without losing prior selections", async () => {
  const dbHandle = makeDbShim([
    {
      id: "s1",
      title: "T",
      candidate_images: [{ path: "/img/a.jpg" }],
      title_options: ["A"],
    },
  ]);

  await applyApproval("s1", { imageIndex: 0, titleIndex: 0 }, { dbHandle });
  await applyRejection("s1", { dbHandle });

  const final = dbHandle._peek("s1");
  assert.equal(final.approved, false);
  // Selections from the approval step are not clobbered by reject —
  // matches pre-refactor behaviour (reject only touches `approved`).
  assert.equal(final.selected_image, "/img/a.jpg");
  assert.equal(final.selected_title, "A");
});
